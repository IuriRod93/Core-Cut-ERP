import { offsetPolygon, pieceToSheet } from './machining.ts'
import type { CutPiece, CutPlacement, CutPlanGroup, GcodeParams, Machining } from '../types'

export interface GcodeContext {
  title: string
  code?: string
  projectName?: string
  responsibleName?: string
  mode: 'seccionadora' | 'cnc'
  kerf: number
}

export interface GcodeResult {
  filename: string
  code: string
  holes: number
  grooves: number
  contours: number
  tools: { name: string; uses: number }[]
  minutes: number
  warnings: string[]
}

const num = (v: number) => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3)
  return s.replace(/\.?0+$/, '') || '0'
}
const ascii = (s: string) =>
  s
    .replace(/Ø/g, 'D')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^ -~]/g, '')
const clean = (s: string) => ascii(s).replace(/[()]/g, '').trim()

interface Op {
  placement: CutPlacement
  piece: CutPiece
  m: Machining
  x: number
  y: number
}

/**
 * Gera o programa ISO (G-code) de uma chapa. Coordenadas: origem no canto inferior
 * esquerdo da chapa, X ao longo do comprimento, Z0 na face superior do material.
 *
 * Ordem: 1) furações por diâmetro  2) rasgos e recortes  3) contornos das peças.
 * Somente usinagens da face de topo são geradas; furos de borda e da face inferior são listados em aviso.
 */
