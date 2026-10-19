import type { CutPiece, CutPlacement, CutSheet } from '../types'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface CutParams {
  sheetWidth: number // mm — sentido do veio (comprimento da chapa)
  sheetHeight: number // mm
  kerf: number // espessura do disco de corte (mm)
  trim: number // refilo nas bordas da chapa (mm)
  /**
   * Corte de ponta a ponta (seccionadora): todo corte atravessa a peça inteira em que é feito.
   * Sem isto o mapa pode ter encaixes que só uma fresadora CNC executa.
   */
  guillotine?: boolean
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface Unit {
  pieceId: string
  label: string
  w: number
  h: number
  rotate: boolean
}

export interface CutResult {
  sheets: CutSheet[]
  unplaced: { label: string; length: number; width: number }[]
  utilization: number
  totalPieces: number
  placedPieces: number
  heuristic: string
}

class Bin {
  free: Rect[]
  placements: CutPlacement[] = []
  used = 0
  readonly area: Rect
  readonly kerf: number

  constructor(area: Rect, kerf: number) {
    this.area = area
    this.kerf = kerf
    // o espaço útil é "alargado" pelo kerf: cada peça consome w+kerf e h+kerf
    this.free = [{ x: area.x, y: area.y, w: area.w + kerf, h: area.h + kerf }]
  }

  private score(r: Rect, w: number, h: number) {
    return { short: Math.min(r.w - w, r.h - h), long: Math.max(r.w - w, r.h - h) }
  }

  /** Melhor encaixe pela menor sobra no lado curto (BSSF). */
  tryPlace(u: Unit): { rect: Rect; rotated: boolean; short: number; long: number } | null {
    let best: { rect: Rect; rotated: boolean; short: number; long: number } | null = null
    const orientations: [number, number, boolean][] = [[u.w, u.h, false]]
    if (u.rotate && u.w !== u.h) orientations.push([u.h, u.w, true])
    for (const [w, h, rotated] of orientations) {
      const cw = w + this.kerf
      const ch = h + this.kerf
      for (const r of this.free) {
        if (r.w >= cw && r.h >= ch) {
          const s = this.score(r, cw, ch)
          if (!best || s.short < best.short || (s.short === best.short && s.long < best.long)) {
            best = { rect: { x: r.x, y: r.y, w, h }, rotated, short: s.short, long: s.long }
          }
        }
      }
    }
    return best
  }

  commit(u: Unit, pos: { rect: Rect; rotated: boolean }) {
    const placed: Rect = { x: pos.rect.x, y: pos.rect.y, w: pos.rect.w + this.kerf, h: pos.rect.h + this.kerf }
    const next: Rect[] = []
    for (const f of this.free) {
      if (!this.intersects(f, placed)) {
        next.push(f)
        continue
      }
      if (placed.x > f.x) next.push({ x: f.x, y: f.y, w: placed.x - f.x, h: f.h })
      if (placed.x + placed.w < f.x + f.w) next.push({ x: placed.x + placed.w, y: f.y, w: f.x + f.w - (placed.x + placed.w), h: f.h })
      if (placed.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: placed.y - f.y })
      if (placed.y + placed.h < f.y + f.h) next.push({ x: f.x, y: placed.y + placed.h, w: f.w, h: f.y + f.h - (placed.y + placed.h) })
    }
    // remove retângulos contidos em outros
    this.free = next.filter((a, i) => !next.some((b, j) => i !== j && b.x <= a.x && b.y <= a.y && b.x + b.w >= a.x + a.w && b.y + b.h >= a.y + a.h && (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || i > j)))
    this.placements.push({ pieceId: u.pieceId, label: u.label, x: pos.rect.x, y: pos.rect.y, w: pos.rect.w, h: pos.rect.h, rotated: pos.rotated })
    this.used += pos.rect.w * pos.rect.h
  }

  private intersects(a: Rect, b: Rect) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  }

  largestFree() {
    return this.free.reduce((m, r) => Math.max(m, r.w * r.h), 0)
  }
}

// --------------------------------------------------------- corte guilhotina (seccionadora)
type FitRule = 'lado curto' | 'área'
type SplitRule = 'menor sobra' | 'maior sobra' | 'menor área'

