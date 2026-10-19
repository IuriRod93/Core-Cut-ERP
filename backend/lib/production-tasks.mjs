import { randomUUID } from 'node:crypto'

/**
 * Espelha a produção nas tarefas do projeto: cada ordem de produção vira uma tarefa-mãe
 * ("Produção — OP-0012") com uma subtarefa por etapa do roteiro. O andamento vem SEMPRE do Chão de
 * fábrica (sentido único: operações → tarefas), então não há duas verdades para o mesmo trabalho.
 */

const DEFAULT_STATUSES = [
  { id: 'todo', type: 'open' },
  { id: 'doing', type: 'active' },
  { id: 'review', type: 'active' },
  { id: 'done', type: 'done' },
]

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function createProductionTasks(db) {
  const statusesFor = (project) => {
    const own = Array.isArray(project?.statuses) && project.statuses.length ? project.statuses : null
    const shared = db.get('settings', 'taskStatuses')?.statuses
    return own ?? (Array.isArray(shared) && shared.length ? shared : DEFAULT_STATUSES)
  }
  const pick = (statuses, type) => (statuses.find((s) => s.type === type) ?? statuses[0])?.id

  const taskPatch = (task, patch) => {
    const changed = Object.entries(patch).some(([key, value]) => !same(task[key], value))
    return changed ? db.update('tasks', task.id, patch) : task
  }

  /** Cria ou atualiza a tarefa-mãe e as subtarefas da ordem. Idempotente. */
  function sync(order) {
    if (!order?.projectId || !Array.isArray(order.operations) || order.operations.length === 0) return
    const project = db.get('projects', order.projectId)
    if (!project) return
    const statuses = statusesFor(project)
    const open = pick(statuses, 'open')
    const active = pick(statuses, 'active')
    const done = pick(statuses, 'done')
    const now = new Date().toISOString()

    // lista "Produção" do projeto
    let list = db.col('taskLists').find((l) => l.projectId === project.id && l.name === 'Produção')
    if (!list) {
      const lists = db.col('taskLists').filter((l) => l.projectId === project.id)
      list = db.insert('taskLists', { projectId: project.id, name: 'Produção', order: Math.max(0, ...lists.map((l) => Number(l.order) || 0)) + 1000, color: '#a8582f' })
    }

    const operations = [...order.operations].sort((a, b) => a.order - b.order)
    const finished = operations.every((op) => op.status === 'concluida')
    const started = operations.some((op) => ['em_andamento', 'pausada', 'concluida'].includes(op.status))
    const parentStatus = order.status === 'cancelada' ? open : finished ? done : started ? active : open

    const tasks = db.col('tasks').filter((t) => t.productionOrderId === order.id)
    let parent = tasks.find((t) => !t.parentId)
    const parentFields = {
      title: `Produção — ${order.code ?? ''} · ${order.title ?? ''}`.replace(/\s+·\s*$/, '').slice(0, 160),
      status: parentStatus,
      completedAt: finished ? (parent?.completedAt ?? order.completedAt ?? now) : null,
      dueDate: order.dueDate ?? null,
      listId: list.id,
    }
    if (!parent) {
      parent = db.insert('tasks', {
        projectId: project.id,
        parentId: null,
        priority: order.priority === 'urgente' ? 'urgente' : order.priority === 'alta' ? 'alta' : 'normal',
        assigneeIds: [],
        order: 9000,
        checklists: [],
        tags: ['produção'],
        productionOrderId: order.id,
        source: 'production',
        ...parentFields,
      })
    } else parent = taskPatch(parent, parentFields)

    for (const op of operations) {
      const status = op.status === 'concluida' ? done : ['em_andamento', 'pausada'].includes(op.status) ? active : open
      const fields = {
        title: String(op.name ?? 'Etapa').slice(0, 160),
        status,
        completedAt: op.status === 'concluida' ? (op.finishedAt ?? now) : null,
        assigneeIds: op.operatorId ? [op.operatorId] : [],
        estimateMinutes: Math.round(Number(op.plannedMinutes) || 0),
        startDate: op.startedAt ? String(op.startedAt).slice(0, 10) : null,
        dueDate: order.dueDate ?? null,
        listId: list.id,
        parentId: parent.id,
      }
      const child = tasks.find((t) => t.parentId && t.operationId === op.id)
      if (child) taskPatch(child, fields)
      else {
        db.insert('tasks', {
          projectId: project.id,
          priority: 'normal',
          order: (Number(op.order) || 0) * 1000,
          checklists: [],
          tags: ['produção'],
          productionOrderId: order.id,
          operationId: op.id,
          source: 'production',
          ...fields,
        })
      }
    }
  }

  /** Aplica a sincronização a todas as ordens (execução única na partida: cobre ordens criadas antes do recurso). */
  function backfill() {
    let count = 0
    for (const order of db.all('productionOrders')) {
      try {
        db.runAsTenant(order.companyId ?? null, () => sync(order))
        count += 1
      } catch (error) {
        console.error('[produção] Falha ao espelhar a ordem', order.id, error?.message ?? error)
      }
    }
    return count
  }

  return { sync, backfill, id: randomUUID }
}