export function generateGcode(ctx: GcodeContext, group: CutPlanGroup, sheetIndex: number, pieces: CutPiece[], p: GcodeParams): GcodeResult {
  const sheet = group.sheets[sheetIndex]
  const warnings: string[] = []
  const H = group.sheetHeight
  const thickness = group.thickness > 0 ? group.thickness : 18
  if (!(group.thickness > 0)) warnings.push('Espessura da chapa não informada: usando 18 mm.')
  if (ctx.mode !== 'cnc') warnings.push('O plano está em modo seccionadora; o G-code assume corte por fresa (Router CNC).')
  if (ctx.kerf < p.toolDiameter) warnings.push(`A folga entre peças (${ctx.kerf} mm) é menor que a fresa (Ø${p.toolDiameter} mm): ajuste o plano para o modo CNC.`)
  const r = p.toolDiameter / 2
  const byId = new Map(pieces.map((x) => [x.id, x]))
  const mx = (sx: number) => sx
  const my = (sy: number) => H - sy

  const lines: string[] = []
  const emit = (l: string) => lines.push(ascii(l))
  let feedMm = 0
  let rapidMm = 0
  let holeCount = 0
  let last = { x: 0, y: 0 }
  const toolUse = new Map<string, number>()

  const rapidXY = (x: number, y: number) => {
    rapidMm += Math.hypot(x - last.x, y - last.y)
    last = { x, y }
    emit(`G0 X${num(x)} Y${num(y)}`)
  }
  const cutXY = (x: number, y: number, f?: number) => {
    feedMm += Math.hypot(x - last.x, y - last.y)
    last = { x, y }
    emit(`G1 X${num(x)} Y${num(y)}${f ? ` F${f}` : ''}`)
  }

  // ---------- coleta das operações
  const holes: Op[] = []
  const slots: Op[] = []
  const edgeHoles: Op[] = []
  const bottomHoles: Op[] = []
  for (const pl of sheet.placements) {
    const piece = byId.get(pl.pieceId)
    if (!piece) continue
    for (const m of piece.machining ?? []) {
      const pt = pieceToSheet(pl, piece, m.x, m.y)
      const op = { placement: pl, piece, m, x: mx(pt.x), y: my(pt.y) }
      if (m.kind === 'furo') (m.face === 'topo' ? holes : m.face === 'fundo' ? bottomHoles : edgeHoles).push(op)
      else if (m.face === 'fundo') bottomHoles.push(op)
      else slots.push(op)
    }
  }
  if (edgeHoles.length) warnings.push(`${edgeHoles.length} furo(s) de borda não entram no G-code (exigem cabeçote horizontal ou furadeira manual).`)
  if (bottomHoles.length) warnings.push(`${bottomHoles.length} usinagem(ns) da face inferior não entram no G-code (exigem virar a peça).`)

  emit('%')
  emit(`(CORE CUT ERP - ${clean(ctx.code ?? '')} ${clean(ctx.title)})`)
  if (ctx.projectName) emit(`(PROJETO: ${clean(ctx.projectName)})`)
  if (ctx.responsibleName) emit(`(RESPONSAVEL: ${clean(ctx.responsibleName)})`)
  emit(`(MATERIAL: ${clean(group.materialName)})`)
  emit(`(CHAPA ${sheet.index} DE ${group.sheets.length} - ${group.sheetWidth} X ${group.sheetHeight} X ${thickness} MM - ${sheet.placements.length} PECAS)`)
  emit(`(ORIGEM X0 Y0 NO CANTO INFERIOR ESQUERDO - Z0 NA FACE SUPERIOR)`)
  emit('G21 G90 G17 G40 G49 G54')
  emit(`G0 Z${num(p.safeZ)}`)

  let toolNo = 0
  const changeTool = (name: string) => {
    toolNo += 1
    emit('M5')
    emit(`(FERRAMENTA T${toolNo}: ${clean(name)})`)
    emit(p.toolChange === 'm6' ? `T${toolNo} M6` : 'M0')
    emit(`M3 S${p.spindleRpm}`)
    toolUse.set(name, 0)
  }

  const order = <T extends { x: number; y: number }>(list: T[]) => {
    // varredura em serpentina por faixas de 200 mm para reduzir deslocamentos
    const band = (v: T) => Math.floor(v.y / 200)
    return [...list].sort((a, b) => band(a) - band(b) || (band(a) % 2 === 0 ? a.x - b.x : b.x - a.x))
  }

  // ---------- 1) furações
  const diameters = [...new Set(holes.map((h) => h.m.diameter ?? 5))].sort((a, b) => a - b)
  for (const d of diameters) {
    const set = order(holes.filter((h) => (h.m.diameter ?? 5) === d))
    const name = `Broca Ø${d} mm`
    emit('')
    emit(`(FURACOES Ø${d} MM - ${set.length} FUROS)`)
    changeTool(name)
    for (const h of set) {
      const depth = Math.min(h.m.depth, thickness + p.overcut)
      rapidXY(h.x, h.y)
      emit(`G0 Z${num(Math.min(3, p.safeZ))}`)
      if (p.peck > 0 && depth > p.peck) {
        let z = 0
        while (z < depth) {
          z = Math.min(z + p.peck, depth)
          emit(`G1 Z${num(-z)} F${p.feedDrill}`)
          if (z < depth) emit(`G0 Z${num(Math.min(3, p.safeZ))}`)
        }
      } else emit(`G1 Z${num(-depth)} F${p.feedDrill}`)
      emit(`G0 Z${num(p.safeZ)}`)
      holeCount += 1
      feedMm += depth * 2
      toolUse.set(name, (toolUse.get(name) ?? 0) + 1)
    }
  }

  // ---------- 2) rasgos e recortes (fresa)
  const routerName = `Fresa Ø${p.toolDiameter} mm`
  const lvl = (target: number) => {
    const out: number[] = []
    let z = 0
    while (z < target - 1e-6) {
      z = Math.min(z + p.passDepth, target)
      out.push(-z)
    }
    return out
  }

  if (slots.length || sheet.placements.length) {
    emit('')
    changeTool(routerName)
  }
  if (slots.length) emit(`(RASGOS E RECORTES - ${slots.length})`)
  let slotCount = 0
  for (const s of order(slots)) {
    const depth = Math.min(s.m.depth, thickness - 0.5)
    const pl = s.placement
    const L = s.m.length ?? 0
    const W = s.m.width ?? 0
    const corner = (lx: number, ly: number) => {
      const pt = pieceToSheet(pl, s.piece, lx, ly)
      return { x: mx(pt.x), y: my(pt.y) }
    }
    emit(`(${s.m.kind === 'rasgo' ? 'RASGO' : 'RECORTE'} - ${clean(s.piece.label)})`)
    if (s.m.kind === 'rasgo') {
      const extra = Math.max(W - p.toolDiameter, 0)
      const passes = extra < p.toolDiameter * 0.25 ? 1 : Math.ceil(extra / (p.toolDiameter * 0.8)) + 1
      const span = Math.max(W - p.toolDiameter, 0)
      const alongY = s.m.axis === 'y'
      // deslocamento lateral perpendicular ao eixo do rasgo, em coordenadas locais
      for (let i = 0; i < passes; i++) {
        const off = passes === 1 ? 0 : -span / 2 + (span / (passes - 1)) * i
        const a2 = alongY ? corner(s.m.x + off, s.m.y) : corner(s.m.x, s.m.y + off)
        const b2 = alongY ? corner(s.m.x + off, s.m.y + L) : corner(s.m.x + L, s.m.y + off)
        rapidXY(a2.x, a2.y)
        for (const z of lvl(depth)) {
          emit(`G1 Z${num(z)} F${p.feedPlunge}`)
          cutXY(b2.x, b2.y, p.feedCut)
          emit(`G0 Z${num(Math.min(2, p.safeZ))}`)
          rapidXY(a2.x, a2.y)
        }
        emit(`G0 Z${num(p.safeZ)}`)
      }
    } else {
      // recorte: contornos concêntricos de fora para dentro
      const step = p.toolDiameter * 0.8
      let inset = r
      const rings: [number, number, number, number][] = []
      while (inset * 2 < Math.min(L, W) + 1e-6) {
        rings.push([s.m.x + inset, s.m.y + inset, s.m.x + L - inset, s.m.y + W - inset])
        inset += step
      }
      for (const z of lvl(depth)) {
        for (const ring of rings) {
          const [x0, y0, x1, y1] = ring
          const pts = [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1), corner(x0, y0)]
          rapidXY(pts[0].x, pts[0].y)
          emit(`G1 Z${num(z)} F${p.feedPlunge}`)
          pts.slice(1).forEach((q) => cutXY(q.x, q.y, p.feedCut))
          emit(`G0 Z${num(Math.min(2, p.safeZ))}`)
        }
      }
      emit(`G0 Z${num(p.safeZ)}`)
    }
    slotCount += 1
  }

  // ---------- 3) contornos
  emit('')
  emit(`(CONTORNOS - ${sheet.placements.length} PECAS)`)
  const through = thickness + p.overcut
  const tabZ = -(thickness - p.tabHeight)
  const placements = [...sheet.placements].map((pl) => ({ x: pl.x, y: my(pl.y + pl.h), w: pl.w, h: pl.h, pl }))
  for (const c of order(placements.map((q) => ({ ...q, x: q.x, y: q.y })))) {
    const x0 = c.x - r
    const y0 = c.y - r
    const x1 = c.x + c.w + r
    const y1 = c.y + c.h + r
    const piece = byId.get(c.pl.pieceId)
    // contorno: retângulo da peça ou, para peças em L etc., o polígono real deslocado pelo raio da fresa
    let ring = [
      { x: x0, y: y0 },
      { x: x0, y: y1 },
      { x: x1, y: y1 },
      { x: x1, y: y0 },
    ]
    if (piece?.contour && piece.contour.length > 4) {
      const poly = piece.contour.map((q) => {
        const t = pieceToSheet(c.pl, piece, q.x, q.y)
        return { x: mx(t.x), y: my(t.y) }
      })
      ring = offsetPolygon(poly, r)
    }
    emit(`(PECA ${clean(c.pl.label)} ${num(c.w)} X ${num(c.h)})`)
    rapidXY(ring[0].x, ring[0].y)
    emit(`G0 Z${num(Math.min(3, p.safeZ))}`)
    const sides: [number, number, number, number][] = ring.map((a, i) => {
      const b = ring[(i + 1) % ring.length]
      return [a.x, a.y, b.x, b.y]
    })
    for (const z of lvl(through)) {
      emit(`G1 Z${num(z)} F${p.feedPlunge}`)
      const useTabs = p.tabs && z < tabZ - 1e-6
      for (const [ax, ay, bx, by] of sides) {
        const len = Math.hypot(bx - ax, by - ay)
        if (useTabs && len > p.tabWidth * 3) {
          const ux = (bx - ax) / len
          const uy = (by - ay) / len
          const mid = len / 2
          const s1 = mid - p.tabWidth / 2
          const s2 = mid + p.tabWidth / 2
          cutXY(ax + ux * s1, ay + uy * s1, p.feedCut)
          emit(`G1 Z${num(tabZ)} F${p.feedPlunge}`)
          cutXY(ax + ux * s2, ay + uy * s2, p.feedCut)
          emit(`G1 Z${num(z)} F${p.feedPlunge}`)
          cutXY(bx, by, p.feedCut)
        } else cutXY(bx, by, p.feedCut)
      }
    }
    emit(`G0 Z${num(p.safeZ)}`)
  }

  emit('')
  emit('M5')
  emit(`G0 Z${num(p.safeZ)}`)
  emit('G0 X0 Y0')
  emit('M30')
  emit('%')

  const minutes = feedMm / p.feedCut + rapidMm / 12000 + toolNo * 0.3 + holeCount * 0.02
  return {
    filename: `${clean(ctx.code ?? 'plano').replace(/\s+/g, '-')}_${clean(group.materialName).replace(/\s+/g, '-').slice(0, 24)}_chapa-${sheet.index}.nc`,
    code: lines.join('\n'),
    holes: holeCount,
    grooves: slotCount,
    contours: sheet.placements.length,
    tools: [...toolUse.entries()].map(([name, uses]) => ({ name, uses: name.startsWith('Fresa') ? sheet.placements.length + slotCount : uses })),
    minutes: Math.round(minutes * 10) / 10,
    warnings,
  }
}
