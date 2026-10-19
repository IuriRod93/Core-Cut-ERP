import { edgeMetersOf } from './machining.ts'
import type { CutPiece, CutPlan, CutPlanCosts, CutPlanGroup, GcodeParams, Material, WorkCenter } from '../types'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export const DEFAULT_GCODE: GcodeParams = {
  toolDiameter: 6,
  spindleRpm: 18000,
  feedCut: 4500,
  feedPlunge: 1500,
  feedDrill: 1200,
  safeZ: 25,
  passDepth: 7,
  overcut: 0.3,
  tabs: true,
  tabWidth: 12,
  tabHeight: 3,
  peck: 8,
  toolChange: 'm6',
}

export const PLAN_STATUS: { value: CutPlan['status']; label: string; color: string }[] = [
  { value: 'rascunho', label: 'Rascunho', color: '#7d838c' },
  { value: 'aprovado', label: 'Aprovado', color: '#2f6f9f' },
  { value: 'em_corte', label: 'Em corte', color: '#700618' },
  { value: 'concluido', label: 'Concluído', color: '#2e7d4f' },
]

const EDGE_LOSS = 1.1
const EDGE_METERS_PER_MIN = 4

export function totalsOf(pieces: CutPiece[]) {
  let holes = 0
  let grooves = 0
  let grooveLength = 0
  let edgeMeters = 0
  let units = 0
  for (const p of pieces) {
    units += p.quantity
    edgeMeters += edgeMetersOf(p) * p.quantity
    for (const m of p.machining ?? []) {
      if (m.kind === 'furo') holes += p.quantity
      else {
        grooves += p.quantity
        grooveLength += (m.kind === 'rasgo' ? (m.length ?? 0) : 2 * ((m.length ?? 0) + (m.width ?? 0))) * p.quantity
      }
    }
  }
  return { holes, grooves, grooveLength, edgeMeters: round2(edgeMeters), units }
}

export function computeCosts(
  plan: Pick<CutPlan, 'pieces' | 'groups' | 'hardware' | 'mode' | 'edgeMaterialId'> & { gcode?: GcodeParams },
  materials: Map<string, Material>,
  centers: WorkCenter[],
): CutPlanCosts {
  const t = totalsOf(plan.pieces)
  const g = plan.gcode ?? DEFAULT_GCODE
  const rate = (code: string) => centers.find((c) => c.code === code)?.hourlyCost ?? 0
  const sheets = plan.groups.reduce((s: number, x: CutPlanGroup) => s + x.cost, 0)
  const edgeMat = plan.edgeMaterialId ? materials.get(plan.edgeMaterialId) : undefined
  const edge = t.edgeMeters * EDGE_LOSS * (edgeMat?.cost ?? 0)
  const hardware = plan.hardware.reduce((s, h) => s + h.quantity * h.unitCost, 0)

  // tempos estimados (min)
  const sheetsCount = plan.groups.reduce((s, x) => s + x.sheets.length, 0)
  let perimeter = 0
  for (const grp of plan.groups) for (const sh of grp.sheets) for (const p of sh.placements) perimeter += 2 * (p.w + p.h)
  const cutMin = plan.mode === 'cnc' ? perimeter / g.feedCut : sheetsCount * 6 + t.units * 0.4
  const opMin = t.holes * 0.06 + t.grooveLength / g.feedCut + t.grooves * 0.2
  const edgeMin = t.edgeMeters / EDGE_METERS_PER_MIN
  const machining = (cutMin / 60) * rate(plan.mode === 'cnc' ? 'CNC' : 'CORTE') + (opMin / 60) * rate('CNC') + (edgeMin / 60) * rate('BORDA')

  return {
    sheets: round2(sheets),
    edge: round2(edge),
    hardware: round2(hardware),
    machining: round2(machining),
    total: round2(sheets + edge + hardware + machining),
    edgeMeters: t.edgeMeters,
    holes: t.holes,
    grooves: t.grooves,
    minutes: Math.round(cutMin + opMin + edgeMin),
  }
}
