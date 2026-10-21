import type { ModuleKey, RoleKey } from '../shared/access.mjs'
import type { PauseReason } from '../shared/shopfloor.mjs'

export type { ModuleKey, RoleKey }

export interface Doc {
  id: string
  createdAt: string
  updatedAt: string
  createdBy?: string
  createdByName?: string
  code?: string
  demo?: boolean
}

export interface User extends Doc {
  name: string
  email: string
  role: RoleKey
  active: boolean
  position?: string
  phone?: string
  document?: string
  admissionDate?: string
  hourlyCost?: number
  workSchedule?: string
  extraModules?: ModuleKey[]
  deniedModules?: ModuleKey[]
  passwordMustChange?: boolean
  /** PIN do chão de fábrica cadastrado (o PIN em si nunca sai do servidor) */
  hasShopfloorPin?: boolean
  lastLoginAt?: string
  photoFileId?: string | null
  color?: string | null
  notes?: string
  companyId?: string
  companyRole?: 'owner' | 'admin' | 'member'
  /** empresa/unidade do cliente à qual o usuário pertence */
  unitId?: string
}

/** Empresa, filial ou unidade do cliente: a equipe é organizada por elas. */
export interface Unit extends Doc {
  name: string
  document?: string
  city?: string
  address?: string
  phone?: string
  managerId?: string
  active?: boolean
  notes?: string
}

export interface PlanLimits {
  maxUsers: number
  maxProjects: number
  maxBudgets: number
  maxProductionOrders: number
  maxInventoryItems: number
}

export type CompanyAccessState = 'platform' | 'trial' | 'trial_expired' | 'suspended' | 'active' | 'expiring' | 'grace' | 'past_due' | 'pending_payment' | 'canceled' | 'expired'

export interface CompanyAccess {
  allowed: boolean
  state: CompanyAccessState
  message?: string
  warning?: string
  paidUntil: string | null
  daysLeft: number | null
  trialEndsAt?: string | null
  hoursLeft?: number
  method: 'card' | 'pix' | 'simulated' | 'trial' | 'manual' | null
}

/** Empresa assinante do usuário autenticado (ausente na base original da plataforma). */
export interface Subscriber {
  id: string
  name: string
  planId: string
  planName: string
  planPrice: number
  status: string
  billingMethod: 'card' | 'pix' | 'simulated' | 'trial' | 'manual' | null
  paidUntil: string | null
  cancelAtPeriodEnd: boolean
  limits: PlanLimits
  planModules: ModuleKey[]
  access: CompanyAccess
}

export type LeadStage = 'novo' | 'contato' | 'visita' | 'proposta' | 'negociacao' | 'ganho' | 'perdido'

export interface Lead extends Doc {
  name: string
  company?: string
  phone?: string
  email?: string
  origin: 'instagram' | 'indicacao' | 'google' | 'cliente_antigo' | 'arquiteto' | 'feira' | 'outro'
  stage: LeadStage
  value?: number
  interest?: string
  nextAction?: string
  nextActionDate?: string
  responsibleId?: string
  lostReason?: string
  clientId?: string
  notes?: string
}

export interface Client extends Doc {
  name: string
  type: 'PF' | 'PJ'
  document?: string
  email?: string
  phone?: string
  contactName?: string
  zip?: string
  address?: string
  /** dados completos para a nota fiscal */
  number?: string
  district?: string
  complement?: string
  /** inscrição estadual (vazio = não contribuinte) */
  ie?: string
  city?: string
  state?: string
  status: 'ativo' | 'inativo'
  segment?: 'residencial' | 'corporativo' | 'construtora' | 'arquiteto' | 'revenda'
  notes?: string
}

export type Priority = 'urgente' | 'alta' | 'normal' | 'baixa'

export interface CustomFieldDef {
  id: string
  name: string
  type: 'text' | 'number' | 'money' | 'date' | 'select' | 'checkbox'
  options?: string[]
}

