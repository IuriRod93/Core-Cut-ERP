import { addDaysISO, daysUntil, isoDay, toDate, uid } from '../lib/format'
import { DEFAULT_TASK_STATUSES } from '../lib/store'
import type { Project, Task, TaskStatusDef, TimeEntry } from '../types'

export const statusesFor = (project?: Pick<Project, 'statuses'> | null, defaults: TaskStatusDef[] = DEFAULT_TASK_STATUSES): TaskStatusDef[] =>
  project?.statuses?.length ? project.statuses : defaults

export const statusById = (statuses: TaskStatusDef[], id?: string | null) => statuses.find((s) => s.id === id)

export const isDoneStatus = (statuses: TaskStatusDef[], id?: string | null) => statusById(statuses, id)?.type === 'done'

export const firstStatus = (statuses: TaskStatusDef[]) => statuses.find((s) => s.type === 'open') ?? statuses[0]
export const doneStatus = (statuses: TaskStatusDef[]) => statuses.find((s) => s.type === 'done') ?? statuses[statuses.length - 1]

export const PRIORITY_RANK: Record<string, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 }

export const isOverdue = (task: Pick<Task, 'dueDate' | 'completedAt'>) => Boolean(task.dueDate && !task.completedAt && (daysUntil(task.dueDate) ?? 0) < 0)

/** Ordem fracionária: insere entre dois vizinhos sem reordenar a lista inteira. */
export const orderBetween = (prev?: number, next?: number) => {
  if (prev === undefined && next === undefined) return 1000
  if (prev === undefined) return (next as number) - 1000
  if (next === undefined) return prev + 1000
  return (prev + next) / 2
}

export const nextOrder = (tasks: Pick<Task, 'order'>[]) => (tasks.length ? Math.max(...tasks.map((t) => t.order ?? 0)) + 1000 : 1000)

export const subtasksOf = (tasks: Task[], id: string) => tasks.filter((t) => t.parentId === id)

/** Progresso ponderado por estimativa (cai para contagem simples quando não há estimativas). */
export function progressOf(tasks: Task[], statuses: TaskStatusDef[]): number {
  const leaves = tasks.filter((t) => !tasks.some((c) => c.parentId === t.id))
  if (!leaves.length) return 0
  const weight = (t: Task) => (t.estimateMinutes && t.estimateMinutes > 0 ? t.estimateMinutes : 0)
  const totalW = leaves.reduce((s, t) => s + weight(t), 0)
  const done = (t: Task) => (isDoneStatus(statuses, t.status) || Boolean(t.completedAt) ? 1 : 0)
  if (totalW > 0) {
    const w = leaves.reduce((s, t) => s + (weight(t) || totalW / leaves.length) * done(t), 0)
    const t = leaves.reduce((s, x) => s + (weight(x) || totalW / leaves.length), 0)
    return Math.round((w / t) * 100)
  }
  return Math.round((leaves.reduce((s, t) => s + done(t), 0) / leaves.length) * 100)
}

export const trackedSeconds = (entries: TimeEntry[], taskId?: string) =>
  entries.filter((e) => !taskId || e.taskId === taskId).reduce((s, e) => s + (e.end ? e.seconds : Math.max(0, (Date.now() - new Date(e.start).getTime()) / 1000)), 0)

export function nextRecurrence(task: Task): string | null {
  if (!task.recurrence || !task.dueDate) return null
  const { every, unit } = task.recurrence
  const base = toDate(task.dueDate) ?? new Date()
  const d = new Date(base)
  if (unit === 'day') d.setDate(d.getDate() + every)
  else if (unit === 'week') d.setDate(d.getDate() + every * 7)
  else d.setMonth(d.getMonth() + every)
  return isoDay(d)
}

// ------------------------------------------------------ modelos de projeto
export interface TemplateTask {
  title: string
  offset: number // dias após o início do projeto
  duration?: number
  hours?: number
  priority?: 'urgente' | 'alta' | 'normal' | 'baixa'
  subtasks?: string[]
}

