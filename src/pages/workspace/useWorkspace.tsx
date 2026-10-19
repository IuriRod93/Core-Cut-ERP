import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../components/feedback'
import { useCollections, useDefaultTaskStatuses } from '../../lib/store'
import { daysUntil, matches, uid } from '../../lib/format'
import { doneStatus, firstStatus, isDoneStatus, nextOrder, nextRecurrence, statusById, statusesFor } from '../../domain/tasks'
import { runAutomations, type AutomationEvent } from '../../domain/automations'
import { createDoc, removeDoc, updateDoc } from '../../lib/store'
import type { Project, Task, TaskComment, TaskList, TaskStatusDef, TimeEntry, User } from '../../types'

export interface Filters {
  search: string
  assignees: string[]
  priorities: string[]
  statuses: string[]
  tags: string[]
  due: 'all' | 'overdue' | 'today' | 'week' | 'none'
  showDone: boolean
  mine: boolean
  groupBy: 'status' | 'list' | 'assignee' | 'priority' | 'due' | 'none'
}

export const DEFAULT_FILTERS: Filters = {
  search: '',
  assignees: [],
  priorities: [],
  statuses: [],
  tags: [],
  due: 'all',
  showDone: true,
  mine: false,
  groupBy: 'status',
}

interface WorkspaceValue {
  project: Project
  statuses: TaskStatusDef[]
  lists: TaskList[]
  tasks: Task[]
  topLevel: Task[]
  filtered: Task[]
  users: User[]
  userMap: Map<string, User>
  entries: TimeEntry[]
  comments: TaskComment[]
  filters: Filters
  setFilters: (patch: Partial<Filters>) => void
  resetFilters: () => void
  activeFilterCount: number
  openTaskId: string | null
  openTask: (id: string | null) => void
  createTask: (data: Partial<Task>, opts?: { skipAutomations?: boolean }) => Promise<Task>
  selected: string[]
  toggleSelect: (id: string) => void
  setSelected: (ids: string[]) => void
  clearSelection: () => void
  bulkUpdate: (patch: Partial<Task>) => Promise<void>
  bulkDuplicate: () => Promise<void>
  bulkDelete: () => Promise<void>
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  duplicateTask: (id: string) => Promise<void>
  createList: (name: string, color?: string) => Promise<TaskList>
  updateList: (id: string, patch: Partial<TaskList>) => Promise<void>
  deleteList: (id: string) => Promise<void>
}

const Ctx = createContext<WorkspaceValue | null>(null)
export const useWorkspace = () => {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace fora do WorkspaceProvider')
  return v
}

