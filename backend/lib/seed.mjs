import { randomUUID } from 'node:crypto'
import { hashPassword } from './auth.mjs'

export const DEFAULT_PROJECT_STAGES = [
  { id: 'briefing', label: 'Briefing', color: '#8b8f98' },
  { id: 'medicao', label: 'Medição', color: '#4f7ea8' },
  { id: 'projeto', label: 'Projeto 3D', color: '#6b5fa8' },
  { id: 'aprovacao', label: 'Aprovação', color: '#b9852e' },
  { id: 'planejamento', label: 'Planejamento PCP', color: '#2f8f8a' },
  { id: 'producao', label: 'Produção', color: '#700618' },
  { id: 'expedicao', label: 'Expedição', color: '#a8582f' },
  { id: 'instalacao', label: 'Instalação', color: '#3f7a4f' },
  { id: 'entregue', label: 'Entregue', color: '#4c5a67' },
  { id: 'garantia', label: 'Garantia', color: '#7a6f64' },
]

export const DEFAULT_TASK_STATUSES = [
  { id: 'todo', label: 'A fazer', color: '#8b8f98', type: 'open' },
  { id: 'doing', label: 'Em andamento', color: '#4f7ea8', type: 'active' },
  { id: 'review', label: 'Em revisão', color: '#b9852e', type: 'active' },
  { id: 'done', label: 'Concluído', color: '#3f7a4f', type: 'done' },
]

export const DEFAULT_WORK_CENTERS = [
  { code: 'CORTE', name: 'Corte (seccionadora)', kind: 'machine', hourlyCost: 95, capacityHours: 8 },
  { code: 'BORDA', name: 'Coladeira de bordas', kind: 'machine', hourlyCost: 80, capacityHours: 8 },
  { code: 'CNC', name: 'Usinagem CNC e furação', kind: 'machine', hourlyCost: 110, capacityHours: 8 },
  { code: 'MONT', name: 'Montagem', kind: 'manual', hourlyCost: 45, capacityHours: 16 },
  { code: 'ACAB', name: 'Pintura e acabamento', kind: 'manual', hourlyCost: 55, capacityHours: 8 },
  { code: 'EMB', name: 'Embalagem', kind: 'manual', hourlyCost: 30, capacityHours: 8 },
  { code: 'EXP', name: 'Expedição', kind: 'manual', hourlyCost: 30, capacityHours: 8 },
]

export const DEFAULT_COMPANY = {
  id: 'company',
  name: 'Core Cut ERP',
  legalName: 'Core Cut Sistemas',
  cnpj: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  website: '',
  defaultMargin: 35,
  defaultTax: 6,
  quoteValidityDays: 15,
  workdayHours: 8,
  paymentTerms: '50% na aprovação e 50% na entrega',
  currency: 'BRL',
}

/**
 * Configurações iniciais de uma empresa recém-cadastrada. Deve rodar dentro de
 * `db.runAsTenant(company.id, …)` para que tudo seja gravado na empresa.
 */
export function seedCompanyDefaults(db, company) {
  db.insert('settings', {
    ...DEFAULT_COMPANY,
    name: company.name,
    legalName: company.legalName || company.name,
    cnpj: company.document ?? '',
    phone: company.phone ?? '',
    email: company.email ?? '',
  })
  db.insert('settings', { id: 'projectStages', stages: DEFAULT_PROJECT_STAGES })
  db.insert('settings', { id: 'taskStatuses', statuses: DEFAULT_TASK_STATUSES })
  DEFAULT_WORK_CENTERS.forEach((wc, i) => db.insert('workCenters', { ...wc, order: i + 1, active: true, notes: '' }))
}

export function seedDefaults(db, { adminPassword = process.env.ARCOPLAN_ADMIN_PASSWORD ?? 'arcoplan123' } = {}) {
  if (typeof adminPassword !== 'string' || adminPassword.length < 8) {
    throw new Error('ARCOPLAN_ADMIN_PASSWORD deve ter pelo menos 8 caracteres.')
  }
  const users = db.col('users')
  if (users.length === 0) {
    db.insert('users', {
      id: randomUUID(),
      name: 'Administrador',
      email: 'admin@corecut.local',
      role: 'admin',
      active: true,
      position: 'Administrador do sistema',
      passwordHash: hashPassword(adminPassword),
      passwordMustChange: true,
    })
    console.log('[seed] Usuário inicial criado: "admin" (troca de senha exigida no primeiro acesso).')
  }

  const settings = db.col('settings')
  const ensure = (doc) => {
    if (!settings.find((s) => s.id === doc.id)) db.insert('settings', doc)
  }
  ensure(DEFAULT_COMPANY)
  const company = settings.find((s) => s.id === 'company')
  if (company?.name === 'Arcoplan') db.update('settings', 'company', { name: 'Core Cut ERP' })
  ensure({ id: 'projectStages', stages: DEFAULT_PROJECT_STAGES })
  ensure({ id: 'taskStatuses', statuses: DEFAULT_TASK_STATUSES })

  if (db.col('workCenters').length === 0) {
    DEFAULT_WORK_CENTERS.forEach((wc, i) => db.insert('workCenters', { ...wc, order: i + 1, active: true, notes: '' }))
  }
}
