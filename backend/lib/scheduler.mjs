import { randomUUID } from 'node:crypto'

/**
 * Tarefas agendadas do servidor:
 *  - notificações de prazo (vence amanhã, vence hoje, atrasada) para os responsáveis e, em atraso longo, para o gerente do projeto;
 *  - automações por prazo ("faltam N dias", "atrasada há N dias") executadas uma vez por tarefa e prazo.
 * Também expõe `notify`, usado pelo servidor para menções e atribuições.
 */

const DAY = 86400000
const MAX_NOTIFICATIONS = 3000

const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const diffDays = (dueISO, todayISO) => Math.round((Date.parse(`${dueISO.slice(0, 10)}T12:00:00`) - Date.parse(`${todayISO}T12:00:00`)) / DAY)

const FALLBACK_STATUSES = [
  { id: 'todo', label: 'A fazer', type: 'open' },
  { id: 'doing', label: 'Em andamento', type: 'active' },
  { id: 'review', label: 'Em revisão', type: 'active' },
  { id: 'done', label: 'Concluído', type: 'done' },
]

let hook = null
/** Registra um observador chamado a cada notificação criada (ex.: webhook para WhatsApp/e-mail). */
export const setNotifyHook = (fn) => {
  hook = fn
}

/** Cria uma notificação, ignorando duplicatas pela chave (`key`). Devolve true quando criou. */
export function notify(db, n) {
  const list = db.col('notifications')
  if (n.key && list.some((x) => x.key === n.key && x.userId === n.userId)) return false
  const doc = db.insert('notifications', { id: randomUUID(), readAt: null, createdAt: new Date().toISOString(), ...n })
  try {
    hook?.(doc)
  } catch {
    /* observador não pode derrubar o servidor */
  }
  if (list.length > MAX_NOTIFICATIONS) {
    // descarta as mais antigas já lidas; se ainda exceder, as mais antigas
    const cutoff = Date.now() - 30 * DAY
    db.removeWhere('notifications', (x) => x.readAt && Date.parse(x.readAt) < cutoff)
    if (db.col('notifications').length > MAX_NOTIFICATIONS) db.col('notifications').splice(0, db.col('notifications').length - MAX_NOTIFICATIONS)
  }
  return true
}

/**
 * Executa uma rodada do agendador.
 * @param db banco de dados
 * @param opts.now data/hora de referência (testes)
 * @param opts.automations módulo `src/domain/automations.ts` (opcional; sem ele só notifica)
 */
export function runScheduler(db, opts = {}) {
  const now = opts.now ?? new Date()
  const today = iso(now)
  const summary = { notified: 0, automationsRun: 0, tasksTouched: 0 }
  const projects = new Map(db.col('projects').map((p) => [p.id, p]))
  const settings = db.col('settings').find((s) => s.id === 'taskStatuses')
  const defaultStatuses = settings?.statuses ?? FALLBACK_STATUSES
  const users = new Map(db.col('users').map((u) => [u.id, u]))
  const activeUser = (id) => users.get(id)?.active !== false && users.has(id)

  for (const task of [...db.col('tasks')]) {
    if (task.completedAt || !task.dueDate) continue
    const project = projects.get(task.projectId)
    if (!project || project.archived) continue
    const d = diffDays(task.dueDate, today) // negativo = atrasada
    const statuses = project.statuses ?? defaultStatuses
    const doneType = statuses.find((s) => s.id === task.status)?.type === 'done'
    if (doneType) continue

    // ---------- notificações de prazo
    const recipients = (task.assigneeIds ?? []).filter(activeUser)
    const path = `/projetos/${task.projectId}?tarefa=${task.id}`
    const send = (userIds, kind, title, body, key) => {
      for (const userId of userIds) if (notify(db, { userId, kind, title, body, path, taskId: task.id, projectId: task.projectId, key: `${key}:${task.id}`, createdAt: now.toISOString() })) summary.notified += 1
    }
    const where = `${project.name}`
    if (d === 1) send(recipients, 'due', 'Entrega amanhã', `${task.title} — ${where}`, `due1:${task.dueDate}`)
    else if (d === 0) send(recipients, 'due', 'Entrega hoje', `${task.title} — ${where}`, `due0:${task.dueDate}`)
    else if (d < 0) {
      const late = -d
      // lembretes nos dias 1, 3, 7 e, depois, semanalmente
      if (late === 1 || late === 3 || late === 7 || (late > 7 && late % 7 === 0))
        send(recipients, 'overdue', `Atrasada há ${late} dia(s)`, `${task.title} — ${where}`, `late${late}:${task.dueDate}`)
      if (late >= 3 && project.managerId && activeUser(project.managerId) && !recipients.includes(project.managerId) && (late === 3 || late % 7 === 0))
        send([project.managerId], 'overdue', `Tarefa atrasada há ${late} dia(s)`, `${task.title} — ${where}`, `mgr${late}:${task.dueDate}`)
    }

    // ---------- automações por prazo
    const auto = opts.automations
    if (!auto || !project.automations?.length) continue
    const runs = new Set(task.automationRuns ?? [])
    const candidates = project.automations.filter(
      (r) => r.enabled && ['due_in', 'overdue'].includes(r.trigger.type) && !runs.has(`${r.id}:${task.dueDate}`),
    )
    if (!candidates.length) continue
    const events = d >= 0 ? [{ type: 'due_in', days: d }] : [{ type: 'overdue', days: -d }]
    const ctx = {
      statuses,
      lists: db.col('taskLists').filter((l) => l.projectId === task.projectId).map((l) => ({ id: l.id, name: l.name })),
      today,
      userName: (id) => users.get(id)?.name ?? '—',
    }
    const result = auto.runAutomations(candidates, events, task, ctx)
    if (!result.ran.length) continue
    summary.automationsRun += result.ran.length
    summary.tasksTouched += 1
    const nextRuns = [...runs, ...result.ranIds.map((id) => `${id}:${task.dueDate}`)].slice(-40)
    db.update('tasks', task.id, { ...result.patch, automationRuns: nextRuns })
    const log = (body) =>
      db.insert('taskComments', { taskId: task.id, projectId: task.projectId, authorId: 'system', authorName: 'Automação', body, kind: 'system' })
    for (const name of result.ran) log(`executou a automação “${name}”`)
    for (const c of result.comments) log(`(automação) ${c}`)
    let order = 0
    for (const title of result.subtasks) {
      order += 1000
      db.insert('tasks', {
        projectId: task.projectId,
        listId: result.patch.listId ?? task.listId,
        parentId: task.id,
        title,
        status: statuses[0]?.id ?? 'todo',
        priority: 'normal',
        assigneeIds: [],
        order,
        checklists: [],
        tags: [],
      })
    }
    // avisa os responsáveis sobre o que a automação fez
    send(recipients, 'automation', 'Automação executada', `${result.ran.join(', ')} — ${task.title}`, `auto:${result.ranIds.join('+')}:${task.dueDate}`)
  }
  return summary
}