export interface TaskStatusDef {
  id: string
  label: string
  color: string
  type: 'open' | 'active' | 'done'
  /** limite de tarefas simultâneas no status (quadro: coluna fica vermelha ao exceder) */
  wipLimit?: number
}

/** Visão salva do projeto: aba + filtros + agrupamento. */
export interface SavedView {
  id: string
  name: string
  view: string
  filters: {
    search?: string
    assignees?: string[]
    priorities?: string[]
    statuses?: string[]
    tags?: string[]
    due?: 'all' | 'overdue' | 'today' | 'week' | 'none'
    showDone?: boolean
    mine?: boolean
    groupBy?: 'status' | 'list' | 'assignee' | 'priority' | 'due' | 'none'
  }
}

export type AutomationTrigger =
  | { type: 'status_changed'; statusId: string }
  | { type: 'task_created'; listId?: string }
  | { type: 'assigned'; userId?: string }
  | { type: 'priority_changed'; priority: string }
  /** vence em N dias (0 = hoje); avaliado pelo servidor uma vez por prazo */
  | { type: 'due_in'; days: number }
  /** atrasada há N dias ou mais; avaliado pelo servidor uma vez por prazo */
  | { type: 'overdue'; days: number }

export type AutomationAction =
  | { type: 'set_status'; statusId: string }
  | { type: 'assign'; userId: string }
  | { type: 'set_priority'; priority: string }
  | { type: 'add_tag'; tag: string }
  | { type: 'move_list'; listId: string }
  | { type: 'set_due_in'; days: number }
  | { type: 'comment'; text: string }
  | { type: 'create_subtasks'; titles: string[] }

export interface Automation {
  id: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  actions: AutomationAction[]
  runs?: number
}

/** Documento do projeto (briefing, ata, especificação) em Markdown simples. */
export interface ProjectDoc extends Doc {
  projectId: string
  title: string
  body: string
  pinned?: boolean
  updatedByName?: string
}

export interface Project extends Doc {
  name: string
  clientId?: string
  stageId: string
  priority: 'baixa' | 'media' | 'alta' | 'urgente'
  managerId?: string
  memberIds?: string[]
  startDate?: string
  dueDate?: string
  contractValue?: number
  estimatedCost?: number
  address?: string
  description?: string
  /** link secreto do portal do cliente (só a equipe vê; o cliente acessa por /acompanhar/<código>) */
  portalToken?: string
  portalEnabled?: boolean
  color?: string
  tags?: string[]
  statuses?: TaskStatusDef[]
  customFields?: CustomFieldDef[]
  budgetId?: string
  environment?: string
  stageChangedAt?: string
  archived?: boolean
  completedAt?: string
  savedViews?: SavedView[]
  automations?: Automation[]
}

export interface TaskList extends Doc {
  projectId: string
  name: string
  order: number
  color?: string
}

export interface Checklist {
  id: string
  title: string
  items: { id: string; text: string; done: boolean }[]
}

export interface Task extends Doc {
  projectId: string
  listId?: string
  parentId?: string | null
  title: string
  description?: string
  status: string
  priority?: Priority | null
  assigneeIds: string[]
  /** Responsáveis digitados por nome (colaboradores sem login no sistema). */
  assigneeNames?: string[]
  /** tarefa gerada pela produção: o andamento vem do Chão de fábrica */
  productionOrderId?: string
  operationId?: string
  source?: 'production'
  startDate?: string | null
  dueDate?: string | null
  estimateMinutes?: number
  points?: number
  tags?: string[]
  checklists?: Checklist[]
  dependsOn?: string[]
  custom?: Record<string, string | number | boolean | null>
  order: number
  completedAt?: string | null
  recurrence?: { every: number; unit: 'day' | 'week' | 'month' } | null
  milestone?: boolean
  watcherIds?: string[]
  /** automações por prazo já executadas nesta tarefa (`regra:prazo`) */
  automationRuns?: string[]
}

