import { round2 } from '../lib/format'
import type { Bom, BomPart, Material, WorkCenter } from '../types'

/** Fator de aproveitamento padrão de chapas ao precificar sem plano de corte. */
export const DEFAULT_YIELD = 0.82

export const sheetAreaM2 = (m?: Pick<Material, 'sheetWidth' | 'sheetHeight'> | null) =>
  m?.sheetWidth && m?.sheetHeight ? (m.sheetWidth * m.sheetHeight) / 1_000_000 : 0

export const costPerM2 = (m?: Material | null) => {
  const area = sheetAreaM2(m)
  return m && area > 0 ? m.cost / area : m?.cost ?? 0
}

export const partAreaM2 = (p: Pick<BomPart, 'length' | 'width' | 'quantity'>) => (p.length * p.width * p.quantity) / 1_000_000

export const partEdgeMeters = (p: BomPart) => {
  const lengths = (p.edgeTop ? 1 : 0) + (p.edgeBottom ? 1 : 0)
  const widths = (p.edgeLeft ? 1 : 0) + (p.edgeRight ? 1 : 0)
  return ((lengths * p.length + widths * p.width) / 1000) * p.quantity
}

export interface BomCost {
  materials: number
  edge: number
  hardware: number
  labor: number
  total: number
  areaM2: number
  edgeMeters: number
  minutes: number
}

export function bomCost(bom: Bom, materials: Map<string, Material>, centers: Map<string, WorkCenter>, yieldFactor = DEFAULT_YIELD): BomCost {
  let materialsCost = 0
  let areaTotal = 0
  let edgeMeters = 0
  for (const p of bom.parts) {
    const mat = p.materialId ? materials.get(p.materialId) : undefined
    const area = partAreaM2(p)
    areaTotal += area
    if (mat) materialsCost += (area * costPerM2(mat)) / yieldFactor
    edgeMeters += partEdgeMeters(p)
  }
  const edgeMat = bom.edgeMaterialId ? materials.get(bom.edgeMaterialId) : undefined
  const edge = edgeMat ? edgeMeters * edgeMat.cost : 0
  const hardware = bom.hardware.reduce((s, h) => s + (h.materialId ? (materials.get(h.materialId)?.cost ?? 0) * h.quantity : 0), 0)
  const minutes = bom.routing.reduce((s, r) => s + r.minutes, 0)
  const labor = bom.routing.reduce((s, r) => s + (r.minutes / 60) * (centers.get(r.workCenterId)?.hourlyCost ?? 0), 0)
  return {
    materials: round2(materialsCost),
    edge: round2(edge),
    hardware: round2(hardware),
    labor: round2(labor),
    total: round2(materialsCost + edge + hardware + labor),
    areaM2: round2(areaTotal),
    edgeMeters: round2(edgeMeters),
    minutes,
  }
}

export interface MaterialNeed {
  key: string
  materialId?: string
  description: string
  unit: string
  quantity: number
  kind: 'chapa' | 'fita' | 'ferragem'
}

/**
 * Explode a lista de materiais (BOM) de itens de produção em necessidades de compra.
 * Chapas em m² → quantidade de chapas considerando o aproveitamento.
 */
export function explodeNeeds(
  items: { bomId?: string; quantity: number }[],
  boms: Map<string, Bom>,
  materials: Map<string, Material>,
  yieldFactor = DEFAULT_YIELD,
): MaterialNeed[] {
  const areaBy = new Map<string, number>()
  const edgeBy = new Map<string, number>()
  const hwBy = new Map<string, number>()
  for (const it of items) {
    const bom = it.bomId ? boms.get(it.bomId) : undefined
    if (!bom) continue
    for (const p of bom.parts) {
      if (!p.materialId) continue
      areaBy.set(p.materialId, (areaBy.get(p.materialId) ?? 0) + partAreaM2(p) * it.quantity)
      if (bom.edgeMaterialId) edgeBy.set(bom.edgeMaterialId, (edgeBy.get(bom.edgeMaterialId) ?? 0) + partEdgeMeters(p) * it.quantity)
    }
    for (const h of bom.hardware) if (h.materialId) hwBy.set(h.materialId, (hwBy.get(h.materialId) ?? 0) + h.quantity * it.quantity)
  }
  const needs: MaterialNeed[] = []
  for (const [id, area] of areaBy) {
    const m = materials.get(id)
    const sheet = sheetAreaM2(m)
    needs.push({
      key: `c-${id}`,
      materialId: id,
      description: m?.name ?? 'Chapa',
      unit: m?.unit ?? 'chapa',
      quantity: sheet > 0 ? Math.ceil(area / yieldFactor / sheet) : round2(area / yieldFactor),
      kind: 'chapa',
    })
  }
  for (const [id, meters] of edgeBy) {
    const m = materials.get(id)
    needs.push({ key: `f-${id}`, materialId: id, description: m?.name ?? 'Fita de borda', unit: m?.unit ?? 'm', quantity: Math.ceil(meters * 1.1), kind: 'fita' })
  }
  for (const [id, qty] of hwBy) {
    const m = materials.get(id)
    needs.push({ key: `h-${id}`, materialId: id, description: m?.name ?? 'Ferragem', unit: m?.unit ?? 'un', quantity: Math.ceil(qty), kind: 'ferragem' })
  }
  return needs
}