export function WorkspaceProvider({ project, initialTaskId, children }: { project: Project; initialTaskId?: string | null; children: ReactNode }) {
  const { user } = useAuth()
  const toast = useToast()
  const defaults = useDefaultTaskStatuses()
  const { data } = useCollections(['tasks', 'taskLists', 'users', 'timeEntries', 'taskComments'] as const)
  const [filters, setFiltersState] = useState<Filters>(DEFAULT_FILTERS)
  const [openTaskId, openTask] = useState<string | null>(initialTaskId ?? null)
  const [selected, setSelectedState] = useState<string[]>([])

  const statuses = useMemo(() => statusesFor(project, defaults), [project, defaults])
  const tasks = useMemo(() => data.tasks.filter((t) => t.projectId === project.id), [data.tasks, project.id])
  const lists = useMemo(() => data.taskLists.filter((l) => l.projectId === project.id).sort((a, b) => a.order - b.order), [data.taskLists, project.id])
  const entries = useMemo(() => data.timeEntries.filter((e) => e.projectId === project.id), [data.timeEntries, project.id])
  const comments = useMemo(() => data.taskComments.filter((c) => c.projectId === project.id), [data.taskComments, project.id])
  const users = useMemo(() => data.users.filter((u) => u.active !== false), [data.users])
  const userMap = useMemo(() => new Map(data.users.map((u) => [u.id, u])), [data.users])
  const topLevel = useMemo(() => tasks.filter((t) => !t.parentId), [tasks])

  const setFilters = useCallback((patch: Partial<Filters>) => setFiltersState((f) => ({ ...f, ...patch })), [])
  const resetFilters = useCallback(() => setFiltersState((f) => ({ ...DEFAULT_FILTERS, groupBy: f.groupBy })), [])

  const filtered = useMemo(() => {
    const f = filters
    return tasks.filter((t) => {
      if (f.mine && !t.assigneeIds?.includes(user?.id ?? '')) return false
      if (!f.showDone && (t.completedAt || isDoneStatus(statuses, t.status))) return false
      if (f.assignees.length && !f.assignees.some((a) => t.assigneeIds?.includes(a))) return false
      if (f.priorities.length && !f.priorities.includes(t.priority ?? 'normal')) return false
      if (f.statuses.length && !f.statuses.includes(t.status)) return false
      if (f.tags.length && !f.tags.some((tag) => t.tags?.includes(tag))) return false
      if (f.due !== 'all') {
        const d = t.dueDate ? daysUntil(t.dueDate) : null
        if (f.due === 'none' && t.dueDate) return false
        if (f.due === 'overdue' && !(d !== null && d < 0 && !t.completedAt)) return false
        if (f.due === 'today' && d !== 0) return false
        if (f.due === 'week' && !(d !== null && d >= 0 && d <= 7)) return false
      }
      if (f.search && !matches([t.title, t.description, t.tags?.join(' ')], f.search)) return false
      return true
    })
  }, [tasks, filters, statuses, user?.id])

  const activeFilterCount =
    filters.assignees.length +
    filters.priorities.length +
    filters.statuses.length +
    filters.tags.length +
    (filters.due !== 'all' ? 1 : 0) +
    (filters.mine ? 1 : 0) +
    (filters.showDone ? 0 : 1) +
    (filters.search ? 1 : 0)

  const log = useCallback(
    (taskId: string, body: string) => {
      if (!user) return
      void createDoc('taskComments', { taskId, projectId: project.id, authorId: user.id, authorName: user.name, body, kind: 'system' })
    },
    [user, project.id],
  )

  const automationCtx = useCallback(
    () => ({
      statuses,
      lists: lists.map((l) => ({ id: l.id, name: l.name })),
      today: new Date().toISOString().slice(0, 10),
      userName: (id: string) => userMap.get(id)?.name ?? '—',
    }),
    [statuses, lists, userMap],
  )

  /** Grava os efeitos das automações (subtarefas e histórico); o patch é aplicado por quem chama. */
  const applyAutomationSideEffects = useCallback(
    async (taskId: string, listId: string | undefined, r: ReturnType<typeof runAutomations>) => {
      for (const name of r.ran) log(taskId, `executou a automação “${name}”`)
      for (const c of r.comments) log(taskId, `(automação) ${c}`)
      let order = 0
      for (const title of r.subtasks) {
        order += 1000
        await createDoc('tasks', { projectId: project.id, listId, parentId: taskId, title, status: firstStatus(statuses).id, priority: 'normal', assigneeIds: [], order, checklists: [], tags: [] } as Partial<Task>)
      }
    },
    [log, project.id, statuses],
  )

  const createTask = useCallback(
    async (input: Partial<Task>, opts: { skipAutomations?: boolean } = {}) => {
      const siblings = tasks.filter((t) => (t.parentId ?? null) === (input.parentId ?? null) && (input.listId ? t.listId === input.listId : true))
      const task = await createDoc('tasks', {
        projectId: project.id,
        listId: input.listId ?? lists[0]?.id,
        parentId: input.parentId ?? null,
        title: input.title ?? 'Nova tarefa',
        status: input.status ?? firstStatus(statuses).id,
        priority: input.priority ?? 'normal',
        assigneeIds: input.assigneeIds ?? [],
        order: input.order ?? nextOrder(siblings),
        checklists: [],
        tags: [],
        ...input,
      })
      if (!opts.skipAutomations && !input.parentId && project.automations?.length) {
        const events: AutomationEvent[] = [{ type: 'task_created' }]
        if (task.assigneeIds?.length) events.push({ type: 'assigned', userIds: task.assigneeIds })
        const r = runAutomations(project.automations, events, task, automationCtx())
        if (r.ran.length) {
          if (Object.keys(r.patch).length) await updateDoc('tasks', task.id, r.patch)
          await applyAutomationSideEffects(task.id, r.patch.listId ?? task.listId, r)
          return { ...task, ...r.patch } as Task
        }
      }
      return task
    },
    [tasks, lists, statuses, project.id, project.automations, automationCtx, applyAutomationSideEffects],
  )

  const updateTask = useCallback(
    async (id: string, patch: Partial<Task>) => {
      const current = tasks.find((t) => t.id === id)
      if (!current) return
      const next: Partial<Task> = { ...patch }

      if (patch.status && patch.status !== current.status) {
        const becomesDone = isDoneStatus(statuses, patch.status)
        if (becomesDone && !current.completedAt) next.completedAt = new Date().toISOString()
        if (!becomesDone && current.completedAt) next.completedAt = null
        log(id, `alterou o status para “${statusById(statuses, patch.status)?.label ?? patch.status}”`)
      }
      if (patch.assigneeIds) {
        const added = patch.assigneeIds.filter((a) => !current.assigneeIds?.includes(a))
        if (added.length) log(id, `atribuiu a tarefa a ${added.map((a) => userMap.get(a)?.name ?? '—').join(', ')}`)
      }
      if (patch.dueDate !== undefined && patch.dueDate !== current.dueDate) {
        log(id, patch.dueDate ? `definiu a entrega para ${patch.dueDate.split('-').reverse().join('/')}` : 'removeu a data de entrega')
      }

      // Automações do projeto (quando … então …)
      let auto: ReturnType<typeof runAutomations> | null = null
      if (project.automations?.length) {
        const events: AutomationEvent[] = []
        if (patch.status && patch.status !== current.status) events.push({ type: 'status_changed', statusId: patch.status })
        if (patch.assigneeIds) {
          const added = patch.assigneeIds.filter((a) => !current.assigneeIds?.includes(a))
          if (added.length) events.push({ type: 'assigned', userIds: added })
        }
        if (patch.priority && patch.priority !== current.priority) events.push({ type: 'priority_changed', priority: patch.priority })
        if (events.length) {
          auto = runAutomations(project.automations, events, { ...current, ...next } as Task, automationCtx())
          if (auto.ran.length) Object.assign(next, auto.patch)
          else auto = null
        }
      }

      await updateDoc('tasks', id, next)
      if (auto) await applyAutomationSideEffects(id, (next.listId ?? current.listId) as string | undefined, auto)

      // Automação: tarefa recorrente gera a próxima ocorrência ao concluir.
      if (next.completedAt && current.recurrence) {
        const due = nextRecurrence({ ...current, ...next } as Task)
        if (due) {
          await createDoc('tasks', {
            ...current,
            id: undefined as never,
            status: firstStatus(statuses).id,
            completedAt: null,
            dueDate: due,
            startDate: null,
            order: nextOrder(tasks),
            code: undefined,
          } as Partial<Task>)
          toast.info('Tarefa recorrente: próxima ocorrência criada.')
        }
      }

      // Automação: subtarefas ↔ tarefa-mãe.
      if (current.parentId && patch.status) {
        const parent = tasks.find((t) => t.id === current.parentId)
        if (parent) {
          const siblings = tasks.filter((t) => t.parentId === parent.id).map((t) => (t.id === id ? { ...t, status: patch.status! } : t))
          const allDone = siblings.every((t) => isDoneStatus(statuses, t.status))
          if (allDone && !isDoneStatus(statuses, parent.status)) {
            await updateDoc('tasks', parent.id, { status: doneStatus(statuses).id, completedAt: new Date().toISOString() })
            toast.info('Todas as subtarefas foram concluídas — tarefa principal concluída.')
          } else if (!allDone && isDoneStatus(statuses, parent.status)) {
            const active = statuses.find((s) => s.type === 'active') ?? firstStatus(statuses)
            await updateDoc('tasks', parent.id, { status: active.id, completedAt: null })
          }
        }
      }
    },
    [tasks, statuses, log, userMap, toast, project.automations, automationCtx, applyAutomationSideEffects],
  )

  const setSelected = useCallback((ids: string[]) => setSelectedState(ids), [])
  const toggleSelect = useCallback((id: string) => setSelectedState((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])), [])
  const clearSelection = useCallback(() => setSelectedState([]), [])
  const bulkUpdate = useCallback(
    async (patch: Partial<Task>) => {
      for (const id of selected) await updateTask(id, patch)
      toast.success(`${selected.length} tarefa(s) atualizada(s).`)
    },
    [selected, updateTask, toast],
  )

  const deleteTask = useCallback(async (id: string) => removeDoc('tasks', id), [])

  const duplicateTask = useCallback(
    async (id: string) => {
      const src = tasks.find((t) => t.id === id)
      if (!src) return
      const clone = await createDoc('tasks', {
        ...src,
        id: undefined as never,
        title: `${src.title} (cópia)`,
        status: firstStatus(statuses).id,
        completedAt: null,
        order: nextOrder(tasks),
        checklists: (src.checklists ?? []).map((c) => ({ ...c, id: uid(), items: c.items.map((i) => ({ ...i, id: uid(), done: false })) })),
      } as Partial<Task>)
      for (const sub of tasks.filter((t) => t.parentId === id)) {
        await createDoc('tasks', { ...sub, id: undefined as never, parentId: clone.id, status: firstStatus(statuses).id, completedAt: null } as Partial<Task>)
      }
      toast.success('Tarefa duplicada.')
    },
    [tasks, statuses, toast],
  )

  const bulkDuplicate = useCallback(async () => {
    for (const id of selected) await duplicateTask(id)
    setSelectedState([])
  }, [selected, duplicateTask])
  const bulkDelete = useCallback(async () => {
    for (const id of selected) await removeDoc('tasks', id)
    toast.success(`${selected.length} tarefa(s) movida(s) para a lixeira.`)
    setSelectedState([])
  }, [selected, toast])

  const createList = useCallback(
    async (name: string, color?: string) =>
      createDoc('taskLists', { projectId: project.id, name, color: color ?? '#8b8f98', order: (lists.length ? Math.max(...lists.map((l) => l.order)) : 0) + 1000 }),
    [project.id, lists],
  )
  const updateList = useCallback(async (id: string, patch: Partial<TaskList>) => void (await updateDoc('taskLists', id, patch)), [])
  const deleteList = useCallback(
    async (id: string) => {
      const orphan = lists.find((l) => l.id !== id)
      for (const t of tasks.filter((t) => t.listId === id)) await updateDoc('tasks', t.id, { listId: orphan?.id })
      await removeDoc('taskLists', id)
    },
    [lists, tasks],
  )

  const value: WorkspaceValue = {
    project,
    statuses,
    lists,
    tasks,
    topLevel,
    filtered,
    users,
    userMap,
    entries,
    comments,
    filters,
    setFilters,
    resetFilters,
    activeFilterCount,
    openTaskId,
    openTask,
    createTask,
    selected,
    toggleSelect,
    setSelected,
    clearSelection,
    bulkUpdate,
    bulkDuplicate,
    bulkDelete,
    updateTask,
    deleteTask,
    duplicateTask,
    createList,
    updateList,
    deleteList,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