export interface TaskComment extends Doc {
  taskId: string
  projectId: string
  authorId: string
  authorName: string
  body: string
  kind?: 'comment' | 'system'
  mentions?: string[]
}

export interface TimeEntry extends Doc {
  taskId?: string
  projectId?: string
  userId: string
  userName?: string
  start: string
  end?: string | null
  seconds: number
  note?: string
  billable?: boolean
}

export type BudgetStatus = 'rascunho' | 'enviado' | 'aprovado' | 'recusado' | 'expirado'

export interface BudgetItem {
  id: string
  group: string
  description: string
  kind: 'ambiente' | 'modulo' | 'material' | 'ferragem' | 'servico' | 'outro'
  unit: string
  quantity: number
  unitCost: number
  unitPrice: number
  bomId?: string
  materialId?: string
  /** item gerado e mantido por um plano de corte (atualizado a cada recálculo) */
  cutPlanId?: string
}

export interface Budget extends Doc {
  title: string
  clientId?: string
  projectId?: string
  status: BudgetStatus
  validUntil?: string
  items: BudgetItem[]
  laborHours?: number
  laborRate?: number
  marginPercent: number
  discountPercent?: number
  taxPercent?: number
  freight?: number
  installation?: number
  paymentTerms?: string
  deliveryDays?: number
  notes?: string
  approvedAt?: string
  responsibleId?: string
}

export interface Installment {
  id: string
  label: string
  dueDate: string
  amount: number
  receivableId?: string
}

export interface Contract extends Doc {
  title: string
  clientId?: string
  projectId?: string
  budgetId?: string
  value: number
  status: 'rascunho' | 'enviado' | 'assinado' | 'em_execucao' | 'concluido' | 'cancelado'
  signedAt?: string
  startDate?: string
  endDate?: string
  installments: Installment[]
  terms?: string
  fileId?: string
}

export interface BomPart {
  id: string
  name: string
  quantity: number
  length: number
  width: number
  materialId?: string
  edgeTop?: boolean
  edgeBottom?: boolean
  edgeLeft?: boolean
  edgeRight?: boolean
  grain?: boolean
  machining?: Machining[]
  notes?: string
}

export interface Bom extends Doc {
  name: string
  category: 'balcao' | 'aereo' | 'torre' | 'gaveteiro' | 'roupeiro' | 'painel' | 'bancada' | 'porta' | 'outro'
  description?: string
  width?: number
  height?: number
  depth?: number
  parts: BomPart[]
  hardware: { id: string; materialId?: string; description: string; quantity: number }[]
  routing: { id: string; workCenterId: string; minutes: number }[]
  edgeMaterialId?: string
  salePrice?: number
  active: boolean
}

export interface WorkCenter extends Doc {
  code: string
  name: string
  kind: 'machine' | 'manual'
  hourlyCost: number
  capacityHours: number
  order: number
  active: boolean
  notes?: string
}

export type OpStatus = 'planejada' | 'liberada' | 'em_producao' | 'qualidade' | 'concluida' | 'pausada' | 'cancelada'

export interface OpOperation {
  id: string
  workCenterId: string
  name: string
  order: number
  plannedMinutes: number
  actualSeconds: number
  status: 'pendente' | 'em_andamento' | 'pausada' | 'concluida'
  runningSince?: string | null
  operatorId?: string | null
  operatorName?: string | null
  quantityDone: number
  startedAt?: string | null
  finishedAt?: string | null
  /** trechos trabalhados (quem estava com a etapa em andamento) */
  segments?: { operatorId: string | null; operatorName: string; start: string; end: string; seconds: number }[]
  /** etiquetas feitas nesta etapa ("planoId:peçaId:unidade"): o roteiro avança peça por peça */
  piecesDone?: string[]
  piecesAt?: string
  /** pausas com motivo; a aberta tem end = null */
  pauses?: { start: string; end: string | null; seconds?: number; reason: PauseReason; note?: string; byId?: string; byName?: string }[]
}

