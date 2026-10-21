import type { ProductionOrder } from '../types'
import { PAUSE_REASONS, type PauseReason } from '../../shared/shopfloor.mjs'

const ACTIVE = ['liberada', 'em_producao']

export type ScanResult = { kind: 'orders'; orderIds: string[]; label: string; unit?: { planId: string; pieceId: string; n: number } } | { kind: 'none'; message: string }

/**
 * Interpreta o que foi lido no Chão de fábrica: o QR da etiqueta (link do plano de corte com a peça),
 * o código da ordem (OP-…) digitado ou vindo de um leitor de código de barras.
 */
export function resolveScan(text: string, orders: ProductionOrder[], plans: { id: string; projectId?: string; code?: string }[]): ScanResult {
  const raw = text.trim()
  if (!raw) return { kind: 'none', message: 'Nada foi lido.' }
  const active = orders.filter((o) => ACTIVE.includes(o.status))

  let planId: string | null = null
  let unit: { planId: string; pieceId: string; n: number } | undefined
  try {
    const params = new URL(raw).searchParams
    planId = params.get('plano')
    const pieceId = params.get('peca')
    const n = Number(params.get('un'))
    if (planId && pieceId && Number.isInteger(n) && n > 0) unit = { planId, pieceId, n }
  } catch {
    /* não é link: segue como código */
  }

  if (!planId) {
    const code = raw.toUpperCase()
    const byCode = active.filter((o) => (o.code ?? '').toUpperCase() === code)
    if (byCode.length) return { kind: 'orders', orderIds: byCode.map((o) => o.id), label: byCode[0].code ?? code }
    planId = plans.find((p) => (p.code ?? '').toUpperCase() === code)?.id ?? null
    if (!planId) return { kind: 'none', message: `Nenhuma ordem liberada ou em produção com o código "${raw}".` }
  }

  // plano vinculado à ordem; se não estiver, as ordens ativas do projeto do plano
  let linked = active.filter((o) => (o.cutPlanIds ?? []).includes(planId))
  const plan = plans.find((p) => p.id === planId)
  if (!linked.length && plan?.projectId) linked = active.filter((o) => o.projectId === plan.projectId)
  if (!linked.length) return { kind: 'none', message: 'A peça desta etiqueta não está em nenhuma ordem liberada ou em produção.' }
  return { kind: 'orders', orderIds: linked.map((o) => o.id), label: plan?.code ? `Plano ${plan.code}` : 'Peça da etiqueta', unit }
}

type Range = { from: string; to: string; now?: number }
const day = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : '')
const within = (iso: string | null | undefined, r: Range) => Boolean(iso) && day(iso) >= r.from && day(iso) <= r.to

export interface ProductivityLine {
  kind: 'setor' | 'operador'
  name: string
  steps: number
  plannedSeconds: number
  actualSeconds: number
}

/**
 * Previsto x realizado das etapas concluídas no período, por setor e por operador. O tempo de cada
 * operador vem dos trechos que ele trabalhou; o previsto da etapa é repartido na mesma proporção.
 */
export function productivity(orders: ProductionOrder[], sectorName: (id: string) => string, range: Range): ProductivityLine[] {
  const sectors = new Map<string, ProductivityLine>()
  const operators = new Map<string, ProductivityLine>()
  const line = (map: Map<string, ProductivityLine>, kind: ProductivityLine['kind'], name: string) => {
    let cur = map.get(name)
    if (!cur) map.set(name, (cur = { kind, name, steps: 0, plannedSeconds: 0, actualSeconds: 0 }))
    return cur
  }
  for (const order of orders) {
    if (order.status === 'cancelada') continue
    for (const op of order.operations ?? []) {
      if (op.status !== 'concluida' || !within(op.finishedAt, range)) continue
      const planned = (op.plannedMinutes || 0) * 60
      const sector = line(sectors, 'setor', sectorName(op.workCenterId) || op.name || 'Setor')
      sector.steps += 1
      sector.plannedSeconds += planned
      sector.actualSeconds += op.actualSeconds || 0

      const segments = (op.segments ?? []).filter((s) => s.seconds > 0)
      const worked = segments.reduce((sum, s) => sum + s.seconds, 0)
      // etapas apontadas antes do registro por trecho: tudo para o último operador
      const shares = worked ? segments.map((s) => ({ name: s.operatorName || 'Sem operador', seconds: s.seconds })) : [{ name: op.operatorName || 'Sem operador', seconds: op.actualSeconds || 0 }]
      const total = worked || op.actualSeconds || 0
      const counted = new Set<string>()
      for (const share of shares) {
        const cur = line(operators, 'operador', share.name)
        if (!counted.has(share.name)) {
          cur.steps += 1
          counted.add(share.name)
        }
        cur.actualSeconds += share.seconds
        cur.plannedSeconds += total ? (planned * share.seconds) / total : planned / shares.length
      }
    }
  }
  const sort = (map: Map<string, ProductivityLine>) => [...map.values()].sort((a, b) => b.actualSeconds - a.actualSeconds)
  return [...sort(sectors), ...sort(operators)]
}

export interface StopLine {
  reason: PauseReason
  label: string
  planned: boolean
  count: number
  seconds: number
  topSector: string
}

/** Pausas iniciadas no período, somadas por motivo (a pausa ainda aberta conta até agora). */
export function stopsByReason(orders: ProductionOrder[], sectorName: (id: string) => string, range: Range): StopLine[] {
  const now = range.now ?? Date.now()
  const by = new Map<PauseReason, { count: number; seconds: number; sectors: Map<string, number> }>()
  for (const order of orders) {
    for (const op of order.operations ?? []) {
      for (const pause of op.pauses ?? []) {
        if (!within(pause.start, range)) continue
        const seconds = pause.end ? (pause.seconds ?? Math.max(0, (Date.parse(pause.end) - Date.parse(pause.start)) / 1000)) : op.status === 'pausada' ? Math.max(0, (now - Date.parse(pause.start)) / 1000) : 0
        let cur = by.get(pause.reason)
        if (!cur) by.set(pause.reason, (cur = { count: 0, seconds: 0, sectors: new Map() }))
        cur.count += 1
        cur.seconds += seconds
        const sector = sectorName(op.workCenterId) || op.name || 'Setor'
        cur.sectors.set(sector, (cur.sectors.get(sector) ?? 0) + seconds)
      }
    }
  }
  return [...by.entries()]
    .map(([reason, v]) => {
      const meta = PAUSE_REASONS.find((r) => r.value === reason)
      return { reason, label: meta?.label ?? reason, planned: meta?.planned ?? false, count: v.count, seconds: Math.round(v.seconds), topSector: [...v.sectors.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' }
    })
    .sort((a, b) => Number(a.planned) - Number(b.planned) || b.seconds - a.seconds)
}