/**
 * Chapa para seccionadora: cada peça é colocada no canto de um retângulo livre e o que sobra é dividido
 * por UM corte de ponta a ponta (horizontal ou vertical), de modo que todo o mapa seja executável
 * na serra esquadrejadeira (Jylänki, "Guillotine Bin Pack").
 */
class GuillotineBin {
  free: Rect[]
  placements: CutPlacement[] = []
  used = 0
  readonly area: Rect
  readonly kerf: number

  constructor(area: Rect, kerf: number) {
    this.area = area
    this.kerf = kerf
    this.free = [{ x: area.x, y: area.y, w: area.w + kerf, h: area.h + kerf }]
  }

  tryPlace(u: Unit, fit: FitRule): { index: number; rotated: boolean; score: number; tie: number } | null {
    let best: { index: number; rotated: boolean; score: number; tie: number } | null = null
    const orientations: [number, number, boolean][] = [[u.w, u.h, false]]
    if (u.rotate && u.w !== u.h) orientations.push([u.h, u.w, true])
    for (const [w, h, rotated] of orientations) {
      const cw = w + this.kerf
      const ch = h + this.kerf
      for (let index = 0; index < this.free.length; index++) {
        const r = this.free[index]
        if (r.w < cw || r.h < ch) continue
        const score = fit === 'área' ? r.w * r.h - cw * ch : Math.min(r.w - cw, r.h - ch)
        const tie = fit === 'área' ? Math.min(r.w - cw, r.h - ch) : r.w * r.h - cw * ch
        if (!best || score < best.score || (score === best.score && tie < best.tie)) best = { index, rotated, score, tie }
      }
    }
    return best
  }

  commit(u: Unit, pos: { index: number; rotated: boolean }, split: SplitRule) {
    const r = this.free[pos.index]
    const w = pos.rotated ? u.h : u.w
    const h = pos.rotated ? u.w : u.h
    const cw = w + this.kerf
    const ch = h + this.kerf
    const leftoverW = r.w - cw
    const leftoverH = r.h - ch
    let horizontal: boolean
    if (split === 'menor sobra') horizontal = leftoverW <= leftoverH
    else if (split === 'maior sobra') horizontal = leftoverW > leftoverH
    else horizontal = r.w * leftoverH <= leftoverW * r.h // menor área do maior pedaço
    // horizontal: o corte corre ao longo de toda a largura do retângulo livre
    const bottom: Rect = horizontal ? { x: r.x, y: r.y + ch, w: r.w, h: leftoverH } : { x: r.x, y: r.y + ch, w: cw, h: leftoverH }
    const right: Rect = horizontal ? { x: r.x + cw, y: r.y, w: leftoverW, h: ch } : { x: r.x + cw, y: r.y, w: leftoverW, h: r.h }
    this.free.splice(pos.index, 1)
    if (bottom.w > 0 && bottom.h > 0) this.free.push(bottom)
    if (right.w > 0 && right.h > 0) this.free.push(right)
    this.mergeFree()
    this.placements.push({ pieceId: u.pieceId, label: u.label, x: r.x, y: r.y, w, h, rotated: pos.rotated })
    this.used += w * h
  }

  /** Une retângulos livres vizinhos de mesma largura (ou altura) para aproveitar sobras maiores. */
  private mergeFree() {
    let merged = true
    while (merged) {
      merged = false
      outer: for (let i = 0; i < this.free.length; i++) {
        for (let j = i + 1; j < this.free.length; j++) {
          const a = this.free[i]
          const b = this.free[j]
          if (a.x === b.x && a.w === b.w && (a.y + a.h === b.y || b.y + b.h === a.y)) {
            this.free[i] = { x: a.x, y: Math.min(a.y, b.y), w: a.w, h: a.h + b.h }
            this.free.splice(j, 1)
            merged = true
            break outer
          }
          if (a.y === b.y && a.h === b.h && (a.x + a.w === b.x || b.x + b.w === a.x)) {
            this.free[i] = { x: Math.min(a.x, b.x), y: a.y, w: a.w + b.w, h: a.h }
            this.free.splice(j, 1)
            merged = true
            break outer
          }
        }
      }
    }
  }

