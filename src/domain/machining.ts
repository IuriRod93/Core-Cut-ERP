import type { CutPlacement, CutPiece, Machining, MachiningMethod } from '../types'

export interface MethodPreset {
  method: MachiningMethod
  label: string
  kind: Machining['kind']
  face: Machining['face']
  diameter?: number
  depth: number
  width?: number
  hint: string
}

/** Métodos de furação e usinagem usuais em marcenaria industrial. */
export const METHOD_PRESETS: MethodPreset[] = [
  { method: 'dobradica_35', label: 'Dobradiça caneco Ø35', kind: 'furo', face: 'topo', diameter: 35, depth: 12.5, hint: 'Furo cego de 12,5 mm; centro a 22,5 mm da borda da porta' },
  { method: 'minifix_15', label: 'Minifix (tambor) Ø15', kind: 'furo', face: 'topo', diameter: 15, depth: 12.5, hint: 'Furo do tambor, a 34 mm da borda' },
  { method: 'cavilha_8', label: 'Cavilha Ø8', kind: 'furo', face: 'borda', diameter: 8, depth: 12, hint: 'Furo de cavilha na borda de 12 mm' },
  { method: 'confirmat_5', label: 'Parafuso confirmat Ø5', kind: 'furo', face: 'topo', diameter: 5, depth: 13, hint: 'Furo guia para parafuso 5 × 50' },
  { method: 'pino_5', label: 'Pino de prateleira Ø5', kind: 'furo', face: 'topo', diameter: 5, depth: 10, hint: 'Sistema 32: colunas a 37 mm das bordas' },
  { method: 'passante_5', label: 'Furo passante Ø5', kind: 'furo', face: 'topo', diameter: 5, depth: 18, hint: 'Atravessa a chapa (puxador, fixação)' },
  { method: 'puxador_5', label: 'Furação de puxador Ø5', kind: 'furo', face: 'topo', diameter: 5, depth: 18, hint: 'Entre-eixos conforme o modelo do puxador' },
  { method: 'furo_livre', label: 'Furo livre', kind: 'furo', face: 'topo', diameter: 6, depth: 10, hint: 'Diâmetro e profundidade informados' },
  { method: 'rasgo_fundo', label: 'Rasgo para fundo (6 mm)', kind: 'rasgo', face: 'topo', width: 6.2, depth: 8, hint: 'Canal a 10 mm da borda para o fundo' },
  { method: 'rasgo_livre', label: 'Rasgo / canal livre', kind: 'rasgo', face: 'topo', width: 6, depth: 6, hint: 'Canal retilíneo com a fresa' },
  { method: 'recorte', label: 'Recorte retangular', kind: 'recorte', face: 'topo', depth: 18, hint: 'Passagem de cabos, cuba, tomadas' },
]

export const presetOf = (method: MachiningMethod) => METHOD_PRESETS.find((p) => p.method === method)
export const methodLabel = (method: MachiningMethod) => presetOf(method)?.label ?? method