export interface ProductionOrder extends Doc {
  title: string
  projectId?: string
  clientId?: string
  status: OpStatus
  priority: 'baixa' | 'media' | 'alta' | 'urgente'
  batch?: string
  startDate?: string
  dueDate?: string
  items: { id: string; bomId?: string; name: string; quantity: number; notes?: string }[]
  operations: OpOperation[]
  materialsPosted?: boolean
  reservationIds?: string[]
  reservationStatus?: 'reserved' | 'released' | 'consumed'
  qualityStatus?: 'pending' | 'approved' | 'rejected'
  qualityInspectionId?: string
  cutPlanIds?: string[]
  releasedAt?: string
  completedAt?: string
  notes?: string
}

export type MachiningMethod =
  | 'dobradica_35'
  | 'minifix_15'
  | 'cavilha_8'
  | 'confirmat_5'
  | 'pino_5'
  | 'passante_5'
  | 'puxador_5'
  | 'furo_livre'
  | 'rasgo_fundo'
  | 'rasgo_livre'
  | 'recorte'

/** Usinagem de uma peça. Coordenadas em mm a partir do canto inferior esquerdo da peça (x ao longo do comprimento, y ao longo da largura). */
export interface Machining {
  id: string
  kind: 'furo' | 'rasgo' | 'recorte'
  method: MachiningMethod
  /** topo = face visível · fundo = face inferior (exige virar a peça) · borda = furo de topo de chapa */
  face: 'topo' | 'borda' | 'fundo'
  x: number
  y: number
  diameter?: number
  depth: number
  /** rasgo/recorte: extensão ao longo de x */
  length?: number
  /** rasgo: largura da fresa · recorte: extensão ao longo de y */
  width?: number
  /** rasgo: direção do canal (padrão x = ao longo do comprimento da peça) */
  axis?: 'x' | 'y'
  note?: string
}

/** Vértice do contorno de uma peça não retangular (coordenadas locais). `edge` indica que a aresta até o próximo vértice é fitada. */
export interface ContourPoint {
  x: number
  y: number
  edge?: boolean
}

export interface CutPiece {
  id: string
  label: string
  module?: string
  length: number
  width: number
  quantity: number
  rotate: boolean
  materialId?: string
  edgeTop?: boolean
  edgeBottom?: boolean
  edgeLeft?: boolean
  edgeRight?: boolean
  /** mm de fita em arestas que não coincidem com os lados do retângulo envolvente (peças em L etc.) */
  edgeExtra?: number
  /** contorno real da peça quando não é retangular; o encaixe na chapa usa o retângulo envolvente */
  contour?: ContourPoint[]
  environment?: string
  /** nome do material no arquivo de origem (Promob) */
  sourceMaterial?: string
  machining?: Machining[]
}

export interface CutPlacement {
  pieceId: string
  label: string
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
}

export interface CutSheet {
  index: number
  placements: CutPlacement[]
  usedArea: number
  utilization: number
}

export interface CutPlanGroup {
  key: string
  materialId?: string
  materialName: string
  thickness: number
  sheetWidth: number
  sheetHeight: number
  sheetCost: number
  sheets: CutSheet[]
  unplaced: { label: string; length: number; width: number }[]
  utilization: number
  cost: number
  /** grupo cortado de um retalho do estoque (não é chapa nova: não entra em compras nem custo) */
  offcutId?: string
  offcutCode?: string
}

export interface GcodeParams {
  toolDiameter: number
  spindleRpm: number
  feedCut: number
  feedPlunge: number
  feedDrill: number
  safeZ: number
  passDepth: number
  overcut: number
  tabs: boolean
  tabWidth: number
  tabHeight: number
  peck: number
  toolChange: 'm6' | 'm0'
}

export interface CutPlanCosts {
  sheets: number
  edge: number
  hardware: number
  machining: number
  total: number
  edgeMeters: number
  holes: number
  grooves: number
  minutes: number
}

export type CutPlanStatus = 'rascunho' | 'aprovado' | 'em_corte' | 'concluido'

