import { budgetTotals } from './budget.ts'
import type { Budget, Client, CompanySettings, Contract, Invoice, InvoiceItem, InvoiceRecipient, Project } from '../types'

/**
 * Rascunho de nota fiscal a partir de um orçamento aprovado ou de um projeto.
 * Módulo puro: os valores batem com o total do orçamento (impostos "por dentro" já embutidos no preço)
 * e o servidor recalcula tudo de novo antes de enviar ao provedor.
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const round4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000

export type InvoiceDraft = Pick<Invoice, 'sourceType' | 'budgetId' | 'projectId' | 'clientId' | 'natureOfOperation' | 'recipient' | 'items' | 'freight' | 'discount' | 'total' | 'installments' | 'notes'>

export const FISCAL_DEFAULTS = {
  nature: 'Venda de mercadoria',
  ncm: '94036000',
  cfop: '5101',
  origin: '0',
}

const UNIT: Record<string, string> = { 'm²': 'M2', m2: 'M2', 'm³': 'M3', un: 'UN', und: 'UN', unid: 'UN', pç: 'PC', pc: 'PC', peça: 'PC', m: 'M', ml: 'M', kg: 'KG', h: 'H', hora: 'H', cj: 'CJ', jogo: 'CJ' }
export const unitCode = (unit?: string) => UNIT[String(unit ?? 'un').trim().toLowerCase()] ?? (String(unit ?? 'UN').trim().toUpperCase().slice(0, 4) || 'UN')

/** Linha do destinatário a partir do cadastro do cliente (os campos que faltarem aparecem para preencher). */
export function recipientFromClient(client?: Pick<Client, 'name' | 'document' | 'ie' | 'zip' | 'address' | 'number' | 'district' | 'city' | 'state' | 'phone' | 'email'>): InvoiceRecipient {
  return {
    name: client?.name ?? '',
    document: client?.document ?? '',
    ie: client?.ie ?? '',
    zip: client?.zip ?? '',
    address: client?.address ?? '',
    number: client?.number ?? '',
    district: client?.district ?? '',
    city: client?.city ?? '',
    state: (client?.state ?? '').toUpperCase(),
    phone: client?.phone ?? '',
    email: client?.email ?? '',
  }
}

/** Padrões fiscais da empresa: CFOP muda para operação interestadual (5xxx → 6xxx). */
export function itemDefaults(company: Partial<CompanySettings>, recipientState?: string) {
  const sameState = !recipientState || !company.state || recipientState.toUpperCase() === String(company.state).toUpperCase()
  const base = String(company.fiscalCfop || FISCAL_DEFAULTS.cfop)
  const cfop = sameState || !base.startsWith('5') ? base : `6${base.slice(1)}`
  return {
    ncm: String(company.fiscalNcm || FISCAL_DEFAULTS.ncm),
    cfop,
    origin: String(company.fiscalOrigin || FISCAL_DEFAULTS.origin),
    taxSituation: String(company.fiscalTaxSituation || (company.taxRegime === '3' ? '00' : '102')),
  }
}

const notesFor = (company: Partial<CompanySettings>, refs: string[]) =>
  [
    refs.filter(Boolean).join(' · '),
    company.taxRegime === '1' || company.taxRegime === '2' ? 'DOCUMENTO EMITIDO POR ME OU EPP OPTANTE PELO SIMPLES NACIONAL. NÃO GERA DIREITO A CRÉDITO FISCAL DE IPI.' : '',
  ]
    .filter(Boolean)
    .join('\n')

let counter = 0
const newId = () => `i${Date.now().toString(36)}${(counter += 1)}`

export interface BudgetDraftOptions {
  /** instalação e mão de obra entram na nota de produto (normalmente vão em NFS-e) */
  includeServices?: boolean
}

