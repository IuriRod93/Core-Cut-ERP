import { randomBytes } from 'node:crypto'

/**
 * Portal do cliente: uma página pública (sem login) com o andamento do projeto, acessada por um link com
 * código secreto. Só mostra o que o cliente precisa saber (etapa, produção, datas) e nunca valores, custos,
 * nomes de funcionários ou dados de outros clientes. A equipe gera, regenera ou revoga o link.
 */

const TOKEN_RE = /^[a-f0-9]{48}$/

const DEFAULT_STAGES = [
  { id: 'briefing', label: 'Briefing' },
  { id: 'medicao', label: 'Medição' },
  { id: 'projeto', label: 'Projeto 3D' },
  { id: 'aprovacao', label: 'Aprovação' },
  { id: 'planejamento', label: 'Planejamento' },
  { id: 'producao', label: 'Produção' },
  { id: 'expedicao', label: 'Expedição' },
  { id: 'instalacao', label: 'Instalação' },
  { id: 'entregue', label: 'Entregue' },
  { id: 'garantia', label: 'Garantia' },
]
const DEFAULT_DONE = new Set(['done'])

const STEP_LABEL = { pendente: 'Aguardando', em_andamento: 'Em andamento', pausada: 'Em andamento', concluida: 'Concluída' }
const VISIT_KIND = { entrega: 'Entrega', instalacao: 'Instalação', visita_tecnica: 'Visita técnica', medicao: 'Medição' }
const VISIT_STATUS = { agendada: 'Agendada', em_rota: 'A caminho', em_andamento: 'Em andamento', concluida: 'Concluída', reagendada: 'Reagendada' }

const clean = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max)

export const newPortalToken = () => randomBytes(24).toString('hex')
export const validPortalToken = (token) => TOKEN_RE.test(String(token ?? ''))

export function createPortal(db) {
  const findProject = (token) => {
    if (!validPortalToken(token)) return null
    const project = db.all('projects').find((p) => p.portalToken === token && p.portalEnabled !== false && !p.archived)
    return project ?? null
  }

  const stagesOf = () => {
    const custom = db.get('settings', 'projectStages')?.stages
    return Array.isArray(custom) && custom.length ? custom.map((s) => ({ id: s.id, label: String(s.label ?? s.id) })) : DEFAULT_STAGES
  }

  const doneStatuses = (project) => {
    const list = Array.isArray(project.statuses) && project.statuses.length ? project.statuses : db.get('settings', 'taskStatuses')?.statuses
    if (!Array.isArray(list) || !list.length) return DEFAULT_DONE
    return new Set(list.filter((s) => s.type === 'done').map((s) => s.id))
  }

  /** Dados públicos do projeto (já filtrados). Roda no escopo da empresa dona do projeto. */
  function view(project) {
    return db.runAsTenant(project.companyId ?? null, () => {
      const company = db.get('settings', 'company') ?? {}
      const stages = stagesOf()
      const index = Math.max(stages.findIndex((s) => s.id === project.stageId), 0)

      const done = doneStatuses(project)
      const tasks = db.col('tasks').filter((t) => t.projectId === project.id && !t.parentId)
      const progress = tasks.length ? Math.round((tasks.filter((t) => done.has(t.status)).length / tasks.length) * 100) : 0

      const orders = db
        .col('productionOrders')
        .filter((o) => o.projectId === project.id && o.status !== 'cancelada')
        .map((o) => {
          const steps = [...(o.operations ?? [])].sort((a, b) => a.order - b.order)
          const weight = steps.reduce((s, x) => s + Math.max(x.plannedMinutes ?? 0, 1), 0)
          const finished = steps.reduce((s, x) => s + Math.max(x.plannedMinutes ?? 0, 1) * (x.status === 'concluida' ? 1 : x.status === 'em_andamento' ? 0.5 : 0), 0)
          return {
            title: clean(o.title, 120),
            progress: weight ? Math.round((finished / weight) * 100) : o.status === 'concluida' ? 100 : 0,
            steps: steps.map((s) => ({ name: clean(s.name, 80), status: STEP_LABEL[s.status] ?? 'Aguardando', done: s.status === 'concluida' })),
          }
        })

      const visits = db
        .col('installations')
        .filter((i) => i.projectId === project.id && i.status !== 'cancelada')
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((i) => ({ kind: VISIT_KIND[i.kind] ?? 'Visita', date: i.date, time: i.time ?? null, status: VISIT_STATUS[i.status] ?? 'Agendada' }))

      return {
        company: { name: clean(company.name, 120), phone: clean(company.phone, 40), email: clean(company.email, 120), website: clean(company.website, 120) },
        project: {
          code: project.code,
          name: clean(project.name, 160),
          environment: clean(project.environment, 160),
          startDate: project.startDate ?? null,
          dueDate: project.dueDate ?? null,
          progress,
          stage: { label: stages[index]?.label ?? '', index, total: stages.length },
          stages: stages.map((s, i) => ({ label: s.label, state: i < index ? 'done' : i === index ? 'current' : 'todo' })),
        },
        production: orders,
        visits,
      }
    })
  }

  /** Pedido de assistência feito pelo cliente: vira um chamado "aberto" para a equipe. */
  function request(project, body) {
    const message = clean(body.message, 1500)
    if (message.length < 5) return { error: 'Descreva o que aconteceu (mínimo de 5 caracteres).' }
    const name = clean(body.name, 80)
    const contact = clean(body.contact, 80)
    return db.runAsTenant(project.companyId ?? null, () => {
      const today = new Date().toISOString().slice(0, 10)
      const warranty = db.insert('warranties', {
        title: `Pedido do cliente — ${clean(project.name, 80)}`,
        projectId: project.id,
        clientId: project.clientId,
        status: 'aberta',
        priority: 'media',
        kind: 'assistencia',
        description: `${message}\n\nEnviado pelo portal do cliente${name ? ` por ${name}` : ''}${contact ? ` (${contact})` : ''}.`,
        openedAt: today,
        source: 'portal',
        cost: 0,
      })
      db.audit({ userId: null, userName: name || 'Cliente (portal)', action: 'portal_request', collection: 'warranties', docId: warranty.id })
      return { ok: true, code: warranty.code }
    })
  }

  return { findProject, view, request }
}