export interface CutPlan extends Doc {
  title: string
  status: CutPlanStatus
  projectId?: string
  productionOrderId?: string
  responsibleId?: string
  mode: 'seccionadora' | 'cnc'
  kerf: number
  trim: number
  defaultMaterialId?: string
  edgeMaterialId?: string
  pieces: CutPiece[]
  hardware: { id: string; materialId?: string; description: string; quantity: number; unitCost: number }[]
  groups: CutPlanGroup[]
  costs: CutPlanCosts
  utilization: number
  gcode: GcodeParams
  notes?: string
  /** arquivos de origem importados (Promob CSV/XML/DXF/DXT) */
  imports?: { fileName: string; format: string; at: string; parts: number; fileId?: string }[]
  /** planos criados a partir de um anexo de tarefa aguardam revisão do material */
  pendingReview?: boolean
  /** tarefa cujo anexo originou o plano */
  taskId?: string
  /** listagens trazem só o resumo: `pieces`/`groups` vêm vazios e estes totais substituem a contagem */
  summary?: boolean
  pieceLines?: number
  pieceCount?: number
  sheetCount?: number
}

export interface QualityRecord extends Doc {
  title: string
  kind: 'retrabalho' | 'refugo' | 'defeito_material' | 'erro_projeto' | 'dano_transporte' | 'reclamacao_cliente'
  severity: 'baixa' | 'media' | 'alta' | 'critica'
  status: 'aberta' | 'em_analise' | 'em_tratamento' | 'concluida'
  projectId?: string
  productionOrderId?: string
  workCenterId?: string
  description?: string
  rootCause?: string
  correctiveAction?: string
  responsibleId?: string
  cost?: number
  openedAt: string
  closedAt?: string
}

export interface QualityInspection extends Doc {
  productionOrderId: string
  projectId?: string
  status: 'pending' | 'approved' | 'rejected'
  notes?: string
  startedAt: string
  checkedAt?: string
  checkedBy?: string
  checkedByName?: string
  rejectedAt?: string
  rejectedBy?: string
  rejectedByName?: string
}

export interface MaintenanceRecord extends Doc {
  title: string
  workCenterId?: string
  vehicleId?: string
  kind: 'preventiva' | 'corretiva' | 'preditiva'
  status: 'agendada' | 'em_andamento' | 'concluida' | 'cancelada'
  scheduledDate: string
  doneDate?: string
  technician?: string
  cost?: number
  downtimeHours?: number
  recurrenceDays?: number
  description?: string
}

export interface Installation extends Doc {
  kind: 'entrega' | 'instalacao' | 'visita_tecnica' | 'medicao'
  projectId?: string
  clientId?: string
  date: string
  time?: string
  status: 'agendada' | 'em_rota' | 'em_andamento' | 'concluida' | 'reagendada' | 'cancelada'
  /** ordem de produção que originou a entrega (agendada ao aprovar a qualidade) */
  productionOrderId?: string
  address?: string
  teamIds?: string[]
  vehicleId?: string
  checklist?: { id: string; text: string; done: boolean }[]
  notes?: string
  customerSignedBy?: string
  completedAt?: string
  /** destino geocodificado a partir do endereço */
  destLat?: number
  destLng?: number
  destLabel?: string
  /** última posição enviada pela equipe e rastro da rota (gravados só pelo rastreamento) */
  lastLocation?: { lat: number; lng: number; at: string; accuracy?: number; userId?: string; userName?: string }
  track?: { lat: number; lng: number; at: string }[]
}

export interface Warranty extends Doc {
  title: string
  /** garantia (defeito de fabricação), assistência (ajuste/uso) ou reposição de peça */
  kind?: 'garantia' | 'assistencia' | 'reposicao'
  /** origem do chamado: aberto pela equipe ou pelo cliente no portal */
  source?: 'portal'
  visitDate?: string
  visitTime?: string
  photoIds?: string[]
  projectId?: string
  clientId?: string
  status: 'aberta' | 'em_analise' | 'agendada' | 'resolvida' | 'negada'
  priority: 'baixa' | 'media' | 'alta' | 'urgente'
  description?: string
  resolution?: string
  responsibleId?: string
  cost?: number
  openedAt: string
  resolvedAt?: string
}