export function invoiceDraftFromBudget(input: {
  budget: Budget
  client?: Client
  project?: Pick<Project, 'code' | 'name'>
  contract?: Pick<Contract, 'code' | 'installments'>
  company: Partial<CompanySettings>
  options?: BudgetDraftOptions
}): InvoiceDraft {
  const { budget, client, project, contract, company } = input
  const includeServices = input.options?.includeServices ?? true
  const recipient = recipientFromClient(client)
  const defaults = itemDefaults(company, recipient.state)

  const margin = (budget.marginPercent ?? 0) / 100
  const taxRate = (budget.taxPercent ?? 0) / 100
  // o preço do orçamento já "carrega" o imposto por dentro: a nota precisa fechar no mesmo total
  const scale = taxRate > 0 && taxRate < 1 ? 1 / (1 - taxRate) : 1

  const items: InvoiceItem[] = []
  for (const [index, it] of budget.items.entries()) {
    const unit = (it.unitPrice > 0 ? it.unitPrice : it.unitCost * (1 + margin)) * scale
    if (!(it.quantity > 0) || !(unit > 0)) continue
    const service = it.kind === 'servico'
    if (service && !includeServices) continue
    items.push({
      id: newId(),
      code: String(index + 1).padStart(3, '0'),
      description: [it.group && it.group !== 'Itens' ? it.group : '', it.description].filter(Boolean).join(' — ').slice(0, 120),
      unit: unitCode(it.unit),
      quantity: it.quantity,
      unitPrice: round4(unit),
      total: round2(it.quantity * round4(unit)),
      service,
      ...defaults,
    })
  }
  const laborHours = budget.laborHours ?? 0
  const laborRate = budget.laborRate ?? 0
  if (includeServices && laborHours > 0 && laborRate > 0) {
    const unit = round4(laborRate * (1 + margin) * scale)
    items.push({ id: newId(), code: 'MO', description: 'Mão de obra de montagem', unit: 'H', quantity: laborHours, unitPrice: unit, total: round2(laborHours * unit), service: true, ...defaults })
  }
  if (includeServices && (budget.installation ?? 0) > 0) {
    const unit = round4((budget.installation ?? 0) * scale)
    items.push({ id: newId(), code: 'INST', description: 'Instalação', unit: 'UN', quantity: 1, unitPrice: unit, total: unit, service: true, ...defaults })
  }

  const products = round2(items.reduce((s, i) => s + i.total, 0))
  const freight = round2((budget.freight ?? 0) * scale)
  // desconto proporcional ao que entrou na nota
  const discount = round2((products + freight) * ((budget.discountPercent ?? 0) / 100))
  const total = round2(products + freight - discount)

  return {
    sourceType: 'orcamento',
    budgetId: budget.id,
    projectId: budget.projectId ?? undefined,
    clientId: budget.clientId,
    natureOfOperation: company.fiscalNature || FISCAL_DEFAULTS.nature,
    recipient,
    items,
    freight,
    discount,
    total,
    installments: scaleInstallments(contract, total),
    notes: notesFor(company, [budget.code ? `Orçamento ${budget.code}` : '', project?.code ? `Projeto ${project.code}${project.name ? ` — ${project.name}` : ''}` : '', contract?.code ? `Contrato ${contract.code}` : '']),
  }
}

/** Projeto sem orçamento detalhado: uma linha única com o valor aprovado. */
export function invoiceDraftFromProject(input: {
  project: Project
  client?: Client
  value: number
  budgetCode?: string
  contract?: Pick<Contract, 'code' | 'installments'>
  company: Partial<CompanySettings>
}): InvoiceDraft {
  const { project, client, company } = input
  const recipient = recipientFromClient(client)
  const defaults = itemDefaults(company, recipient.state)
  const value = round2(input.value)
  return {
    sourceType: 'projeto',
    projectId: project.id,
    clientId: project.clientId,
    natureOfOperation: company.fiscalNature || FISCAL_DEFAULTS.nature,
    recipient,
    items: [
      {
        id: newId(),
        code: project.code ?? 'PRJ',
        description: `Mobiliário planejado sob medida — ${project.name}`.slice(0, 120),
        unit: 'UN',
        quantity: 1,
        unitPrice: value,
        total: value,
        ...defaults,
      },
    ],
    freight: 0,
    discount: 0,
    total: value,
    installments: scaleInstallments(input.contract, value),
    notes: notesFor(company, [input.budgetCode ? `Orçamento ${input.budgetCode}` : '', project.code ? `Projeto ${project.code}` : '', input.contract?.code ? `Contrato ${input.contract.code}` : '']),
  }
}

/** Parcelas do contrato ajustadas ao valor da nota (a soma das faturas precisa fechar com o total). */
function scaleInstallments(contract: Pick<Contract, 'installments'> | undefined, total: number) {
  const list = contract?.installments ?? []
  const sum = list.reduce((s, i) => s + i.amount, 0)
  if (!list.length || !(sum > 0) || !(total > 0)) return []
  let accumulated = 0
  return list.map((p, index) => {
    const amount = index === list.length - 1 ? round2(total - accumulated) : round2((p.amount / sum) * total)
    accumulated += amount
    return { number: String(index + 1).padStart(3, '0'), dueDate: p.dueDate, amount }
  })
}

/** Valor da nota se tudo do orçamento entrasse (para comparar com o total do orçamento na prévia). */
export const budgetTotalForInvoice = (budget: Budget) => budgetTotals(budget).total