let seq = 0
const nid = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`

export function newMachining(method: MachiningMethod, x = 50, y = 50): Machining {
  const p = presetOf(method) ?? METHOD_PRESETS[7]
  return {
    id: nid(),
    kind: p.kind,
    method,
    face: p.face,
    x,
    y,
    diameter: p.diameter,
    depth: p.depth,
    length: p.kind === 'rasgo' ? 200 : p.kind === 'recorte' ? 100 : undefined,
    width: p.width ?? (p.kind === 'recorte' ? 60 : undefined),
  }
}

/** Furos de dobradiça padrão para uma porta (2 até 1.000 mm, 3 até 1.600 mm, 4 acima). */
export function hingeHoles(length: number, width: number): Machining[] {
  const n = length <= 1000 ? 2 : length <= 1600 ? 3 : 4
  const inset = 100
  const positions = Array.from({ length: n }, (_, i) => (i === 0 ? inset : i === n - 1 ? length - inset : inset + ((length - 2 * inset) / (n - 1)) * i))
  const y = Math.min(22.5, width / 2)
  return positions.map((x) => ({ ...newMachining('dobradica_35', Math.round(x), y) }))
}

/** Sistema 32: colunas de pinos a 37 mm das bordas frontal/traseira. */
export function shelfPinHoles(length: number, width: number, shelves: number): Machining[] {
  if (shelves < 1) return []
  const out: Machining[] = []
  const step = length / (shelves + 1)
  for (let s = 1; s <= shelves; s++) {
    const x = Math.round((step * s) / 32) * 32
    for (const y of [37, width - 37]) out.push(newMachining('pino_5', x, y))
  }
  return out
}

type EdgeInfo = Pick<CutPiece, 'length' | 'width' | 'edgeTop' | 'edgeBottom' | 'edgeLeft' | 'edgeRight'> & Partial<Pick<CutPiece, 'edgeExtra' | 'contour'>>

/** Metros de fita por unidade da peça (inclui arestas de contornos não retangulares). */
export const edgeMetersOf = (p: EdgeInfo) =>
  ((p.edgeTop ? p.length : 0) + (p.edgeBottom ? p.length : 0) + (p.edgeLeft ? p.width : 0) + (p.edgeRight ? p.width : 0) + (p.edgeExtra ?? 0)) / 1000

export const hasEdges = (p: Pick<CutPiece, 'edgeTop' | 'edgeBottom' | 'edgeLeft' | 'edgeRight'>) => Boolean(p.edgeTop || p.edgeBottom || p.edgeLeft || p.edgeRight)

/**
 * Converte coordenadas locais da peça (origem no canto inferior esquerdo, y para cima)
 * para a vista superior da chapa em SVG (origem no canto superior esquerdo, y para baixo).
 * Peças rotacionadas giram 90° anti-horário.
 */
export function pieceToSheet(pl: CutPlacement, piece: Pick<CutPiece, 'length' | 'width'>, px: number, py: number) {
  if (!pl.rotated) return { x: pl.x + px, y: pl.y + piece.width - py }
  return { x: pl.x + piece.width - py, y: pl.y + piece.length - px }
}

/** Arestas da peça (em coordenadas locais) como segmentos para desenhar a fitagem. */
export function edgeSegments(piece: EdgeInfo) {
  if (piece.contour && piece.contour.length >= 3) {
    const c = piece.contour
    const out: [number, number, number, number][] = []
    for (let i = 0; i < c.length; i++) {
      const b = c[(i + 1) % c.length]
      if (c[i].edge) out.push([c[i].x, c[i].y, b.x, b.y])
    }
    return out
  }
  const L = piece.length
  const W = piece.width
  const segs: [number, number, number, number][] = []
  if (piece.edgeTop) segs.push([0, W, L, W])
  if (piece.edgeBottom) segs.push([0, 0, L, 0])
  if (piece.edgeLeft) segs.push([0, 0, 0, W])
  if (piece.edgeRight) segs.push([L, 0, L, W])
  return segs
}

export const countByMethod = (pieces: CutPiece[]) => {
  const out = new Map<MachiningMethod, number>()
  for (const p of pieces)
    for (const m of p.machining ?? []) out.set(m.method, (out.get(m.method) ?? 0) + p.quantity)
  return out
}

/**
 * Desloca um polígono para fora em `d` mm (junção em ângulo/miter). Usado para a trajetória da fresa
 * em contornos não retangulares. Funciona para qualquer orientação dos vértices.
 */
export function offsetPolygon(pts: { x: number; y: number }[], d: number): { x: number; y: number }[] {
  const n = pts.length
  if (n < 3 || d === 0) return pts.map((p) => ({ ...p }))
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    area += a.x * b.y - b.x * a.y
  }
  const sign = area >= 0 ? 1 : -1
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % n]
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1
    const dx = (q.x - p.x) / len
    const dy = (q.y - p.y) / len
    return { px: p.x + dy * sign * d, py: p.y - dx * sign * d, dx, dy }
  })
  return pts.map((_, i) => {
    const l1 = lines[(i - 1 + n) % n]
    const l2 = lines[i]
    const cross = l1.dx * l2.dy - l1.dy * l2.dx
    if (Math.abs(cross) < 1e-9) return { x: l2.px, y: l2.py }
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / cross
    return { x: l1.px + l1.dx * t, y: l1.py + l1.dy * t }
  })
}