export type CommissionStatus = 'prevista' | 'liberada' | 'paga' | 'cancelada'

/** Comissão de venda/projeto: calculada sobre a receita do orçamento e liberada conforme o cliente paga. */
export interface Commission extends Doc {
  budgetId?: string
  projectId?: string
  personId: string
  role: 'vendedor' | 'projetista' | 'montador' | 'outro'
  /** receita líquida de impostos usada como base */
  baseAmount: number
  percent: number
  amount: number
  status: CommissionStatus
  paidAt?: string
  notes?: string
}

export type MaterialCategory = 'chapa' | 'fita_borda' | 'ferragem' | 'insumo' | 'vidro' | 'pedra' | 'outro'

export interface Material extends Doc {
  name: string
  category: MaterialCategory
  subcategory?: string
  unit: string
  cost: number
  priceSource?: 'leo_madeiras' | 'manual'
  priceUpdatedAt?: string
  priceHistory?: { at: string; price: number }[]
  brand?: string
  thickness?: number | null
  sheetWidth?: number | null
  sheetHeight?: number | null
  stock: number
  minStock: number
  location?: string
  supplierId?: string
  catalogId?: string
  imageUrl?: string | null
  /** foto enviada pela empresa (tem prioridade sobre a imagem do catálogo) */
  photoFileId?: string | null
  sourceUrl?: string | null
  active: boolean
}

export interface InventoryMovement extends Doc {
  materialId: string
  materialName: string
  type: 'entry' | 'exit' | 'adjustment' | 'reserve'
  quantity: number
  stockBefore: number
  stockAfter: number
  unit: string
  reason?: string
  projectId?: string | null
  productionOrderId?: string | null
  purchaseId?: string | null
  unitCost?: number | null
  userId: string
  userName: string
  occurredAt: string
}

export interface InventoryReservation extends Doc {
  productionOrderId: string
  materialId: string
  materialName: string
  quantity: number
  unit: string
  status: 'reserved' | 'released' | 'consumed'
  projectId?: string | null
  releasedAt?: string
  consumedAt?: string
}

export type OffcutStatus = 'disponivel' | 'reservado' | 'usado' | 'descartado'

/** Sobra de chapa guardada no estoque para ser reaproveitada no próximo plano de corte. */
export interface Offcut extends Doc {
  materialId?: string
  materialName: string
  thickness?: number
  /** medidas em mm; `width` acompanha o veio da chapa */
  width: number
  height: number
  status: OffcutStatus
  location?: string
  /** plano de corte e chapa de origem */
  sourcePlanId?: string
  sourceSheet?: number
  projectId?: string
  /** plano que reservou/usou o retalho */
  usedInPlanId?: string
  notes?: string
}

export type PurchaseStatus ='rascunho' | 'solicitado' | 'cotacao' | 'aprovado' | 'reprovado' | 'pedido' | 'parcial' | 'recebido' | 'cancelado'

export interface PurchaseItem {
  materialId?: string
  description: string
  unit?: string
  quantity: number
  unitCost: number
  received?: number
}

export interface Purchase extends Doc {
  supplierId?: string
  projectId?: string
  productionOrderId?: string
  status: PurchaseStatus
  items: PurchaseItem[]
  freight?: number
  expectedDate?: string
  receivedAt?: string
  invoiceNumber?: string
  paymentTerms?: string
  notes?: string
  requestedBy?: string
  payableId?: string
  /** solicitação gerada a partir de um plano de corte otimizado */
  cutPlanId?: string
  decidedBy?: string
  decidedByName?: string
  decidedAt?: string
  rejectedReason?: string
}

