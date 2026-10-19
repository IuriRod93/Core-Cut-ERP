// Definições de perfis, módulos e coleções compartilhadas entre o backend
// (aplica as permissões) e o frontend (esconde o que o usuário não acessa).

export const MODULES = {
  dashboard: 'Painel',
  tasks: 'Minhas tarefas',
  agenda: 'Agenda',
  leads: 'Leads',
  clients: 'Clientes',
  budgets: 'Orçamentos',
  contracts: 'Contratos',
  projects: 'Projetos',
  production: 'Ordens de produção',
  shopfloor: 'Chão de fábrica',
  cutplan: 'Plano de corte',
  bom: 'Fichas técnicas',
  quality: 'Qualidade',
  maintenance: 'Manutenção',
  logistics: 'Entregas e instalações',
  warranty: 'Garantias',
  inventory: 'Estoque e catálogo',
  purchases: 'Compras',
  suppliers: 'Fornecedores',
  financial: 'Financeiro',
  team: 'Equipe',
  timeclock: 'Ponto',
  vehicles: 'Veículos',
  reports: 'Relatórios',
  files: 'Arquivos',
  settings: 'Configurações',
  audit: 'Logs de acesso',
}

export const MODULE_KEYS = Object.keys(MODULES)

export const ROLES = {
  admin: 'Administrador',
  gerente: 'Gerência',
  comercial: 'Comercial',
  projetista: 'Projetos e design',
  pcp: 'PCP e produção',
  producao: 'Operação de fábrica',
  suprimentos: 'Suprimentos',
  financeiro: 'Financeiro',
  instalador: 'Entrega e instalação',
}

const basics = ['dashboard', 'tasks', 'timeclock']

export const ROLE_DEFAULT_MODULES = {
  admin: [...MODULE_KEYS],
  gerente: MODULE_KEYS.filter((m) => m !== 'settings'),
  comercial: [...basics, 'agenda', 'leads', 'clients', 'budgets', 'contracts', 'projects', 'files'],
  projetista: [...basics, 'agenda', 'projects', 'bom', 'cutplan', 'budgets', 'clients', 'quality', 'files'],
  pcp: [...basics, 'agenda', 'projects', 'production', 'shopfloor', 'cutplan', 'bom', 'inventory', 'purchases', 'quality', 'maintenance', 'logistics', 'warranty', 'reports', 'files'],
  producao: [...basics, 'shopfloor', 'production', 'quality', 'maintenance'],
  suprimentos: [...basics, 'inventory', 'purchases', 'suppliers', 'files'],
  financeiro: [...basics, 'agenda', 'financial', 'contracts', 'budgets', 'clients', 'suppliers', 'purchases', 'reports', 'files'],
  instalador: [...basics, 'logistics', 'warranty', 'vehicles', 'files'],
}

