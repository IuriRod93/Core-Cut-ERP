import { round2 } from '../lib/format.ts'
import type { Budget } from '../types'

export interface BudgetTotals {
  cost: number // custo direto dos itens
  labor: number
  subtotalCost: number
  price: number // soma dos preços de venda dos itens
  margin: number // valor da margem aplicada
  discount: number
  taxes: number
  extras: number // frete + instalação
  total: number
  profit: number
  profitPercent: number
}

/**
 * Totais do orçamento.
 * - Cada item possui custo unitário e preço unitário (pré-calculado a partir do custo e da margem
 *   padrão, mas editável).
 * - A margem global é aplicada sobre o custo dos itens SEM preço próprio.
 */
export function budgetTotals(b: Pick<Budget, 'items' | 'laborHours' | 'laborRate' | 'marginPercent' | 'discountPercent' | 'taxPercent' | 'freight' | 'installation'>): BudgetTotals {
  const margin = (b.marginPercent ?? 0) / 100
  let cost = 0
  let price = 0
  for (const it of b.items) {
    const c = it.quantity * it.unitCost
    cost += c
    price += it.unitPrice > 0 ? it.quantity * it.unitPrice : c * (1 + margin)
  }
  const labor = (b.laborHours ?? 0) * (b.laborRate ?? 0)
  const laborPrice = labor * (1 + margin)
  const extras = (b.freight ?? 0) + (b.installation ?? 0)
  const gross = price + laborPrice + extras
  const discount = gross * ((b.discountPercent ?? 0) / 100)
  const net = gross - discount
  // impostos "por dentro": o preço final já contém a alíquota
  const taxRate = (b.taxPercent ?? 0) / 100
  const total = taxRate > 0 && taxRate < 1 ? net / (1 - taxRate) : net
  const taxes = total - net
  const subtotalCost = cost + labor
  const profit = net - subtotalCost - extras
  return {
    cost: round2(cost),
    labor: round2(labor),
    subtotalCost: round2(subtotalCost),
    price: round2(price + laborPrice),
    margin: round2(price + laborPrice - subtotalCost),
    discount: round2(discount),
    taxes: round2(taxes),
    extras: round2(extras),
    total: round2(total),
    profit: round2(profit),
    profitPercent: net > 0 ? round2((profit / net) * 100) : 0,
  }
}
