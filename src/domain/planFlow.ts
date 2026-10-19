import { budgetTotals } from './budget.ts'
import type { Budget, BudgetItem, CutPlan, Material, Purchase } from '../types'

/**
 * Regras que ligam um plano de corte otimizado ao orçamento do projeto e às compras.
 * Módulo puro (também usado pelo backend).
 */

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const EDGE_LOSS = 1.1

type MaterialLike = Pick<Material, 'id' | 'name' | 'category' | 'unit' | 'cost' | 'stock' | 'supplierId'> & Partial<Pick<Material, 'thickness' | 'sheetWidth' | 'sheetHeight'>>
type PlanLike = Pick<CutPlan, 'groups' | 'hardware' | 'costs' | 'edgeMaterialId'> & Partial<Pick<CutPlan, 'id' | 'code' | 'title'>>

export interface PlanNeed {
  key: string
  kind: 'chapa' | 'fita' | 'ferragem'
  materialId?: string
  description: string
  unit: string
  /** quantidade necessária segundo o plano */
  quantity: number
  unitCost: number
  /** saldo em estoque (quando o item é do estoque) */
  stock: number
  /** sugestão de compra = necessidade − saldo, nunca negativa */
  toBuy: number
  supplierId?: string
}

/** Necessidades de material do plano: chapas por material, fita de borda e ferragens. */
export function planNeeds(plan: PlanLike, materials: Map<string, MaterialLike>): PlanNeed[] {
  const out: PlanNeed[] = []
  for (const g of plan.groups ?? []) {
    // retalho do estoque não é chapa a comprar
    if (g.offcutId) continue
    const sheets = g.sheets.length
    if (!sheets) continue
    const mat = g.materialId ? materials.get(g.materialId) : undefined
    const unitCost = sheets ? round2(g.cost / sheets) : g.sheetCost
    out.push({
      key: `chapa:${g.key}`,
      kind: 'chapa',
      materialId: g.materialId,
      description: `${g.materialName}${g.sheetWidth ? ` · ${g.sheetWidth}×${g.sheetHeight} mm` : ''}`,
      unit: 'chapa',
      quantity: sheets,
      unitCost,
      stock: mat?.stock ?? 0,
      toBuy: Math.max(sheets - (mat?.stock ?? 0), 0),
      supplierId: mat?.supplierId,
    })
  }
  const edgeMeters = plan.costs?.edgeMeters ?? 0
  if (edgeMeters > 0) {
    const mat = plan.edgeMaterialId ? materials.get(plan.edgeMaterialId) : undefined
    const qty = round2(edgeMeters * EDGE_LOSS)
    out.push({
      key: 'fita',
      kind: 'fita',
      materialId: mat?.id,
      description: `Fita de borda${mat ? ` ${mat.name}` : ''} (${String(edgeMeters).replace('.', ',')} m + 10% de perda)`,
      unit: 'm',
      quantity: qty,
      unitCost: mat?.cost ?? 0,
      stock: mat?.stock ?? 0,
      toBuy: Math.max(round2(qty - (mat?.stock ?? 0)), 0),
      supplierId: mat?.supplierId,
    })
  }
  for (const h of plan.hardware ?? []) {
    if (!(h.quantity > 0)) continue
    const mat = h.materialId ? materials.get(h.materialId) : undefined
    out.push({
      key: `ferragem:${h.id}`,
      kind: 'ferragem',
      materialId: mat?.id,
      description: h.description,
      unit: mat?.unit ?? 'un',
      quantity: h.quantity,
      unitCost: h.unitCost,
      stock: mat?.stock ?? 0,
      toBuy: Math.max(round2(h.quantity - (mat?.stock ?? 0)), 0),
      supplierId: mat?.supplierId,
    })
  }
  return out
}