// modules: quem pode ler E gravar. readAll: qualquer usuário interno autenticado
// pode ler (dados de referência usados em seletores de todo o sistema).
export const COLLECTIONS = {
  users: { modules: ['team'], readAll: true },
  // empresas/unidades do cliente: a equipe é organizada por elas
  units: { modules: ['team', 'settings'], readAll: true, prefix: 'UN' },
  leads: { modules: ['leads'], prefix: 'LD' },
  clients: { modules: ['clients', 'budgets', 'projects', 'financial', 'contracts'], readAll: true, prefix: 'CLI' },
  projects: { modules: ['projects'], readAll: true, prefix: 'PRJ' },
  taskLists: { modules: ['projects', 'tasks'], readAll: true },
  tasks: { modules: ['projects', 'tasks'], readAll: true },
  taskComments: { modules: ['projects', 'tasks'], readAll: true },
  projectDocs: { modules: ['projects'], readAll: true },
  timeEntries: { modules: ['projects', 'tasks'], readAll: true },
  budgets: { modules: ['budgets'], prefix: 'ORC' },
  contracts: { modules: ['contracts'], prefix: 'CTR' },
  boms: { modules: ['bom', 'production', 'budgets'], readAll: true, prefix: 'FT' },
  workCenters: { modules: ['production', 'shopfloor', 'maintenance', 'settings'], readAll: true },
  productionOrders: { modules: ['production', 'shopfloor'], readAll: true, prefix: 'OP' },
  cutPlans: { modules: ['cutplan', 'production'], prefix: 'PLC' },
  qualityRecords: { modules: ['quality', 'production', 'shopfloor'], prefix: 'RNC' },
  qualityInspections: { modules: ['quality', 'production', 'shopfloor'], readAll: true, prefix: 'QIN' },
  maintenance: { modules: ['maintenance'], prefix: 'MAN' },
  installations: { modules: ['logistics', 'projects'], prefix: 'ENT' },
  warranties: { modules: ['warranty'], prefix: 'GAR' },
  materials: { modules: ['inventory', 'purchases', 'bom', 'budgets', 'cutplan'], readAll: true },
  inventoryMovements: { modules: ['inventory', 'purchases', 'production'] },
  inventoryReservations: { modules: ['inventory', 'production', 'purchases'], readAll: true, prefix: 'RES' },
  offcuts: { modules: ['inventory', 'cutplan', 'production'], readAll: true, prefix: 'RET' },
  purchases: { modules: ['purchases'], prefix: 'PC' },
  suppliers: { modules: ['suppliers', 'purchases', 'inventory'], readAll: true, prefix: 'FOR' },
  contractors: { modules: ['suppliers', 'logistics'], readAll: true, prefix: 'PRE' },
  receivables: { modules: ['financial'] },
  commissions: { modules: ['financial'], prefix: 'COM' },
  invoices: { modules: ['financial'], prefix: 'NF', readOnly: true },
  payables: { modules: ['financial'] },
  bankAccounts: { modules: ['financial'] },
  productsServices: { modules: ['financial', 'budgets', 'bom'], readAll: true },
  vehicles: { modules: ['vehicles', 'logistics'], readAll: true },
  events: { modules: ['agenda', 'projects', 'logistics', 'leads'], readAll: true },
  timeclock: { modules: ['timeclock', 'team'], own: 'userId' },
  files: { modules: ['files', 'projects', 'production', 'quality', 'logistics', 'warranty', 'clients'], readAll: true },
  settings: { modules: ['settings'], readAll: true },
  auditLogs: { modules: ['audit'], readOnly: true },
  trash: { modules: ['settings'], readOnly: true },
}

// Campos sensíveis de coleções legíveis por todos (readAll): quem não tem nenhum dos módulos da coleção
// (nem os de `also`) recebe o registro sem esses campos. O operador de fábrica enxerga o nome do cliente
// nas ordens, mas não o telefone, o documento nem o valor do contrato.
export const SENSITIVE_FIELDS = {
  clients: { fields: ['document', 'email', 'phone', 'contactName', 'zip', 'address', 'city', 'state', 'notes'], also: ['logistics', 'warranty', 'leads'] },
  suppliers: { fields: ['document', 'contact', 'phone', 'email', 'website', 'address', 'paymentTerms', 'notes'], also: ['financial'] },
  contractors: { fields: ['document', 'phone', 'email', 'dailyRate', 'notes'], also: ['financial'] },
  projects: { fields: ['contractValue', 'portalToken'], also: ['budgets', 'contracts', 'financial'] },
  productsServices: { fields: ['price', 'cost'], also: ['financial', 'budgets', 'bom'] },
  materials: { fields: ['cost'], also: ['financial'] },
}

/** Remove os campos sensíveis de um registro para quem não tem módulo com direito a eles. */
export function redactDoc(name, doc, modules) {
  const rule = SENSITIVE_FIELDS[name]
  if (!rule || !doc || typeof doc !== 'object') return doc
  const allowed = [...(COLLECTIONS[name]?.modules ?? []), ...(rule.also ?? [])]
  if (allowed.some((module) => modules.includes(module))) return doc
  const copy = { ...doc }
  for (const field of rule.fields) delete copy[field]
  return copy
}

export const isManagerRole = (role) => role === 'admin' || role === 'gerente'

export function resolveModules(user) {
  if (!user || user.active === false) return []
  const base = ROLE_DEFAULT_MODULES[user.role] ?? []
  const extra = Array.isArray(user.extraModules) ? user.extraModules : []
  const denied = Array.isArray(user.deniedModules) ? user.deniedModules : []
  const set = new Set([...base, ...extra.filter((m) => MODULE_KEYS.includes(m))])
  if (user.role !== 'admin') denied.forEach((m) => set.delete(m))
  set.add('dashboard')
  return [...set]
}

export function canAccessModule(user, key) {
  return resolveModules(user).includes(key)
}
