import { daysUntil } from '../../lib/format'
import { PRIORITY_RANK } from '../../domain/tasks'
import { TASK_PRIORITIES } from '../../domain/constants'
import type { Task, TaskList, TaskStatusDef, User } from '../../types'
import type { Filters } from './useWorkspace'

export interface TaskGroup {
  id: string
  label: string
  color: string
  tasks: Task[]
  /** Campos aplicados a uma tarefa solta nesta coluna/grupo. */
  patch: Partial<Task>
  droppable: boolean
}

const byOrder = (a: Task, b: Task) => a.order - b.order

export function groupTasks(
  tasks: Task[],
  groupBy: Filters['groupBy'],
  ctx: { statuses: TaskStatusDef[]; lists: TaskList[]; users: User[] },
): TaskGroup[] {
  const top = tasks.filter((t) => !t.parentId)
  switch (groupBy) {
    case 'status':
      return ctx.statuses.map((s) => ({
        id: s.id,
        label: s.label,
        color: s.color,
        tasks: top.filter((t) => t.status === s.id).sort(byOrder),
        patch: { status: s.id },
        droppable: true,
      }))
    case 'list':
      return ctx.lists.map((l) => ({
        id: l.id,
        label: l.name,
        color: l.color ?? '#8b8f98',
        tasks: top.filter((t) => t.listId === l.id).sort(byOrder),
        patch: { listId: l.id },
        droppable: true,
      }))
    case 'priority':
      return TASK_PRIORITIES.map((p) => ({
        id: p.value,
        label: p.label,
        color: p.color ?? '#8b8f98',
        tasks: top.filter((t) => (t.priority ?? 'normal') === p.value).sort(byOrder),
        patch: { priority: p.value as Task['priority'] },
        droppable: true,
      }))
    case 'assignee': {
      const groups: TaskGroup[] = ctx.users
        .map((u) => ({
          id: u.id,
          label: u.name,
          color: u.color ?? '#700618',
          tasks: top.filter((t) => t.assigneeIds?.includes(u.id)).sort(byOrder),
          patch: { assigneeIds: [u.id] } as Partial<Task>,
          droppable: false,
        }))
        .filter((g) => g.tasks.length)
      groups.push({ id: '_none', label: 'Sem responsável', color: '#8b8f98', tasks: top.filter((t) => !t.assigneeIds?.length).sort(byOrder), patch: {}, droppable: false })
      return groups
    }
    case 'due': {
      const bucket = (t: Task) => {
        if (!t.dueDate) return 'none'
        const d = daysUntil(t.dueDate) ?? 0
        if (d < 0) return 'late'
        if (d === 0) return 'today'
        if (d <= 7) return 'week'
        return 'later'
      }
      const defs = [
        { id: 'late', label: 'Atrasadas', color: '#c23b3b' },
        { id: 'today', label: 'Hoje', color: '#b7791f' },
        { id: 'week', label: 'Próximos 7 dias', color: '#2f6f9f' },
        { id: 'later', label: 'Mais adiante', color: '#7d838c' },
        { id: 'none', label: 'Sem data', color: '#b7b2ac' },
      ]
      return defs.map((d) => ({ ...d, tasks: top.filter((t) => bucket(t) === d.id).sort((a, b) => (a.dueDate ?? '9').localeCompare(b.dueDate ?? '9') || PRIORITY_RANK[a.priority ?? 'normal'] - PRIORITY_RANK[b.priority ?? 'normal']), patch: {}, droppable: false }))
    }
    default:
      return [{ id: 'all', label: 'Todas as tarefas', color: '#7d838c', tasks: [...top].sort(byOrder), patch: {}, droppable: false }]
  }
}
