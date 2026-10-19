import type { Automation, AutomationAction, AutomationTrigger, Task, TaskStatusDef } from '../types'

/**
 * Motor das automações do projeto (estilo ClickUp: "quando … então …").
 * Puro: recebe a tarefa e o evento e devolve o que deve ser aplicado; quem chama grava os efeitos.
 */

export type AutomationEvent =
  | { type: 'status_changed'; statusId: string }
  | { type: 'task_created' }
  | { type: 'assigned'; userIds: string[] }
  | { type: 'priority_changed'; priority: string }
  | { type: 'due_in'; days: number }
  | { type: 'overdue'; days: number }

export interface AutomationResult {
  patch: Partial<Task>
  comments: string[]
  subtasks: string[]
  /** nomes das regras executadas, na ordem */
  ran: string[]
  ranIds: string[]
}

export interface AutomationContext {
  statuses: Pick<TaskStatusDef, 'id' | 'label' | 'type'>[]
  lists: { id: string; name: string }[]
  /** AAAA-MM-DD de hoje */
  today: string
  userName?: (id: string) => string
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00`)
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function matches(trigger: AutomationTrigger, ev: AutomationEvent, task: Task) {
  switch (trigger.type) {
    case 'status_changed':
      return ev.type === 'status_changed' && ev.statusId === trigger.statusId
    case 'task_created':
      return ev.type === 'task_created' && (!trigger.listId || trigger.listId === task.listId)
    case 'assigned':
      return ev.type === 'assigned' && (!trigger.userId || ev.userIds.includes(trigger.userId))
    case 'priority_changed':
      return ev.type === 'priority_changed' && ev.priority === trigger.priority
    case 'due_in':
      return ev.type === 'due_in' && ev.days === trigger.days
    case 'overdue':
      return ev.type === 'overdue' && ev.days >= trigger.days
  }
}

/** Descrição curta, em português, de um gatilho (para a lista de regras). */
export function describeTrigger(t: AutomationTrigger, ctx: Pick<AutomationContext, 'statuses' | 'lists' | 'userName'>) {
  switch (t.type) {
    case 'status_changed':
      return `o status mudar para “${ctx.statuses.find((s) => s.id === t.statusId)?.label ?? t.statusId}”`
    case 'task_created':
      return t.listId ? `uma tarefa for criada na lista “${ctx.lists.find((l) => l.id === t.listId)?.name ?? '—'}”` : 'uma tarefa for criada'
    case 'assigned':
      return t.userId ? `a tarefa for atribuída a ${ctx.userName?.(t.userId) ?? 'um usuário'}` : 'alguém for atribuído à tarefa'
    case 'priority_changed':
      return `a prioridade mudar para ${t.priority}`
    case 'due_in':
      return t.days === 0 ? 'a tarefa vencer hoje' : `faltar ${t.days} dia(s) para a entrega`
    case 'overdue':
      return `a tarefa estiver atrasada há ${t.days} dia(s) ou mais`
  }
}

export function describeAction(a: AutomationAction, ctx: Pick<AutomationContext, 'statuses' | 'lists' | 'userName'>) {
  switch (a.type) {
    case 'set_status':
      return `mudar o status para “${ctx.statuses.find((s) => s.id === a.statusId)?.label ?? a.statusId}”`
    case 'assign':
      return `atribuir a ${ctx.userName?.(a.userId) ?? 'um usuário'}`
    case 'set_priority':
      return `definir a prioridade como ${a.priority}`
    case 'add_tag':
      return `adicionar a etiqueta “${a.tag}”`
    case 'move_list':
      return `mover para a lista “${ctx.lists.find((l) => l.id === a.listId)?.name ?? '—'}”`
    case 'set_due_in':
      return `definir a entrega para daqui a ${a.days} dia(s)`
    case 'comment':
      return `comentar “${a.text.slice(0, 40)}”`
    case 'create_subtasks':
      return `criar ${a.titles.length} subtarefa(s)`
  }
}

/**
 * Executa as regras ativas para os eventos informados. Efeitos de uma regra (ex.: mudar o status)
 * podem disparar outras, no máximo uma vez cada, para evitar laços.
 */
export function runAutomations(rules: Automation[] | undefined, events: AutomationEvent[], task: Task, ctx: AutomationContext): AutomationResult {
  const result: AutomationResult = { patch: {}, comments: [], subtasks: [], ran: [], ranIds: [] }
  const active = (rules ?? []).filter((r) => r.enabled && r.actions.length)
  if (!active.length || !events.length) return result
  const fired = new Set<string>()
  const queue: AutomationEvent[] = [...events]
  let current: Task = { ...task }
  let guard = 0

  while (queue.length && guard++ < 12) {
    const ev = queue.shift()!
    for (const rule of active) {
      if (fired.has(rule.id) || !matches(rule.trigger, ev, current)) continue
      fired.add(rule.id)
      result.ran.push(rule.name)
      result.ranIds.push(rule.id)
      for (const a of rule.actions) {
        switch (a.type) {
          case 'set_status': {
            if (current.status === a.statusId) break
            const done = ctx.statuses.find((s) => s.id === a.statusId)?.type === 'done'
            current = { ...current, status: a.statusId, completedAt: done ? (current.completedAt ?? new Date().toISOString()) : null }
            result.patch.status = a.statusId
            result.patch.completedAt = current.completedAt
            queue.push({ type: 'status_changed', statusId: a.statusId })
            break
          }
          case 'assign': {
            if (current.assigneeIds?.includes(a.userId)) break
            current = { ...current, assigneeIds: [...(current.assigneeIds ?? []), a.userId] }
            result.patch.assigneeIds = current.assigneeIds
            queue.push({ type: 'assigned', userIds: [a.userId] })
            break
          }
          case 'set_priority':
            if ((current.priority ?? 'normal') === a.priority) break
            current = { ...current, priority: a.priority as Task['priority'] }
            result.patch.priority = current.priority
            queue.push({ type: 'priority_changed', priority: a.priority })
            break
          case 'add_tag':
            if (current.tags?.includes(a.tag)) break
            current = { ...current, tags: [...(current.tags ?? []), a.tag] }
            result.patch.tags = current.tags
            break
          case 'move_list':
            if (current.listId === a.listId) break
            current = { ...current, listId: a.listId }
            result.patch.listId = a.listId
            break
          case 'set_due_in':
            current = { ...current, dueDate: addDays(ctx.today, a.days) }
            result.patch.dueDate = current.dueDate
            break
          case 'comment':
            result.comments.push(a.text)
            break
          case 'create_subtasks':
            result.subtasks.push(...a.titles.filter((t) => t.trim()))
            break
        }
      }
    }
  }
  return result
}

/** Modelos prontos para o dia a dia da marcenaria. */
export function automationTemplates(statuses: Pick<TaskStatusDef, 'id' | 'label' | 'type'>[]): Omit<Automation, 'id'>[] {
  const done = statuses.find((s) => s.type === 'done')
  const active = statuses.find((s) => s.type === 'active')
  const out: Omit<Automation, 'id'>[] = []
  if (done)
    out.push({
      name: 'Concluída → avisar no histórico',
      enabled: true,
      trigger: { type: 'status_changed', statusId: done.id },
      actions: [{ type: 'comment', text: 'Tarefa concluída — conferir etapa seguinte do projeto.' }],
    })
  if (active)
    out.push({
      name: 'Em andamento → prioridade alta',
      enabled: true,
      trigger: { type: 'status_changed', statusId: active.id },
      actions: [{ type: 'set_priority', priority: 'alta' }],
    })
  out.push({
    name: 'Nova tarefa → checklist de medição',
    enabled: true,
    trigger: { type: 'task_created' },
    actions: [{ type: 'create_subtasks', titles: ['Conferir medidas no local', 'Fotografar o ambiente', 'Registrar observações do cliente'] }],
  })
  return out
}
