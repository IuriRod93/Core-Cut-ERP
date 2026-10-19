/**
 * Sequência de cortes da seccionadora e sobras aproveitáveis (retalhos) de uma chapa.
 *
 * O mapa gerado no modo "seccionadora" é de cortes de ponta a ponta (guilhotina). Aqui o mapa é desmontado
 * na ordem em que a serra corta: primeiro as faixas da chapa inteira, depois os cruzamentos dentro de cada faixa.
 * As regiões que ficam sem nenhuma peça são as sobras; as grandes o bastante viram retalhos.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface CutStep {
  /** ordem na serra (1, 2, 3…) */
  n: number
  /** vertical = linha em X constante (corta a largura); horizontal = linha em Y constante */
  axis: 'vertical' | 'horizontal'
  /** posição da linha de corte, em mm, a partir da origem da chapa */
  at: number
  /** extensão da linha (do início ao fim, em mm, no outro eixo) */
  from: number
  to: number
  /** 1 = corte da chapa inteira; 2 = corte dentro de uma faixa… */
  level: number
  /** peças em cada lado do corte */
  left: number
  right: number
}

export interface Leftover extends Rect {
  area: number
}

const round = (n: number) => Math.round(n * 10) / 10

interface Region extends Rect {
  items: Rect[]
  level: number
}

/**
 * Acha um corte de ponta a ponta que separa as peças da região sem atravessar nenhuma.
 * Devolve o eixo, a posição e os dois grupos, preferindo o corte que deixa os grupos mais equilibrados.
 */
function findCut(region: Region, kerf: number, tol: number) {
  let best: { axis: 'vertical' | 'horizontal'; at: number; a: Rect[]; b: Rect[]; score: number } | null = null
  for (const axis of ['vertical', 'horizontal'] as const) {
    const start = (r: Rect) => (axis === 'vertical' ? r.x : r.y)
    const size = (r: Rect) => (axis === 'vertical' ? r.w : r.h)
    const candidates = [...new Set(region.items.map((r) => round(start(r) + size(r))))].sort((p, q) => p - q)
    for (const at of candidates) {
      const a = region.items.filter((r) => start(r) + size(r) <= at + tol)
      const b = region.items.filter((r) => start(r) >= at + kerf - tol)
      if (!a.length || !b.length || a.length + b.length !== region.items.length) continue
      const score = Math.abs(a.length - b.length)
      if (!best || score < best.score) best = { axis, at, a, b, score }
    }
  }
  return best
}

/**
 * Desmonta o mapa em cortes e sobras. `bounds` é a área útil da chapa (já sem o refilo).
 * Se o mapa não for de ponta a ponta (encaixe livre de CNC) devolve `guillotine: false`.
 */
