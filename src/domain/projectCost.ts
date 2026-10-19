import { budgetTotals } from './budget.ts'
import type { Budget, Payable, ProductionOrder, Purchase, Receivable, WorkCenter } from '../types'

/**
 * Custo real do projeto: o que o orçamento previu × o que a obra consumiu de fato.
 * Módulo puro (também usado pelo backend e testado sem tela).
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface CostLine {
  key: 'materiais' | 'maoDeObra' | 'despesas'
  label: string
  /** previsto no orçamento */
  planned: number
  /** já pago/recebido/apontado */
  actual: number
  /** pedido ou solicitado, ainda não entregue */
  committed: number
  /** realizado + comprometido */
  projected: number
  /** projetado − previsto (positivo = estourou) */
  variance: number
  variancePercent: number
  hint?: string
}

export interface ProjectCostSummary {
  budgetId?: string
  budgetCode?: string
  /** receita líquida de impostos prevista no orçamento */
  revenue: number
  /** valor recebido dos recebíveis do projeto */
  received: number
  lines: CostLine[]
  planned: number
  actual: number
  committed: number
  projected: number
  variance: number
  variancePercent: number
  /** lucro previsto no orçamento × lucro projetado com os custos reais */
  plannedProfit: number
  projectedProfit: number
  plannedMarginPercent: number
  projectedMarginPercent: number
  /** horas apontadas no chão de fábrica × horas previstas nas ordens */
  hours: { planned: number; actual: number }
  /** situação geral para colorir o painel */
  status: 'ok' | 'atencao' | 'estouro'
}

type PurchaseLike = Pick<Purchase, 'id' | 'projectId' | 'status' | 'items' | 'freight'>

const purchaseTotal = (p: PurchaseLike) => (p.items ?? []).reduce((s, i) => s + i.quantity * i.unitCost, 0) + (p.freight ?? 0)
const receivedValue = (p: PurchaseLike) => (p.items ?? []).reduce((s, i) => s + Math.min(i.received ?? 0, i.quantity) * i.unitCost, 0)

function line(key: CostLine['key'], label: string, planned: number, actual: number, committed: number, hint?: string): CostLine {
  const projected = round2(actual + committed)
  const variance = round2(projected - planned)
  return {
    key,
    label,
    planned: round2(planned),
    actual: round2(actual),
    committed: round2(committed),
    projected,
    variance,
    variancePercent: planned > 0 ? round2((variance / planned) * 100) : 0,
    hint,
  }
}

export function projectCost(input: {
  projectId?: string
  budgets: Pick<Budget, 'id' | 'code' | 'projectId' | 'status' | 'items' | 'laborHours' | 'laborRate' | 'marginPercent' | 'discountPercent' | 'taxPercent' | 'freight' | 'installation' | 'updatedAt'>[]
  purchases: PurchaseLike[]
  payables?: Pick<Payable, 'projectId' | 'status' | 'amount' | 'purchaseId'>[]
  receivables?: Pick<Receivable, 'projectId' | 'status' | 'amount'>[]
  orders?: Pick<ProductionOrder, 'projectId' | 'status' | 'operations'>[]
  workCenters?: Pick<WorkCenter, 'id' | 'hourlyCost'>[]
}): ProjectCostSummary | null {
  if (!input.projectId) return null
  const id = input.projectId
  const mine = input.budgets.filter((b) => b.projectId === id && !['recusado', 'expirado'].includes(b.status))
  const newest = (list: typeof mine) => [...list].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
  const budget = newest(mine.filter((b) => b.status === 'aprovado')) ?? newest(mine)
  if (!budget) return null

  const totals = budgetTotals(budget)

  // compras: recebido conta como realizado; o que falta chegar é comprometido
  let boughtActual = 0
  let boughtCommitted = 0
  for (const p of input.purchases) {
    if (p.projectId !== id) continue
    const total = purchaseTotal(p)
    if (p.status === 'recebido') boughtActual += total
    else if (p.status === 'parcial') {
      const got = receivedValue(p)
      boughtActual += got
      boughtCommitted += Math.max(total - got, 0)
    } else if (['solicitado', 'cotacao', 'aprovado', 'pedido'].includes(p.status)) boughtCommitted += total
  }

  // mão de obra: horas apontadas no chão de fábrica × custo/hora do setor
  const rate = new Map((input.workCenters ?? []).map((w) => [w.id, w.hourlyCost ?? 0]))
  let laborActual = 0
  let seconds = 0
  let plannedMinutes = 0
  for (const o of input.orders ?? []) {
    if (o.projectId !== id || o.status === 'cancelada') continue
    for (const op of o.operations ?? []) {
      seconds += op.actualSeconds ?? 0
      plannedMinutes += op.plannedMinutes ?? 0
      laborActual += ((op.actualSeconds ?? 0) / 3600) * (rate.get(op.workCenterId) ?? 0)
    }
  }

  // outras despesas lançadas no financeiro para o projeto (as das compras já estão nas compras)
  const otherPaid = (input.payables ?? []).filter((p) => p.projectId === id && !p.purchaseId && p.status === 'pago').reduce((s, p) => s + p.amount, 0)
  const otherOpen = (input.payables ?? []).filter((p) => p.projectId === id && !p.purchaseId && p.status === 'pendente').reduce((s, p) => s + p.amount, 0)

  const lines = [
    line('materiais', 'Materiais e itens do orçamento', totals.cost, boughtActual, boughtCommitted, 'Compras do projeto: recebidas × pedidas'),
    line('maoDeObra', 'Mão de obra', totals.labor, laborActual, 0, 'Horas apontadas no chão de fábrica × custo/hora do setor'),
    line('despesas', 'Frete, instalação e outras despesas', totals.extras, otherPaid, otherOpen, 'Contas a pagar do projeto sem compra vinculada'),
  ]

  const planned = round2(lines.reduce((s, l) => s + l.planned, 0))
  const actual = round2(lines.reduce((s, l) => s + l.actual, 0))
  const committed = round2(lines.reduce((s, l) => s + l.committed, 0))
  const projected = round2(actual + committed)
  const variance = round2(projected - planned)
  // receita sem impostos (o imposto sai por dentro do preço)
  const revenue = round2(totals.total - totals.taxes)
  const projectedProfit = round2(revenue - projected)
  const variancePercent = planned > 0 ? round2((variance / planned) * 100) : 0

  return {
    budgetId: budget.id,
    budgetCode: budget.code,
    revenue,
    received: round2((input.receivables ?? []).filter((r) => r.projectId === id && r.status === 'pago').reduce((s, r) => s + r.amount, 0)),
    lines,
    planned,
    actual,
    committed,
    projected,
    variance,
    variancePercent,
    plannedProfit: totals.profit,
    projectedProfit,
    plannedMarginPercent: revenue > 0 ? round2((totals.profit / revenue) * 100) : 0,
    projectedMarginPercent: revenue > 0 ? round2((projectedProfit / revenue) * 100) : 0,
    hours: { planned: round2(plannedMinutes / 60), actual: round2(seconds / 3600) },
    status: variancePercent > 10 ? 'estouro' : variancePercent > 0 ? 'atencao' : 'ok',
  }
}