export interface ProjectTemplate {
  id: string
  label: string
  description: string
  lists: { name: string; color: string; tasks: TemplateTask[] }[]
}

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'ambiente',
    label: 'Ambiente planejado',
    description: 'Cozinha, closet, dormitório ou home office sob medida — do briefing à assistência.',
    lists: [
      {
        name: 'Comercial e medição',
        color: '#4f7ea8',
        tasks: [
          { title: 'Briefing e levantamento de necessidades', offset: 0, duration: 2, hours: 2 },
          { title: 'Visita técnica e medição no local', offset: 2, duration: 1, hours: 3, priority: 'alta', subtasks: ['Medir paredes, pontos de água e elétrica', 'Fotografar o ambiente', 'Conferir esquadro e nível'] },
        ],
      },
      {
        name: 'Projeto',
        color: '#6b5fa8',
        tasks: [
          { title: 'Projeto executivo 3D', offset: 4, duration: 5, hours: 12, priority: 'alta' },
          { title: 'Aprovação do projeto pelo cliente', offset: 9, duration: 3, hours: 1, priority: 'alta' },
          { title: 'Detalhamento e lista de corte', offset: 12, duration: 2, hours: 6 },
        ],
      },
      {
        name: 'Suprimentos',
        color: '#b9852e',
        tasks: [
          { title: 'Cotação de chapas, fitas e ferragens', offset: 12, duration: 1, hours: 2 },
          { title: 'Compra e confirmação de prazos', offset: 13, duration: 1, hours: 2 },
          { title: 'Conferência do recebimento', offset: 18, duration: 1, hours: 2 },
        ],
      },
      {
        name: 'Produção',
        color: '#700618',
        tasks: [
          { title: 'Plano de corte otimizado', offset: 14, duration: 1, hours: 2 },
          { title: 'Corte das chapas', offset: 19, duration: 2, hours: 8 },
          { title: 'Fita de borda', offset: 21, duration: 2, hours: 6 },
          { title: 'Usinagem e furação', offset: 23, duration: 2, hours: 8 },
          { title: 'Pré-montagem e conferência', offset: 25, duration: 3, hours: 12 },
          { title: 'Acabamento e embalagem', offset: 28, duration: 2, hours: 6 },
        ],
      },
      {
        name: 'Entrega e instalação',
        color: '#3f7a4f',
        tasks: [
          { title: 'Agendar entrega com o cliente', offset: 28, duration: 1, hours: 1 },
          { title: 'Entrega e instalação', offset: 31, duration: 3, hours: 16, priority: 'alta' },
          { title: 'Vistoria final e termo de aceite', offset: 34, duration: 1, hours: 1, priority: 'alta' },
        ],
      },
      { name: 'Pós-venda', color: '#7a6f64', tasks: [{ title: 'Contato de acompanhamento (30 dias)', offset: 64, duration: 1, hours: 1 }] },
    ],
  },
  {
    id: 'lote',
    label: 'Lote seriado (produção em massa)',
    description: 'Produção repetitiva por lote: engenharia, programação CNC, produção por setor e expedição.',
    lists: [
      {
        name: 'Engenharia',
        color: '#6b5fa8',
        tasks: [
          { title: 'Ficha técnica e lista de materiais aprovadas', offset: 0, duration: 2, hours: 6, priority: 'alta' },
          { title: 'Programação CNC e gabaritos', offset: 2, duration: 2, hours: 8 },
        ],
      },
      {
        name: 'Suprimentos',
        color: '#b9852e',
        tasks: [
          { title: 'Cálculo de necessidades e requisição de compra', offset: 2, duration: 1, hours: 2 },
          { title: 'Recebimento e conferência de materiais', offset: 6, duration: 1, hours: 3 },
        ],
      },
      {
        name: 'Produção do lote',
        color: '#700618',
        tasks: [
          { title: 'Corte do lote (seccionadora)', offset: 7, duration: 2, hours: 16 },
          { title: 'Coladeira de bordas', offset: 9, duration: 2, hours: 12 },
          { title: 'Usinagem CNC e furação', offset: 11, duration: 3, hours: 20 },
          { title: 'Montagem e acabamento', offset: 14, duration: 4, hours: 40 },
          { title: 'Inspeção de qualidade por amostragem', offset: 18, duration: 1, hours: 4, priority: 'alta' },
        ],
      },
      {
        name: 'Expedição',
        color: '#3f7a4f',
        tasks: [
          { title: 'Embalagem e etiquetagem', offset: 19, duration: 1, hours: 8 },
          { title: 'Romaneio e carregamento', offset: 20, duration: 1, hours: 3 },
          { title: 'Entrega ao cliente', offset: 21, duration: 1, hours: 4 },
        ],
      },
    ],
  },
  {
    id: 'branco',
    label: 'Projeto em branco',
    description: 'Comece do zero com uma lista de tarefas vazia.',
    lists: [{ name: 'Tarefas', color: '#8b8f98', tasks: [] }],
  },
]

export function buildTemplateTasks(template: ProjectTemplate, startDate: string) {
  return template.lists.map((list, li) => ({
    list: { name: list.name, color: list.color, order: (li + 1) * 1000 },
    tasks: list.tasks.map((t, ti) => ({
      title: t.title,
      startDate: addDaysISO(startDate, t.offset),
      dueDate: addDaysISO(startDate, t.offset + Math.max((t.duration ?? 1) - 1, 0)),
      estimateMinutes: Math.round((t.hours ?? 0) * 60) || undefined,
      priority: t.priority ?? 'normal',
      order: (ti + 1) * 1000,
      subtasks: (t.subtasks ?? []).map((s) => ({ id: uid(), text: s, done: false })),
    })),
  }))
}