export function analyzeSheet(placements: Rect[], bounds: Rect, kerf = 3): { steps: CutStep[]; leftovers: Leftover[]; guillotine: boolean } {
  const tol = Math.max(kerf + 0.6, 1)
  const steps: Omit<CutStep, 'n'>[] = []
  const waste: Rect[] = []
  let guillotine = true
  const queue: Region[] = [{ ...bounds, items: placements, level: 1 }]

  const addWaste = (r: Rect) => {
    if (r.w > tol && r.h > tol) waste.push({ x: round(r.x), y: round(r.y), w: round(r.w), h: round(r.h) })
  }

  while (queue.length) {
    const region = queue.shift()!
    if (region.items.length === 0) {
      addWaste(region)
      continue
    }
    if (region.items.length === 1) {
      // peça sozinha: um corte para cada lado em que ainda sobra material, do mais externo para dentro
      const p = region.items[0]
      let level = region.level
      let box = { x: region.x, y: region.y, w: region.w, h: region.h }
      const trimSide = (side: 'left' | 'top' | 'right' | 'bottom') => {
        const gap =
          side === 'left' ? p.x - box.x : side === 'top' ? p.y - box.y : side === 'right' ? box.x + box.w - (p.x + p.w) : box.y + box.h - (p.y + p.h)
        if (gap <= tol) return
        const vertical = side === 'left' || side === 'right'
        const at = side === 'left' ? p.x - kerf / 2 : side === 'top' ? p.y - kerf / 2 : side === 'right' ? p.x + p.w + kerf / 2 : p.y + p.h + kerf / 2
        steps.push({
          axis: vertical ? 'vertical' : 'horizontal',
          at: round(at),
          from: round(vertical ? box.y : box.x),
          to: round(vertical ? box.y + box.h : box.x + box.w),
          level,
          left: side === 'left' || side === 'top' ? 0 : 1,
          right: side === 'left' || side === 'top' ? 1 : 0,
        })
        const strip = Math.max(gap - kerf, 0)
        if (side === 'left') {
          addWaste({ x: box.x, y: box.y, w: strip, h: box.h })
          box = { x: p.x, y: box.y, w: box.w - gap, h: box.h }
        } else if (side === 'top') {
          addWaste({ x: box.x, y: box.y, w: box.w, h: strip })
          box = { x: box.x, y: p.y, w: box.w, h: box.h - gap }
        } else if (side === 'right') {
          addWaste({ x: p.x + p.w + kerf, y: box.y, w: strip, h: box.h })
          box = { ...box, w: box.w - gap }
        } else {
          addWaste({ x: box.x, y: p.y + p.h + kerf, w: box.w, h: strip })
          box = { ...box, h: box.h - gap }
        }
        level += 1
      }
      trimSide('left')
      trimSide('top')
      trimSide('right')
      trimSide('bottom')
      continue
    }
    const cut = findCut(region, kerf, tol)
    if (!cut) {
      guillotine = false
      break
    }
    const vertical = cut.axis === 'vertical'
    steps.push({
      axis: cut.axis,
      at: round(cut.at + kerf / 2),
      from: round(vertical ? region.y : region.x),
      to: round(vertical ? region.y + region.h : region.x + region.w),
      level: region.level,
      left: cut.a.length,
      right: cut.b.length,
    })
    const nextLevel = region.level + 1
    if (vertical) {
      queue.push({ x: region.x, y: region.y, w: cut.at - region.x, h: region.h, items: cut.a, level: nextLevel })
      queue.push({ x: cut.at + kerf, y: region.y, w: region.x + region.w - (cut.at + kerf), h: region.h, items: cut.b, level: nextLevel })
    } else {
      queue.push({ x: region.x, y: region.y, w: region.w, h: cut.at - region.y, items: cut.a, level: nextLevel })
      queue.push({ x: region.x, y: cut.at + kerf, w: region.w, h: region.y + region.h - (cut.at + kerf), items: cut.b, level: nextLevel })
    }
  }

  if (!guillotine) return { steps: [], leftovers: [], guillotine: false }
  const ordered = steps.sort((a, b) => a.level - b.level).map((s, i) => ({ ...s, n: i + 1 }))
  const leftovers = waste.map((r) => ({ ...r, area: Math.round(r.w * r.h) })).sort((a, b) => b.area - a.area)
  return { steps: ordered, leftovers, guillotine: true }
}

/** Sobras que valem guardar: lado menor e área mínimos (padrão 250 mm e 0,1 m²). */
export function usableLeftovers(leftovers: Leftover[], { minSide = 250, minArea = 100_000 }: { minSide?: number; minArea?: number } = {}) {
  return leftovers.filter((l) => Math.min(l.w, l.h) >= minSide && l.area >= minArea)
}

/** Descrição curta de um corte para a lista do operador. */
export function describeCut(step: CutStep) {
  const along = step.axis === 'vertical' ? 'Vertical' : 'Horizontal'
  const length = Math.round(step.to - step.from)
  return `${along} a ${Math.round(step.at)} mm · comprimento ${length} mm`
}