/** Itens de orçamento mantidos por um plano (custo direto; a margem do orçamento se aplica a eles). */
export function budgetItemsFromPlan(plan: PlanLike & Pick<CutPlan, 'id'>, materials: Map<string, MaterialLike>, idFn: () => string): BudgetItem[] {
  const group = `Plano de corte${plan.code ? ` ${plan.code}` : ''}${plan.title ? ` — ${plan.title}` : ''}`.slice(0, 120)
  const items: BudgetItem[] = planNeeds(plan, materials).map((n) => ({
    id: idFn(),
    group,
    description: n.kind === 'chapa' ? `Chapa ${n.description}` : n.description,
    kind: n.kind === 'ferragem' ? 'ferragem' : 'material',
    unit: n.unit,
    quantity: n.quantity,
    unitCost: n.unitCost,
    unitPrice: 0,
    materialId: n.materialId,
    cutPlanId: plan.id,
  }))
  const machining = plan.costs?.machining ?? 0
  if (machining > 0) {
    items.push({
      id: idFn(),
      group,
      description: `Usinagem e mão de obra do corte (${plan.costs.minutes} min)`,
      kind: 'servico',
      unit: 'un',
      quantity: 1,
      unitCost: machining,
      unitPrice: 0,
      cutPlanId: plan.id,
    })
  }
  return items
}

/** Soma de custo direto dos itens (para conferência). */
export const itemsCost = (items: Pick<BudgetItem, 'quantity' | 'unitCost'>[]) => round2(items.reduce((s, i) => s + i.quantity * i.unitCost, 0))

// --------------------------------------------------- saldo do orçamento do projeto

export interface ProjectPurchaseBalance {
  budgetId?: string
  budgetCode?: string
  /** valor (preço de venda) do orçamento do projeto */
  budgetTotal: number
  /** custo direto de materiais e ferragens previsto no orçamento */
  materialsBudget: number
  /** compras do projeto já solicitadas, aprovadas, pedidas ou recebidas */
  committed: number
  /** valor da solicitação em análise (ainda não gravada) */
  request: number
  /** orçamento − compras − esta solicitação */
  balance: number
  /** verba de materiais − compras − esta solicitação */
  materialsBalance: number
}

const COUNTED_PURCHASE = new Set(['solicitado', 'cotacao', 'aprovado', 'pedido', 'parcial', 'recebido'])
const purchaseValue = (p: Pick<Purchase, 'items' | 'freight'>) => round2((p.items ?? []).reduce((s, i) => s + i.quantity * i.unitCost, 0) + (p.freight ?? 0))

/**
 * Quanto do orçamento do projeto ainda sobra depois das compras. O orçamento considerado é o aprovado mais recente
 * (ou, sem aprovação, o rascunho/enviado mais recente); recusados e vencidos não contam.
 */
export function projectPurchaseBalance(input: {
  projectId?: string
  budgets: Pick<Budget, 'id' | 'code' | 'projectId' | 'status' | 'items' | 'laborHours' | 'laborRate' | 'marginPercent' | 'discountPercent' | 'taxPercent' | 'freight' | 'installation' | 'updatedAt'>[]
  purchases: Pick<Purchase, 'id' | 'projectId' | 'status' | 'items' | 'freight'>[]
  request?: number
  excludePurchaseIds?: string[]
}): ProjectPurchaseBalance | null {
  if (!input.projectId) return null
  const mine = input.budgets.filter((b) => b.projectId === input.projectId && !['recusado', 'expirado'].includes(b.status))
  const newest = (list: typeof mine) => [...list].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0]
  const budget = newest(mine.filter((b) => b.status === 'aprovado')) ?? newest(mine)
  if (!budget) return null
  const skip = new Set(input.excludePurchaseIds ?? [])
  const committed = round2(input.purchases.filter((p) => p.projectId === input.projectId && COUNTED_PURCHASE.has(p.status) && !skip.has(p.id)).reduce((s, p) => s + purchaseValue(p), 0))
  const budgetTotal = budgetTotals(budget).total
  const materialsBudget = round2(budget.items.filter((i) => i.kind === 'material' || i.kind === 'ferragem').reduce((s, i) => s + i.quantity * i.unitCost, 0))
  const request = round2(input.request ?? 0)
  return {
    budgetId: budget.id,
    budgetCode: budget.code,
    budgetTotal,
    materialsBudget,
    committed,
    request,
    balance: round2(budgetTotal - committed - request),
    materialsBalance: round2(materialsBudget - committed - request),
  }
}