export interface Supplier extends Doc {
  name: string
  category: 'chapas' | 'ferragens' | 'insumos' | 'vidros' | 'pedras' | 'servicos' | 'logistica' | 'outro'
  document?: string
  contact?: string
  phone?: string
  email?: string
  website?: string
  address?: string
  paymentTerms?: string
  leadTimeDays?: number
  rating?: number
  status: 'ativo' | 'inativo'
  notes?: string
}

export interface Contractor extends Doc {
  name: string
  specialty: 'montador' | 'eletricista' | 'marmorista' | 'vidraceiro' | 'pintor' | 'transportador' | 'outro'
  document?: string
  phone?: string
  email?: string
  dailyRate?: number
  status: 'ativo' | 'inativo'
  notes?: string
}

export interface FinanceEntry extends Doc {
  description: string
  amount: number
  dueDate: string
  paidDate?: string | null
  status: 'pendente' | 'pago' | 'cancelado'
  category: string
  accountId?: string
  method?: string
  projectId?: string
  notes?: string
  documentNumber?: string
}

export interface Receivable extends FinanceEntry {
  clientId?: string
  contractId?: string
  installmentLabel?: string
}

export interface Payable extends FinanceEntry {
  supplierId?: string
  purchaseId?: string
  recurring?: boolean
}

export interface BankAccount extends Doc {
  name: string
  bank?: string
  kind: 'caixa' | 'corrente' | 'poupanca' | 'cartao'
  openingBalance: number
  active: boolean
}

export interface ProductService extends Doc {
  name: string
  kind: 'produto' | 'servico'
  category?: string
  unit: string
  price: number
  cost?: number
  active: boolean
  description?: string
}

export interface Vehicle extends Doc {
  plate: string
  model: string
  brand?: string
  year?: number
  kind: 'caminhao' | 'van' | 'utilitario' | 'carro' | 'moto'
  driverId?: string
  status: 'ativo' | 'manutencao' | 'inativo'
  odometer?: number
  nextMaintenance?: string
  insuranceUntil?: string
  notes?: string
}

export interface AgendaEvent extends Doc {
  title: string
  kind: 'reuniao' | 'medicao' | 'visita' | 'entrega' | 'instalacao' | 'prazo' | 'outro'
  date: string
  endDate?: string
  startTime?: string
  endTime?: string
  allDay?: boolean
  projectId?: string
  attendeeIds?: string[]
  location?: string
  notes?: string
}

export interface ClockEntry extends Doc {
  userId: string
  type: 'entrada' | 'saida_intervalo' | 'volta_intervalo' | 'saida'
  at: string
  note?: string
  /** onde a pessoa estava ao bater o ponto (quando permitiu a localização) */
  lat?: number
  lng?: number
  accuracy?: number
  place?: string
  locationStatus?: 'granted' | 'denied' | 'unavailable'
}

export interface FileDoc extends Doc {
  name: string
  size: number
  mime: string
  folder: string
  projectId?: string | null
  clientId?: string | null
  refType?: string | null
  refId?: string | null
  visibility: 'interno' | 'compartilhado' | 'financeiro'
  uploadedBy: string
  uploadedByName: string
}

export interface AuditLog {
  id: string
  at: string
  userId: string | null
  userName: string
  action: string
  collection: string
  docId: string | null
  label: string
  changes?: string[]
  ip?: string
}

export interface TrashEntry extends Doc {
  collection: string
  doc: Doc
  label: string
  deletedAt: string
  deletedByName: string
}