  largestFree() {
    return this.free.reduce((m, r) => Math.max(m, r.w * r.h), 0)
  }
}

function runGuillotine(units: Unit[], params: CutParams, fit: FitRule, split: SplitRule) {
  const usable: Rect = { x: params.trim, y: params.trim, w: params.sheetWidth - params.trim * 2, h: params.sheetHeight - params.trim * 2 }
  const bins: GuillotineBin[] = []
  const unplaced: Unit[] = []
  for (const u of units) {
    const fits = (u.w <= usable.w && u.h <= usable.h) || (u.rotate && u.h <= usable.w && u.w <= usable.h)
    if (!fits) {
      unplaced.push(u)
      continue
    }
    let chosen: { bin: GuillotineBin; pos: NonNullable<ReturnType<GuillotineBin['tryPlace']>> } | null = null
    for (const bin of bins) {
      const pos = bin.tryPlace(u, fit)
      if (pos && (!chosen || pos.score < chosen.pos.score)) chosen = { bin, pos }
      if (chosen && chosen.pos.score === 0) break
    }
    if (!chosen) {
      const bin = new GuillotineBin(usable, params.kerf)
      const pos = bin.tryPlace(u, fit)
      if (!pos) {
        unplaced.push(u)
        continue
      }
      bins.push(bin)
      chosen = { bin, pos }
    }
    chosen.bin.commit(u, chosen.pos, split)
  }
  return { bins, unplaced }
}

/**
 * Confere se um mapa pode ser cortado só com cortes de ponta a ponta: existe uma linha (vertical ou
 * horizontal) que separa as peças em dois grupos sem cortar nenhuma, e isso vale recursivamente.
 * `tol` absorve a espessura do disco entre peças vizinhas.
 */
export function isGuillotine(rects: { x: number; y: number; w: number; h: number }[], tol = 0.5): boolean {
  if (rects.length <= 1) return true
  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'w' : 'h'
    const cuts = [...new Set(rects.map((r) => r[axis]))]
    for (const cut of cuts) {
      const left = rects.filter((r) => r[axis] + r[size] <= cut + tol)
      const right = rects.filter((r) => r[axis] >= cut - tol)
      if (left.length && right.length && left.length + right.length === rects.length && isGuillotine(left, tol) && isGuillotine(right, tol)) return true
    }
  }
  return false
}

const HEURISTICS: { name: string; sort: (a: Unit, b: Unit) => number }[] = [
  { name: 'área decrescente', sort: (a, b) => b.w * b.h - a.w * a.h },
  { name: 'maior lado', sort: (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h },
  { name: 'comprimento', sort: (a, b) => b.w - a.w || b.h - a.h },
  { name: 'largura', sort: (a, b) => b.h - a.h || b.w - a.w },
  { name: 'perímetro', sort: (a, b) => b.w + b.h - (a.w + a.h) },
]

function run(units: Unit[], params: CutParams) {
  const usable: Rect = {
    x: params.trim,
    y: params.trim,
    w: params.sheetWidth - params.trim * 2,
    h: params.sheetHeight - params.trim * 2,
  }
  const bins: Bin[] = []
  const unplaced: Unit[] = []
  for (const u of units) {
    const fits = (u.w <= usable.w && u.h <= usable.h) || (u.rotate && u.h <= usable.w && u.w <= usable.h)
    if (!fits) {
      unplaced.push(u)
      continue
    }
    let chosen: { bin: Bin; pos: NonNullable<ReturnType<Bin['tryPlace']>> } | null = null
    for (const bin of bins) {
      const pos = bin.tryPlace(u)
      if (pos && (!chosen || pos.short < chosen.pos.short)) chosen = { bin, pos }
      if (chosen && chosen.pos.short === 0) break
    }
    if (!chosen) {
      const bin = new Bin(usable, params.kerf)
      const pos = bin.tryPlace(u)
      if (!pos) {
        unplaced.push(u)
        continue
      }
      bins.push(bin)
      chosen = { bin, pos }
    }
    chosen.bin.commit(u, chosen.pos)
  }
  return { bins, unplaced }
}

/** Plano de corte 2D (MaxRects) testando várias ordenações e mantendo a melhor. */
export function optimizeCutting(pieces: CutPiece[], params: CutParams): CutResult {
  const units: Unit[] = []
  for (const p of pieces) {
    for (let i = 0; i < Math.max(Math.round(p.quantity), 0); i++) {
      units.push({
        pieceId: p.id,
        label: p.quantity > 1 ? `${p.label} ${i + 1}/${p.quantity}` : p.label,
        // comprimento da peça acompanha o comprimento da chapa (veio)
        w: p.length,
        h: p.width,
        rotate: p.rotate,
      })
    }
  }

  type AnyBin = { placements: CutPlacement[]; used: number; largestFree(): number }
  type Candidate = { name: string; res: { bins: AnyBin[]; unplaced: Unit[] } }
  const holder: { best: Candidate | null } = { best: null }
  const consider = (name: string, res: Candidate['res']) => {
    const cur = holder.best
    const better =
      !cur ||
      res.unplaced.length < cur.res.unplaced.length ||
      (res.unplaced.length === cur.res.unplaced.length &&
        (res.bins.length < cur.res.bins.length ||
          (res.bins.length === cur.res.bins.length && (res.bins.at(-1)?.largestFree() ?? 0) > (cur.res.bins.at(-1)?.largestFree() ?? 0))))
    if (better) holder.best = { name, res }
  }
  if (params.guillotine) {
    // listas muito grandes: menos combinações para manter a resposta rápida
    const big = units.length > 1500
    const fits: FitRule[] = big ? ['lado curto'] : ['lado curto', 'área']
    const splits: SplitRule[] = big ? ['menor sobra'] : ['menor sobra', 'maior sobra', 'menor área']
    for (const h of HEURISTICS) {
      const sorted = [...units].sort(h.sort)
      for (const fit of fits) for (const split of splits) consider(`corte de ponta a ponta · ${h.name}`, runGuillotine(sorted, params, fit, split))
    }
  } else {
    for (const h of HEURISTICS) consider(h.name, run([...units].sort(h.sort), params))
  }

  const best = holder.best
  const sheetArea = params.sheetWidth * params.sheetHeight
  const sheets: CutSheet[] = (best?.res.bins ?? []).map((b, i) => ({
    index: i + 1,
    placements: b.placements,
    usedArea: b.used,
    utilization: round2((b.used / sheetArea) * 100),
  }))
  const used = sheets.reduce((s, x) => s + x.usedArea, 0)
  return {
    sheets,
    unplaced: (best?.res.unplaced ?? []).map((u) => ({ label: u.label, length: u.w, width: u.h })),
    utilization: sheets.length ? round2((used / (sheets.length * sheetArea)) * 100) : 0,
    totalPieces: units.length,
    placedPieces: units.length - (best?.res.unplaced.length ?? 0),
    heuristic: best?.name ?? '',
  }
}

/** Metros lineares de fita de borda de uma lista de peças (dimensões em mm). */
export function edgeLengthMeters(pieces: { length: number; width: number; quantity: number; edges?: string }[]) {
  // edges: string com letras C (comprimento superior), c (inferior), L (largura esq.), l (dir.)
  let total = 0
  for (const p of pieces) {
    const e = p.edges ?? ''
    const len = (e.match(/[Cc]/g)?.length ?? 0) * p.length + (e.match(/[Ll]/g)?.length ?? 0) * p.width
    total += (len / 1000) * p.quantity
  }
  return round2(total)
}

// ------------------------------------------------- plano multi-material
export interface SheetSpec {
  key: string
  materialId?: string
  materialName: string
  thickness: number
  sheetWidth: number
  sheetHeight: number
  sheetCost: number
}

export interface GroupedResult {
  groups: import('../types').CutPlanGroup[]
  /** peças sem chapa definida ou sem dimensões válidas */
  unresolved: CutPiece[]
}

/** Retalho disponível para o plano: medidas em mm, `width` acompanha o veio. */
export interface OffcutSpec {
  id: string
  code?: string
  materialId?: string
  thickness?: number
  width: number
  height: number
}

/**
 * Tenta encaixar as peças nos retalhos do mesmo material antes de abrir chapa nova.
 * Usa primeiro os retalhos menores (os grandes ficam para trabalhos maiores) e só aceita o retalho
 * se alguma peça couber. Devolve os grupos de retalho e as peças que sobraram para as chapas.
 */
function packIntoOffcuts(
  list: CutPiece[],
  spec: SheetSpec,
  offcuts: OffcutSpec[],
  kerf: number,
  guillotine: boolean | undefined,
): { groups: import('../types').CutPlanGroup[]; rest: CutPiece[] } {
  const groups: import('../types').CutPlanGroup[] = []
  let rest = list.map((p) => ({ ...p }))
  const candidates = offcuts
    .filter((o) => o.materialId && o.materialId === spec.materialId && (!o.thickness || !spec.thickness || Math.abs(o.thickness - spec.thickness) < 0.5))
    .sort((a, b) => a.width * a.height - b.width * b.height)
    .slice(0, 40)
  for (const o of candidates) {
    if (!rest.length) break
    // só entra quem cabe no retalho (em alguma orientação permitida)
    const fits = (p: CutPiece) =>
      (p.length <= o.width && p.width <= o.height) || (p.rotate && p.width <= o.width && p.length <= o.height)
    const eligible = rest.filter(fits)
    if (!eligible.length) continue
    const r = optimizeCutting(eligible, { sheetWidth: o.width, sheetHeight: o.height, kerf, trim: 0, guillotine })
    const sheet = r.sheets[0]
    if (!sheet || !sheet.placements.length) continue
    // quantas unidades de cada peça foram para o retalho
    const used = new Map<string, number>()
    for (const pl of sheet.placements) used.set(pl.pieceId, (used.get(pl.pieceId) ?? 0) + 1)
    rest = rest
      .map((p) => ({ ...p, quantity: p.quantity - (used.get(p.id) ?? 0) }))
      .filter((p) => p.quantity > 0)
    groups.push({
      key: `retalho:${o.id}`,
      materialId: spec.materialId,
      materialName: `${spec.materialName} · retalho${o.code ? ` ${o.code}` : ''}`,
      thickness: spec.thickness,
      sheetWidth: o.width,
      sheetHeight: o.height,
      sheetCost: 0,
      sheets: [{ ...sheet, index: 1 }],
      unplaced: [],
      utilization: sheet.utilization,
      cost: 0,
      offcutId: o.id,
      offcutCode: o.code,
    })
  }
  return { groups, rest }
}

/** Agrupa as peças por material e otimiza cada grupo na sua própria chapa. */
export function planGroups(
  pieces: CutPiece[],
  resolve: (piece: CutPiece) => SheetSpec | null,
  kerf: number,
  trim: number,
  options: { guillotine?: boolean; offcuts?: OffcutSpec[] } = {},
): GroupedResult {
  const buckets = new Map<string, { spec: SheetSpec; pieces: CutPiece[] }>()
  const unresolved: CutPiece[] = []
  for (const p of pieces) {
    const spec = resolve(p)
    if (!spec || !(spec.sheetWidth > 0) || !(spec.sheetHeight > 0)) {
      unresolved.push(p)
      continue
    }
    const b = buckets.get(spec.key) ?? { spec, pieces: [] }
    b.pieces.push(p)
    buckets.set(spec.key, b)
  }
  const groups: import('../types').CutPlanGroup[] = []
  for (const { spec, pieces: all } of buckets.values()) {
    const packed = options.offcuts?.length ? packIntoOffcuts(all, spec, options.offcuts, kerf, options.guillotine) : { groups: [], rest: all }
    if (packed.rest.length) {
      const r = optimizeCutting(packed.rest, { sheetWidth: spec.sheetWidth, sheetHeight: spec.sheetHeight, kerf, trim, guillotine: options.guillotine })
      groups.push({
        key: spec.key,
        materialId: spec.materialId,
        materialName: spec.materialName,
        thickness: spec.thickness,
        sheetWidth: spec.sheetWidth,
        sheetHeight: spec.sheetHeight,
        sheetCost: spec.sheetCost,
        sheets: r.sheets,
        unplaced: r.unplaced,
        utilization: r.utilization,
        cost: round2(r.sheets.length * spec.sheetCost),
      })
    }
    // retalhos depois da chapa do material: a chapa nova continua sendo o grupo principal
    groups.push(...packed.groups)
  }
  return { groups, unresolved }
}