export interface CompanySettings extends Doc {
  name: string
  legalName: string
  cnpj: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  website: string
  defaultMargin: number
  defaultTax: number
  quoteValidityDays: number
  workdayHours: number
  paymentTerms: string
  /** Chão de fábrica: fim do expediente ("18:00"); vazio = sem pausa automática por horário */
  shopfloorShiftEnd?: string
  /** Chão de fábrica: horas seguidas rodando até a pausa automática (padrão 10; 0 = desligado) */
  shopfloorMaxRunHours?: number
  /** fuso da empresa (padrão America/Sao_Paulo) */
  timeZone?: string
  /** Arquivo do logotipo da empresa (propostas, contratos, planos, etiquetas e relatórios). */
  logoFileId?: string | null
  // ---- dados fiscais (nota fiscal / DANFE) ----
  /** inscrição estadual e municipal */
  ie?: string
  im?: string
  /** 1 = Simples Nacional, 2 = Simples (excesso de sublimite), 3 = Regime normal */
  taxRegime?: '1' | '2' | '3'
  cep?: string
  number?: string
  district?: string
  complement?: string
  /** código IBGE do município do emitente (7 dígitos) */
  cityCode?: string
  fiscalEnvironment?: 'homologacao' | 'producao'
  fiscalSerie?: string
  /** padrões aplicados aos itens da nota: o contador confirma */
  fiscalNature?: string
  fiscalCfop?: string
  fiscalNcm?: string
  fiscalOrigin?: string
  /** CSOSN (Simples) ou CST (regime normal) */
  fiscalTaxSituation?: string
}

export type InvoiceStatus = 'rascunho' | 'processando' | 'autorizada' | 'rejeitada' | 'cancelada'

export interface InvoiceItem {
  id: string
  code: string
  description: string
  ncm: string
  cfop: string
  unit: string
  quantity: number
  unitPrice: number
  total: number
  origin: string
  taxSituation: string
  /** instalação / mão de obra: costuma ir em NFS-e; o usuário decide se entra */
  service?: boolean
}

export interface InvoiceRecipient {
  name: string
  document: string
  ie?: string
  zip?: string
  address?: string
  number?: string
  district?: string
  city?: string
  state?: string
  phone?: string
  email?: string
}

/** Nota fiscal eletrônica (NF-e de produto) emitida por um provedor fiscal a partir de orçamento ou projeto. */
export interface Invoice extends Doc {
  status: InvoiceStatus
  environment: 'homologacao' | 'producao'
  sourceType: 'orcamento' | 'projeto'
  budgetId?: string
  projectId?: string
  clientId?: string
  natureOfOperation: string
  recipient: InvoiceRecipient
  items: InvoiceItem[]
  freight: number
  discount: number
  total: number
  installments?: { number: string; dueDate: string; amount: number }[]
  notes?: string
  /** referência enviada ao provedor (única por nota) */
  ref?: string
  number?: string
  serie?: string
  accessKey?: string
  protocol?: string
  issuedAt?: string
  authorizedAt?: string
  danfeUrl?: string
  xmlUrl?: string
  message?: string
  cancelReason?: string
  cancelledAt?: string
  createdByName?: string
}

export interface StageDef {
  id: string
  label: string
  color: string
}

export interface CollectionMap {
  users: User
  units: Unit
  leads: Lead
  clients: Client
  projects: Project
  taskLists: TaskList
  tasks: Task
  taskComments: TaskComment
  projectDocs: ProjectDoc
  timeEntries: TimeEntry
  budgets: Budget
  contracts: Contract
  boms: Bom
  workCenters: WorkCenter
  productionOrders: ProductionOrder
  cutPlans: CutPlan
  qualityRecords: QualityRecord
  qualityInspections: QualityInspection
  maintenance: MaintenanceRecord
  installations: Installation
  warranties: Warranty
  commissions: Commission
  invoices: Invoice
  materials: Material
  inventoryMovements: InventoryMovement
  inventoryReservations: InventoryReservation
  offcuts: Offcut
  purchases: Purchase
  suppliers: Supplier
  contractors: Contractor
  receivables: Receivable
  payables: Payable
  bankAccounts: BankAccount
  productsServices: ProductService
  vehicles: Vehicle
  events: AgendaEvent
  timeclock: ClockEntry
  files: FileDoc
  auditLogs: AuditLog & Doc
  trash: TrashEntry
}

export type CollectionName = keyof CollectionMap
