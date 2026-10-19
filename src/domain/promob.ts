import type { ContourPoint, CutPiece, Machining, MachiningMethod, Material } from '../types'

/**
 * Leitura dos arquivos exportados pelo Promob (Cut Pro / Listagem) e formatos afins:
 *  - csv-lista : lista de corte do Cut Pro, uma linha por peça (COMPRIMENTO_X / LARGURA_Y)
 *  - csv-pecas : exportação de peças com uma linha por vértice do contorno + operações em JSON
 *  - xml       : listagem Promob (LISTING) com chapas, fitas, ferragens e roteiro
 *  - dxf       : desenho por chapa do Cut Pro (contornos, furos, rasgos) ou DXF simples de peças
 *  - dxt       : lista de peças em XML (ListInformation / PartData)
 *
 * Módulo puro (sem DOM): também executado pelo Node nos testes.
 */

export type PromobFormat = 'csv-lista' | 'csv-pecas' | 'xml' | 'dxf' | 'dxt'

export const FORMAT_LABEL: Record<PromobFormat, string> = {
  'csv-lista': 'CSV · lista de corte (Cut Pro)',
  'csv-pecas': 'CSV · peças com contorno e operações',
  xml: 'XML · listagem Promob',
  dxf: 'DXF · desenho de corte',
  dxt: 'DXT · lista de peças',
}

export interface PromobPart {
  label: string
  environment?: string
  module?: string
  ref?: string
  length: number
  width: number
  thickness: number
  quantity: number
  /** true quando o material tem veio (a peça não pode ser girada) */
  grain: boolean
  /** nome do material no arquivo — chave do mapeamento para o estoque */
  material: string
  materialCode?: string
  sheetWidth?: number
  sheetHeight?: number
  edges: { top: boolean; bottom: boolean; left: boolean; right: boolean }
  edgeExtra?: number
  edgeFinish?: string
  edgeHeight?: number
  edgeThickness?: number
  contour?: ContourPoint[]
  machining: Machining[]
  note?: string
}

export interface PromobHardware {
  description: string
  reference?: string
  unit: string
  quantity: number
}

export interface PromobImport {
  format: PromobFormat
  fileNames: string[]
  parts: PromobPart[]
  hardware: PromobHardware[]
  warnings: string[]
  info: { client?: string; project?: string; environments: string[]; responsible?: string }
  /** Quantidade de DXFs de chapa (lotes) lidos como desenho de chapa. */
  lots: number
  /** Arquivos que não são do Promob e foram ignorados. */
  ignored: number
}

export interface MaterialSummary {
  key: string
  name: string
  thickness: number
  sheetWidth?: number
  sheetHeight?: number
  code?: string
  lines: number
  units: number
  /** m² de peças (líquido) */
  area: number
}

export interface EdgeSummary {
  name: string
  meters: number
  height?: number
  thickness?: number
}

// ───────────────────────────── utilidades ─────────────────────────────

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const r1 = (n: number) => Math.round((n + Number.EPSILON) * 10) / 10

let idSeq = 0
const mid = () => `pm${Date.now().toString(36)}${(idSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** Decodifica bytes de arquivo texto: UTF-16 (BOM), UTF-8 (com/sem BOM) ou, na falha, Windows-1252. */
export function decodeBytes(input: ArrayBuffer | Uint8Array): string {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b)
  if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(b)
  }
}

/** Número em formato brasileiro ou internacional: "984,5" · "1.234,5" · "1,234.5" · "984.5". */
export function parseNumber(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let s = String(v ?? '')
    .trim()
    .replace(/[^\d,.\-+eE]/g, '')
  if (!s) return 0
  const lc = s.lastIndexOf(',')
  const ld = s.lastIndexOf('.')
  if (lc >= 0 && ld >= 0) s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (lc >= 0) s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.')
  else if (ld >= 0 && /^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Normaliza cabeçalhos: sem acento, maiúsculas, sem pontuação (mantém U+FFFD de arquivos corrompidos). */
const normHeader = (s: string) =>
  strip(s)
    .toUpperCase()
    .replace(/[^A-Z0-9�]+/g, ' ')
    .trim()

const truthy = (v: string | undefined) => {
  const s = (v ?? '').trim().toUpperCase()
  if (!s) return false
  if (/^(0|N|NAO|NÃO|FALSE|NONE|NENHUM|-)$/.test(s)) return false
  return true
}

const cleanLabel = (s: string) => s.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim()

const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === 'amp') return '&'
    if (e === 'lt') return '<'
    if (e === 'gt') return '>'
    if (e === 'quot') return '"'
    if (e === 'apos') return "'"
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(code) ? String.fromCodePoint(code) : ''
  })

// ───────────────────────────── CSV ─────────────────────────────

/** Leitor CSV (RFC 4180): aspas duplas, quebras de linha dentro de campos e delimitador configurável. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const n = text.length
  for (let i = 0; i < n; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += ch
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  return rows
}

function detectDelimiter(text: string) {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const count = (c: string) => first.split(c).length - 1
  const candidates = [';', ',', '\t'].map((c) => [c, count(c)] as const).sort((a, b) => b[1] - a[1])
  return candidates[0][1] > 0 ? candidates[0][0] : ';'
}

type ColumnSpec = Record<string, RegExp[]>
function resolveColumns(headers: string[], spec: ColumnSpec) {
  const norm = headers.map(normHeader)
  const out: Record<string, number[]> = {}
  for (const [key, patterns] of Object.entries(spec)) {
    out[key] = []
    norm.forEach((h, i) => {
      if (patterns.some((p) => p.test(h))) out[key].push(i)
    })
  }
  return out
}

const LISTA_COLUMNS: ColumnSpec = {
  qty: [/^QUANT/],
  length: [/^COMPRIMENTO( X)?$/],
  width: [/^LARGURA( Y)?$/],
  thick: [/^ESPESSURA$/],
  matCode: [/^COD MATERIAL$/],
  material: [/^MATERIAL$/],
  dimX: [/^DIM X MATERIAL$/],
  dimY: [/^DIM Y MATERIAL$/],
  module: [/^MODULO USADO ID$/],
  ref: [/^PECA REFERENCIA$/],
  partId: [/^PECA ID$/],
  desc: [/^PECA DESCRI.{0,4}O$/],
  env: [/^AMBIENTE$/],
  client: [/^CLIENTE$/],
  clientCode: [/^COD CLIENTE$/],
  responsible: [/^RESP/],
  grain: [/^VEIO$/],
  front: [/^BORDA FACE FRENTE$/],
  back: [/^BORDA FACE TRASEIRA$/],
  left: [/^BORDA FACE LE$/],
  right: [/^BORDA FACE LD$/],
  edgeFinish: [/^ACABAMENTO ?BORDA$/],
  edgeHeight: [/^ALTURA ?BORDA$/],
  obs: [/^OBSERVA.{0,4}O$/],
}

const PECAS_COLUMNS: ColumnSpec = {
  px: [/^(PONTO X ITEM|ITEM X POINT)$/],
  py: [/^(PONTO Y ITEM|ITEM Y POINT)$/],
  tapeFinish: [/^ACABAMENTO FITA BORDA$/, /BORDER FINISHING$/],
  tapeHeight: [/^ALTURA FITA BORDA$/, /^BORDER HEIGHT$/],
  tapeThick: [/^ESPESSURA FITA BORDA$/, /^BORDER THICKNESS$/],
  tapeDesc: [/^DESCRI.{0,4}O FITA BORDA$/, /^BORDER DESCRIPTION$/],
  client: [/^CLIENTE/, /^CUSTOMER/],
  project: [/^C.{0,3}DIGO DO PROJETO$/, /^PROJECT CODE$/],
  env: [/^AMBIENTE$/, /^AMBIENT$/],
  partId: [/^PE.{0,3}A ID$/, /^CODE$/],
  ref: [/^REFER.{0,4}NCIA$/],
  moduleId: [/^ID M.{0,3}DULO$/, /^FORNITURE ID$/, /^FURNITURE ID$/],
  desc: [/^PE.{0,3}A DESCRI.{0,4}O$/, /^PART DESCRIPTION$/],
  length: [/^ALTURA X$/, /^HEIGHT X$/],
  width: [/^PROF Y$/, /^DEPTH Y$/],
  qty: [/^QUANTIDADE ITEM$/, /^QUANT ITEM$/],
  hasRaw: [/^ITEM TEM MAT.{0,4}RIA PRIMA$/, /^ITEM HAS RAW MATERIAL$/],
  material: [/^DESCRI.{0,4}O DO MATERIAL$/, /^MATERIAL$/],
  promobMaterial: [/^PROMOB MATERIAL MATERIA PRIMA$/, /^PROMOB FEEDSTOCK$/],
  dimX: [/^DIM X MATERIAL$/],
  dimY: [/^DIM Y MATERIAL$/],
  matThick: [/^ESPESSURA DO MATERIAL$/, /^MATERIAL THICKNESS$/],
  thickItem: [/^ESPESSURA ITEM$/, /^ITEM DEPTH$/],
  matCode: [/^C.{0,3}DIGO MATERIAL$/, /^MATERIAL CODE$/],
  grain: [/^VEIO$/, /^SENTIDO VEIO$/, /^WOOD GRAIN$/],
  ops: [/^OPERA.{0,4}ES$/, /^OPERATIONS$/],
}

const pick = (row: string[], cols: number[] | undefined, i = 0) => (cols && cols[i] !== undefined ? (row[cols[i]] ?? '').trim() : '')

function newPart(partial: Partial<PromobPart> & Pick<PromobPart, 'label' | 'length' | 'width'>): PromobPart {
  return {
    thickness: 0,
    quantity: 1,
    grain: false,
    material: '',
    edges: { top: false, bottom: false, left: false, right: false },
    machining: [],
    ...partial,
  }
}

/** Escolhe o método de usinagem pelo diâmetro, profundidade e face — mantém sempre o diâmetro/profundidade reais. */
function holeMethod(d: number, depth: number, face: Machining['face'], thickness: number): MachiningMethod {
  if (face === 'borda') return d >= 7 && d <= 10 ? 'cavilha_8' : 'furo_livre'
  if (d >= 30) return 'dobradica_35'
  if (d >= 14 && d <= 26 && depth <= 16) return 'minifix_15'
  if (d >= 4 && d <= 6.5) {
    if (thickness > 0 && depth >= thickness - 0.5) return 'passante_5'
    if (depth <= 11) return 'pino_5'
    return 'confirmat_5'
  }
  return 'furo_livre'
}

function holeOp(x: number, y: number, diameter: number, depth: number, face: Machining['face'], thickness: number, note?: string): Machining {
  return {
    id: mid(),
    kind: 'furo',
    method: holeMethod(diameter, depth, face, thickness),
    face,
    x: r2(x),
    y: r2(y),
    diameter: r2(diameter),
    depth: r2(depth),
    note,
  }
}

// ── geometria do contorno ──

const polyBBox = (pts: { x: number; y: number }[]) => {
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
}

/** Contorno retangular alinhado aos eixos (4 vértices) ou degenerado. */
function isRectangle(pts: { x: number; y: number }[], eps = 0.05) {
  if (pts.length !== 4) return false
  const b = polyBBox(pts)
  return pts.every((p) => (Math.abs(p.x - b.x0) < eps || Math.abs(p.x - b.x1) < eps) && (Math.abs(p.y - b.y0) < eps || Math.abs(p.y - b.y1) < eps))
}

/**
 * Converte um contorno com arestas fitadas em: flags dos lados do retângulo envolvente
 * (somente quando a fita cobre o lado inteiro) + mm de fita restantes (arestas internas/parciais).
 */
function edgesFromContour(pts: ContourPoint[], L: number, W: number) {
  const eps = 0.6
  const cover = { top: 0, bottom: 0, left: 0, right: 0 }
  let total = 0
  for (let i = 0; i < pts.length; i++) {
    if (!pts[i].edge) continue
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    total += len
    if (Math.abs(a.y - b.y) < eps) {
      if (Math.abs(a.y) < eps) cover.bottom += len
      else if (Math.abs(a.y - W) < eps) cover.top += len
    } else if (Math.abs(a.x - b.x) < eps) {
      if (Math.abs(a.x) < eps) cover.left += len
      else if (Math.abs(a.x - L) < eps) cover.right += len
    }
  }
  const full = (c: number, side: number) => side > 0 && c >= side - eps
  const edges = {
    top: full(cover.top, L),
    bottom: full(cover.bottom, L),
    left: full(cover.left, W),
    right: full(cover.right, W),
  }
  const flagged = (edges.top ? L : 0) + (edges.bottom ? L : 0) + (edges.left ? W : 0) + (edges.right ? W : 0)
  return { edges, extra: Math.max(r1(total - flagged), 0) }
}

// ───────────────────────────── CSV · lista de corte ─────────────────────────────

function parseCsvLista(rows: string[][], cols: Record<string, number[]>, warnings: string[]): PromobPart[] {
  const parts: PromobPart[] = []
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const length = parseNumber(pick(row, cols.length))
    const width = parseNumber(pick(row, cols.width))
    if (!(length > 0) || !(width > 0)) {
      if (row.some((c) => c.trim())) warnings.push(`Linha ${r + 1}: peça sem comprimento/largura foi ignorada.`)
      continue
    }
    const material = cleanLabel(pick(row, cols.material))
    const edgeHeight = parseNumber(pick(row, cols.edgeHeight))
    parts.push(
      newPart({
        label: cleanLabel(pick(row, cols.desc)) || cleanLabel(pick(row, cols.ref)) || `Peça ${r}`,
        environment: cleanLabel(pick(row, cols.env)) || undefined,
        module: pick(row, cols.module) || undefined,
        ref: pick(row, cols.ref) || pick(row, cols.partId) || undefined,
        length: r2(length),
        width: r2(width),
        thickness: parseNumber(pick(row, cols.thick)),
        quantity: Math.max(Math.round(parseNumber(pick(row, cols.qty)) || 1), 1),
        grain: truthy(pick(row, cols.grain)),
        material,
        materialCode: pick(row, cols.matCode) || undefined,
        sheetWidth: parseNumber(pick(row, cols.dimX)) || undefined,
        sheetHeight: parseNumber(pick(row, cols.dimY)) || undefined,
        // FRENTE = y 0 (lado de baixo), TRASEIRA = y largura, LE = x 0, LD = x comprimento
        edges: {
          bottom: truthy(pick(row, cols.front)),
          top: truthy(pick(row, cols.back)),
          left: truthy(pick(row, cols.left)),
          right: truthy(pick(row, cols.right)),
        },
        edgeFinish: cleanLabel(pick(row, cols.edgeFinish)) || undefined,
        edgeHeight: edgeHeight || undefined,
        note: pick(row, cols.obs) || undefined,
      }),
    )
  }
  return parts
}

// ───────────────────────────── CSV · peças com vértices ─────────────────────────────

interface Ops {
  Holes?: { FaceNormal?: Record<string, number | string>; X?: number; Y?: number; Diameter?: number; Depth?: number }[]
  Grooves?: { FaceNormal?: Record<string, number | string>; SlotType?: number; X?: number; Y?: number; Width?: number; Depth?: number; Length?: number }[]
}

const normalOf = (fn: Record<string, number | string> | undefined) => {
  const out = { a: 0, b: 0, c: 0 }
  for (const [k, v] of Object.entries(fn ?? {})) {
    const n = Number(v)
    if (k === 'A') out.a = n
    else if (k === 'B') out.b = n
    else if (k === 'C') out.c = n
  }
  return out
}

/** Converte o JSON de operações do Promob em usinagens da peça (coordenadas locais, origem no canto inferior esquerdo). */
function machiningFromOps(json: string, L: number, W: number, T: number, warnings: string[], label: string): Machining[] {
  const out: Machining[] = []
  if (!json.trim()) return out
  let ops: Ops
  try {
    ops = JSON.parse(json) as Ops
  } catch {
    warnings.push(`Peça "${label}": operações em formato inválido (ignoradas).`)
    return out
  }
  for (const h of ops.Holes ?? []) {
    const d = Number(h.Diameter ?? 0)
    const depth = Number(h.Depth ?? 0)
    const X = Number(h.X ?? 0)
    const Y = Number(h.Y ?? 0)
    if (!(d > 0)) continue
    const n = normalOf(h.FaceNormal)
    if (n.c > 0) out.push(holeOp(X, Y, d, depth, 'topo', T))
    else if (n.c < 0) out.push(holeOp(X, Y, d, depth, 'fundo', T, 'face inferior'))
    else if (n.b !== 0) out.push(holeOp(X, n.b < 0 ? 0 : W, d, depth, 'borda', T, n.b < 0 ? 'borda frontal' : 'borda traseira'))
    else if (n.a !== 0) out.push(holeOp(n.a < 0 ? 0 : L, Y, d, depth, 'borda', T, n.a < 0 ? 'borda esquerda' : 'borda direita'))
    else out.push(holeOp(X, Y, d, depth, 'topo', T))
  }
  for (const g of ops.Grooves ?? []) {
    const width = Number(g.Width ?? 0)
    const depth = Number(g.Depth ?? 0)
    const len = Number(g.Length ?? 0)
    if (!(len > 0) || !(width > 0)) continue
    const n = normalOf(g.FaceNormal)
    const along: 'x' | 'y' = Number(g.SlotType) === 2 ? 'y' : 'x'
    const base: Machining = {
      id: mid(),
      kind: 'rasgo',
      method: 'rasgo_livre',
      face: n.c < 0 ? 'fundo' : 'topo',
      x: 0,
      y: 0,
      depth: r2(depth),
      length: r2(len),
      width: r2(width),
      axis: along,
      note: along === 'y' ? 'rasgo no sentido da largura' : undefined,
    }
    // SlotType 1: canal ao longo de x, centro em Y; SlotType 2: ao longo de y, centro em X. A posição inicial ausente = 0.
    if (along === 'x') {
      base.x = r2(Number(g.X ?? 0))
      base.y = r2(Number(g.Y ?? W / 2))
    } else {
      base.x = r2(Number(g.X ?? L / 2))
      base.y = r2(Number(g.Y ?? 0))
    }
    out.push(base)
  }
  return out
}

function parseCsvPecas(rows: string[][], cols: Record<string, number[]>, warnings: string[]): PromobPart[] {
  interface Group {
    rows: string[][]
  }
  const groups = new Map<string, Group>()
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length < 10) continue
    const key = `${pick(row, cols.partId)}|${pick(row, cols.moduleId)}|${pick(row, cols.env)}`
    const g = groups.get(key)
    if (g) g.rows.push(row)
    else groups.set(key, { rows: [row] })
  }
  const parts: PromobPart[] = []
  let skippedPurchased = 0
  for (const g of groups.values()) {
    const first = g.rows[0]
    const hasRaw = cols.hasRaw?.length ? truthy(pick(first, cols.hasRaw)) : true
    const dimX = parseNumber(pick(first, cols.dimX))
    if (!hasRaw || !(dimX > 0)) {
      skippedPurchased += 1
      continue
    }
    const label = cleanLabel(pick(first, cols.desc)) || cleanLabel(pick(first, cols.ref)) || 'Peça'
    // vértices (a última linha repetindo a primeira fecha o polígono)
    let verts: ContourPoint[] = g.rows.map((row) => ({
      x: parseNumber(pick(row, cols.px)),
      y: parseNumber(pick(row, cols.py)),
      edge: Boolean(pick(row, cols.tapeFinish) || pick(row, cols.tapeHeight) || pick(row, cols.tapeDesc)),
    }))
    if (verts.length > 3) {
      const a = verts[0]
      const z = verts[verts.length - 1]
      if (Math.abs(a.x - z.x) < 1e-6 && Math.abs(a.y - z.y) < 1e-6) verts = verts.slice(0, -1)
    }
    let L = parseNumber(pick(first, cols.length))
    let W = parseNumber(pick(first, cols.width))
    if (verts.length >= 3) {
      const b = polyBBox(verts)
      const bl = r2(b.x1 - b.x0)
      const bw = r2(b.y1 - b.y0)
      if (!(L > 0) || !(W > 0) || Math.abs(bl - L) > 0.6 || Math.abs(bw - W) > 0.6) {
        if (L > 0 && W > 0) warnings.push(`Peça "${label}": dimensões (${L}×${W}) diferem do contorno (${bl}×${bw}); usado o contorno.`)
        L = bl
        W = bw
      }
      verts = verts.map((p) => ({ x: r2(p.x - b.x0), y: r2(p.y - b.y0), edge: p.edge }))
    }
    if (!(L > 0) || !(W > 0)) {
      warnings.push(`Peça "${label}" sem dimensões válidas foi ignorada.`)
      continue
    }
    const rect = verts.length === 4 && isRectangle(verts)
    const { edges, extra } = verts.length >= 3 ? edgesFromContour(verts, L, W) : { edges: { top: false, bottom: false, left: false, right: false }, extra: 0 }
    const thickness = parseNumber(pick(first, cols.matThick)) || parseNumber(pick(first, cols.thickItem))
    const tapeRow = g.rows.find((x) => pick(x, cols.tapeFinish) || pick(x, cols.tapeDesc))
    const grain = (cols.grain ?? []).some((i) => truthy(first[i]) && !/^0([.,]0+)?$/.test((first[i] ?? '').trim()))
    const part = newPart({
      label,
      environment: cleanLabel(pick(first, cols.env)) || undefined,
      module: pick(first, cols.moduleId) || undefined,
      ref: pick(first, cols.ref) || pick(first, cols.partId) || undefined,
      length: r2(L),
      width: r2(W),
      thickness,
      quantity: Math.max(Math.round(parseNumber(pick(first, cols.qty)) || 1), 1),
      grain,
      material: cleanLabel(pick(first, cols.material)) || cleanLabel(pick(first, cols.promobMaterial)),
      materialCode: pick(first, cols.matCode) || undefined,
      sheetWidth: dimX,
      sheetHeight: parseNumber(pick(first, cols.dimY)) || undefined,
      edges,
      edgeExtra: extra > 0 ? extra : undefined,
      edgeFinish: tapeRow ? cleanLabel(pick(tapeRow, cols.tapeFinish)) || cleanLabel(pick(tapeRow, cols.tapeDesc)) || undefined : undefined,
      edgeHeight: tapeRow ? parseNumber(pick(tapeRow, cols.tapeHeight)) || undefined : undefined,
      edgeThickness: tapeRow ? parseNumber(pick(tapeRow, cols.tapeThick)) || undefined : undefined,
      contour: rect ? undefined : verts.length >= 3 ? verts : undefined,
      machining: machiningFromOps(pick(first, cols.ops), L, W, thickness, warnings, label),
    })
    parts.push(part)
  }
  if (skippedPurchased) warnings.push(`${skippedPurchased} item(ns) sem matéria-prima (ferragens/itens comprados) não entraram no plano de corte.`)
  return parts
}

// ───────────────────────────── XML ─────────────────────────────

interface XNode {
  tag: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

/** Leitor XML mínimo (sem DOM): elementos, atributos, texto, CDATA; ignora comentários e DOCTYPE. */
export function parseXml(src: string): XNode {
  const root: XNode = { tag: '#root', attrs: {}, children: [], text: '' }
  const stack: XNode[] = [root]
  const token = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g
  const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = token.exec(src))) {
    const top = stack[stack.length - 1]
    if (m[1] !== undefined) top.text += m[1]
    else if (m[2] !== undefined) {
      if (stack.length > 1) stack.pop()
    } else if (m[3] !== undefined) {
      const node: XNode = { tag: m[3], attrs: {}, children: [], text: '' }
      if (m[4]) {
        attrRe.lastIndex = 0
        let a: RegExpExecArray | null
        while ((a = attrRe.exec(m[4]))) node.attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '')
      }
      top.children.push(node)
      if (!m[5]) stack.push(node)
    } else if (m[6] !== undefined) top.text += decodeEntities(m[6])
  }
  return root.children[0] ?? root
}

const child = (n: XNode, tag: string) => n.children.find((c) => c.tag === tag)
const childText = (n: XNode, tag: string) => (child(n, tag)?.text ?? '').trim()

function* walkItems(node: XNode, ancestors: XNode[] = []): Generator<{ item: XNode; ancestors: XNode[] }> {
  for (const c of node.children) {
    if (c.tag === 'ITEM') {
      yield { item: c, ancestors }
      const inner = child(c, 'ITEMS')
      if (inner) yield* walkItems(inner, [...ancestors, c])
    } else if (c.tag !== 'PRICE' && c.tag !== 'SHAPE') yield* walkItems(c, ancestors)
  }
}

const refValue = (item: XNode, tag: string) => {
  const refs = child(item, 'REFERENCES')
  return refs ? (child(refs, tag)?.attrs.REFERENCE ?? '') : ''
}

const itemQty = (n: XNode) => {
  const q = parseNumber(n.attrs.QUANTITY)
  return q > 0 ? q : 1
}

function parsePromobXml(root: XNode, warnings: string[]): { parts: PromobPart[]; hardware: PromobHardware[]; info: PromobImport['info'] } {
  const parts: PromobPart[] = []
  const hwMap = new Map<string, PromobHardware>()
  const environments: string[] = []
  let client: string | undefined
  let project: string | undefined

  const customers = (function find(n: XNode): XNode | undefined {
    if (n.tag === 'CUSTOMERSDATA') return n
    for (const c of n.children) {
      const f = find(c)
      if (f) return f
    }
    return undefined
  })(root)
  for (const d of customers?.children ?? []) {
    const id = (d.attrs.ID ?? '').toLowerCase()
    if (id === 'nomecliente' && d.attrs.VALUE) client = d.attrs.VALUE.trim()
    if ((id === 'nomeprojeto' || id === 'projeto' || id === 'obra') && d.attrs.VALUE) project = d.attrs.VALUE.trim()
  }

  let holesWithoutCoords = 0
  const ambients: XNode[] = []
  ;(function collect(n: XNode) {
    if (n.tag === 'AMBIENT') ambients.push(n)
    else for (const c of n.children) collect(c)
  })(root)
  const scopes = ambients.length ? ambients : [root]

  for (const amb of scopes) {
    const envName = cleanLabel((amb.attrs.DESCRIPTION ?? '').replace(/\s*-\s*Ambiente 3D$/i, ''))
    if (envName && !environments.includes(envName)) environments.push(envName)
    for (const { item, ancestors } of walkItems(amb)) {
      const mult = ancestors.reduce((p, a) => p * itemQty(a) * (parseNumber(a.attrs.REPETITION) > 0 ? parseNumber(a.attrs.REPETITION) : 1), 1)
      const family = item.attrs.FAMILY ?? ''
      const isHardware = item.attrs.STRUCTURE !== 'Y' && (refValue(item, 'FERRAGEM').toUpperCase() === 'SIM' || /ferrag/i.test(family))
      if (isHardware && item.attrs.COMPONENT !== 'Y') {
        const desc = cleanLabel(item.attrs.DESCRIPTION ?? '')
        const ref = item.attrs.REFERENCE ?? ''
        if (!desc) continue
        const key = `${ref}|${desc}`
        const qty = itemQty(item) * mult
        const cur = hwMap.get(key)
        if (cur) cur.quantity += qty
        else hwMap.set(key, { description: desc, reference: ref || undefined, unit: item.attrs.UNIT || 'UN', quantity: qty })
        continue
      }
      if (item.attrs.COMPONENT !== 'Y' || item.attrs.STRUCTURE === 'Y') continue
      const sub = [...walkItems(child(item, 'ITEMS') ?? { tag: '', attrs: {}, children: [], text: '' })].map((x) => x.item)
      const sheet = sub.find((s) => s.attrs.STRUCTUREKEY === 'CHAPA')
      if (!sheet) continue
      const length = parseNumber(item.attrs.WIDTH)
      const thickness = parseNumber(item.attrs.HEIGHT)
      const width = parseNumber(item.attrs.DEPTH)
      if (!(length > 0) || !(width > 0)) continue
      const label = cleanLabel(item.attrs.DESCRIPTION ?? '') || cleanLabel(item.attrs.ID ?? '') || 'Peça'
      // fitas: cada BORDA é uma aresta; o comprimento (m) identifica se é aresta de comprimento ou de largura
      let longEdges = 0
      let shortEdges = 0
      for (const b of sub.filter((s) => s.attrs.STRUCTUREKEY === 'BORDA')) {
        const mm = parseNumber(b.attrs.QUANTITY) * 1000
        if (Math.abs(mm - (length + 5)) <= Math.abs(mm - (width + 5))) longEdges += 1
        else shortEdges += 1
      }
      const tape = sub.find((s) => s.attrs.STRUCTUREKEY === 'FITA_BORDA')
      const holes = sub.filter((s) => s.attrs.STRUCTUREKEY === 'FURAR').reduce((p, s) => p + parseNumber(s.attrs.QUANTITY), 0)
      if (holes > 0) holesWithoutCoords += 1
      const matDesc = cleanLabel(
        (sheet.attrs.DESCRIPTION ?? '')
          .replace(/^chapa\s+/i, '')
          .replace(/\bespessura\b\s*/i, '')
          .replace(/\s{2,}/g, ' '),
      )
      const moduleItem = ancestors[ancestors.length - 1]
      const qty = Math.max(Math.round(itemQty(item) * mult), 1)
      const edges = {
        bottom: longEdges >= 1,
        top: longEdges >= 2,
        left: shortEdges >= 1,
        right: shortEdges >= 2,
      }
      const edgeHeight = parseNumber(refValue(item, 'ALTURA_FITA') || (tape ? refValue(tape, 'ALTURA_FITA') : '')) || undefined
      const part = newPart({
        label,
        environment: envName || undefined,
        module: moduleItem ? cleanLabel(moduleItem.attrs.DESCRIPTION ?? moduleItem.attrs.ID ?? '') || undefined : undefined,
        ref: item.attrs.ID || undefined,
        length: r2(length),
        width: r2(width),
        thickness,
        quantity: qty,
        grain: false,
        material: matDesc,
        materialCode: sheet.attrs.REFERENCE || undefined,
        edges,
        edgeFinish: tape ? cleanLabel(tape.attrs.DESCRIPTION ?? '') || undefined : undefined,
        edgeHeight,
        edgeThickness: parseNumber(tape ? refValue(tape, 'ESPESSURA_FITA') : '') || undefined,
        note: holes > 0 ? `${holes} furo(s) previstos no roteiro (sem coordenadas no XML)` : undefined,
      })
      parts.push(part)
    }
  }
  if (holesWithoutCoords)
    warnings.push(`${holesWithoutCoords} peça(s) têm furações no roteiro, mas o XML do Promob não traz coordenadas — use o CSV de peças ou o DXF para importar as usinagens.`)
  if (parts.some((p) => p.edges.bottom || p.edges.left))
    warnings.push('O XML informa a quantidade de arestas fitadas, não o lado: a fita foi atribuída à frente (y 0) e à esquerda (x 0) primeiro. Confira nas peças.')
  return { parts, hardware: [...hwMap.values()], info: { client, project, environments } }
}

// ───────────────────────────── DXT ─────────────────────────────

function parseDxt(root: XNode): { parts: PromobPart[]; client?: string; project?: string } {
  const parts: PromobPart[] = []
  let client: string | undefined
  let project: string | undefined
  const partData = child(root, 'PartData') ?? root
  for (const p of partData.children.filter((c) => c.tag === 'Part')) {
    const f: Record<string, string> = {}
    for (const fld of p.children.filter((c) => c.tag === 'Field')) f[childText(fld, 'Name')] = childText(fld, 'Value')
    const length = parseNumber(f.Length)
    const width = parseNumber(f.Width)
    if (!(length > 0) || !(width > 0)) continue
    client ??= f.Client || undefined
    project ??= f.Project || undefined
    const canRotate = f.AllowRotate === undefined ? true : truthy(f.AllowRotate)
    parts.push(
      newPart({
        label: cleanLabel((f.PartName || f.Filename || 'Peça').replace(/\s+\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?\s*mm$/i, '')),
        module: f.Module || undefined,
        ref: f.Filename || f.UnitNumber || undefined,
        length: r2(length),
        width: r2(width),
        thickness: parseNumber(f.Thickness),
        quantity: Math.max(Math.round(parseNumber(f.Quantity) || 1), 1),
        grain: !canRotate,
        material: cleanLabel(f.Material ?? ''),
        note: f.Comment || undefined,
      }),
    )
  }
  return { parts, client, project }
}

// ───────────────────────────── DXF ─────────────────────────────

interface DxfEntity {
  type: string
  layer: string
  pts: { x: number; y: number }[]
  closed: boolean
  radius?: number
  text?: string
  height?: number
  hasBulge?: boolean
}

function readDxf(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const entities: DxfEntity[] = []
  let units = 0
  let section = ''
  let cur: DxfEntity | null = null
  let poly: DxfEntity | null = null
  let pendingX: number | null = null
  let lastVar = ''
  const flush = () => {
    if (!cur) return
    if (cur.type === 'POLYLINE') {
      cur.pts = []
      poly = cur
    }
    else if (cur.type === 'VERTEX') {
      if (poly && cur.pts.length) poly.pts.push(cur.pts[0])
    } else if (cur.type === 'SEQEND') {
      if (poly) entities.push(poly)
      poly = null
    } else entities.push(cur)
    cur = null
  }
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10)
    const raw = lines[i + 1]
    const val = raw.trim()
    if (Number.isNaN(code)) continue
    if (code === 0) {
      if (section === 'ENTITIES') flush()
      if (val === 'SECTION') continue
      if (val === 'ENDSEC') {
        section = ''
        continue
      }
      if (section === 'ENTITIES') {
        cur = { type: val, layer: '', pts: [], closed: false }
        pendingX = null
      }
      continue
    }
    if (code === 2 && !section && ['HEADER', 'ENTITIES', 'BLOCKS', 'TABLES', 'CLASSES', 'OBJECTS'].includes(val)) {
      section = val
      continue
    }
    if (section === 'HEADER') {
      if (code === 9) lastVar = val
      else if (lastVar === '$INSUNITS' && code === 70) {
        units = parseInt(val, 10) || 0
        lastVar = ''
      }
      continue
    }
    if (section !== 'ENTITIES' || !cur) continue
    switch (code) {
      case 8:
        cur.layer = raw.replace(/\r/g, '').trim()
        break
      case 10:
        pendingX = parseFloat(val)
        break
      case 20:
        if (pendingX !== null) {
          cur.pts.push({ x: pendingX, y: parseFloat(val) })
          pendingX = null
        }
        break
      case 11:
        pendingX = parseFloat(val)
        break
      case 21:
        if (pendingX !== null && cur.type === 'LINE') {
          cur.pts.push({ x: pendingX, y: parseFloat(val) })
          pendingX = null
        }
        break
      case 40:
        if (cur.type === 'CIRCLE' || cur.type === 'ARC') cur.radius = parseFloat(val)
        else cur.height = parseFloat(val)
        break
      case 42:
        if (Math.abs(parseFloat(val)) > 1e-9) cur.hasBulge = true
        break
      case 70:
        if (cur.type === 'LWPOLYLINE' || cur.type === 'POLYLINE') cur.closed = (parseInt(val, 10) & 1) === 1
        break
      case 1:
        cur.text = (cur.text ?? '') + raw.replace(/\r/g, '')
        break
      case 3:
        if (cur.type === 'MTEXT') cur.text = (cur.text ?? '') + raw.replace(/\r/g, '')
        break
    }
  }
  if (section === 'ENTITIES') flush()
  return { entities, units }
}

const unitScale = (u: number) => ({ 1: 25.4, 2: 304.8, 5: 10, 6: 1000, 10: 914.4 })[u as 1] ?? 1

type DxfKind = 'sheet' | 'scrap' | 'hole' | 'groove' | 'part' | 'other'
function kindOfLayer(layer: string): DxfKind {
  const n = strip(layer).toUpperCase()
  if (/^SOBRA/.test(n)) return 'scrap'
  if (/^CHAPA/.test(n) || /^(SHEET|STOCK|BOARD)/.test(n)) return 'sheet'
  if (/FURO|DRILL|HOLE/.test(n)) return 'hole'
  if (/RASGO|GROOVE|SLOT|CANAL/.test(n)) return 'groove'
  if (/^CORTE/.test(n) || /^(PARTS?|PECAS?|CONTORNO|OUTLINE|CONTOUR|PROFILE)/.test(n)) return 'part'
  return 'other'
}

const layerNums = (layer: string) => {
  const m = /(\d+(?:\.\d+)?)\s*Z\s*(\d+(?:\.\d+)?)/i.exec(layer)
  return m ? { d: parseFloat(m[1]), z: parseFloat(m[2]) } : null
}

function mtextClean(s: string) {
  return s
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

interface DxfExtract {
  parts: PromobPart[]
  sheet?: { w: number; h: number }
  thickness?: number
  warnings: string[]
}

/** Extrai as peças (contorno, furos e rasgos) de um DXF de chapa do Cut Pro ou de um DXF simples de peças. */
function extractDxf(text: string, fileName: string): DxfExtract {
  const warnings: string[] = []
  const { entities, units } = readDxf(text)
  const k = unitScale(units)
  const sc = (p: { x: number; y: number }) => ({ x: p.x * k, y: p.y * k })
  const polys = entities
    .filter((e) => (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') && e.pts.length >= 3)
    .map((e) => ({ ...e, pts: e.pts.map(sc), closed: e.closed || (e.pts.length > 3 && Math.hypot(e.pts[0].x - e.pts[e.pts.length - 1].x, e.pts[0].y - e.pts[e.pts.length - 1].y) < 1e-6) }))
  // sem camadas reconhecíveis? (arquivo genérico)
  const nameInfo = /^(?:\d+_)?(\d+(?:[.,]\d+)?)(.*?)(?:\(CHAPA\))?\.dxf$/i.exec(fileName)
  const fileThickness = nameInfo ? parseNumber(nameInfo[1]) : 0
  const fileMaterialRaw = nameInfo ? cleanLabel(nameInfo[2].replace(/\d+(?:MM)?$/i, '')) : ''

  let sheetPoly = polys.find((p) => kindOfLayer(p.layer) === 'sheet')
  let partPolys = polys.filter((p) => kindOfLayer(p.layer) === 'part' && p.closed)
  if (!partPolys.length) {
    const candidates = polys.filter((p) => p.closed && kindOfLayer(p.layer) !== 'sheet' && kindOfLayer(p.layer) !== 'scrap' && kindOfLayer(p.layer) !== 'groove')
    partPolys = candidates
    if (candidates.length > 2) {
      // a maior que contém as demais é a chapa
      const areaOf = (p: (typeof polys)[number]) => {
        const b = polyBBox(p.pts)
        return (b.x1 - b.x0) * (b.y1 - b.y0)
      }
      const biggest = [...candidates].sort((a, b) => areaOf(b) - areaOf(a))[0]
      const bb = polyBBox(biggest.pts)
      const inside = candidates.filter((c) => c !== biggest && polyBBox(c.pts).x0 >= bb.x0 - 0.01 && polyBBox(c.pts).x1 <= bb.x1 + 0.01 && polyBBox(c.pts).y0 >= bb.y0 - 0.01 && polyBBox(c.pts).y1 <= bb.y1 + 0.01)
      if (inside.length >= candidates.length - 1) {
        sheetPoly = sheetPoly ?? biggest
        partPolys = candidates.filter((c) => c !== biggest)
      }
    }
  }
  if (!partPolys.length) warnings.push(`${fileName}: nenhum contorno fechado de peça foi encontrado.`)

  const sheetBox = sheetPoly ? polyBBox(sheetPoly.pts) : undefined
  const zMatch = sheetPoly ? /Z\s*(\d+(?:\.\d+)?)/i.exec(sheetPoly.layer) : null
  let thickness = zMatch ? parseFloat(zMatch[1]) : fileThickness
  if (!thickness && partPolys[0]) {
    const z = layerNums(partPolys[0].layer.replace(/^[A-Z]+\s+[A-Z]\s+/i, ''))
    if (z) thickness = Math.round(z.z)
  }

  const circles = entities.filter((e) => e.type === 'CIRCLE' && e.pts.length && kindOfLayer(e.layer) !== 'scrap')
  const grooves = polys.filter((p) => kindOfLayer(p.layer) === 'groove')
  const texts = entities
    .filter((e) => (e.type === 'TEXT' || e.type === 'MTEXT') && e.text && e.pts.length)
    .map((e) => ({ text: mtextClean(e.text ?? ''), p: sc(e.pts[0]), h: (e.height ?? 0) * k }))

  interface PieceBox {
    poly: (typeof polys)[number]
    b: ReturnType<typeof polyBBox>
    part: PromobPart
    rotated: boolean
  }
  const boxes: PieceBox[] = []
  for (const poly of partPolys) {
    const b = polyBBox(poly.pts)
    const w = r2(b.x1 - b.x0)
    const h = r2(b.y1 - b.y0)
    if (w <= 0 || h <= 0) continue
    const rotated = h > w
    const L = rotated ? h : w
    const W = rotated ? w : h
    // proper rotation (sem espelhar): x local = Y - ymin ; y local = xmax - X
    const toLocal = (p: { x: number; y: number }) => (rotated ? { x: p.y - b.y0, y: b.x1 - p.x } : { x: p.x - b.x0, y: p.y - b.y0 })
    const part = newPart({
      label: 'Peça',
      length: L,
      width: W,
      thickness,
      material: fileMaterialRaw ? `${fileMaterialRaw}${thickness ? ` ${thickness}mm` : ''}` : thickness ? `Chapa ${thickness}mm` : '',
      sheetWidth: sheetBox ? Math.max(sheetBox.x1 - sheetBox.x0, sheetBox.y1 - sheetBox.y0) : undefined,
      sheetHeight: sheetBox ? Math.min(sheetBox.x1 - sheetBox.x0, sheetBox.y1 - sheetBox.y0) : undefined,
      grain: /VEIO\s*1|_VEIO[1-9]/i.test(fileName),
    })
    if (!isRectangle(poly.pts)) {
      const pts = poly.pts.map((p) => {
        const q = toLocal(p)
        return { x: r2(q.x), y: r2(q.y), edge: false } as ContourPoint
      })
      if (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6) pts.pop()
      part.contour = pts
      if (poly.hasBulge) warnings.push(`${fileName}: contorno com arcos foi aproximado por segmentos retos (peça ${Math.round(L)}×${Math.round(W)}).`)
    }
    boxes.push({ poly, b, part, rotated })
  }

  const containing = (p: { x: number; y: number }, tol = 0.5) => {
    let best: PieceBox | undefined
    let bestArea = Infinity
    for (const bx of boxes) {
      if (p.x >= bx.b.x0 - tol && p.x <= bx.b.x1 + tol && p.y >= bx.b.y0 - tol && p.y <= bx.b.y1 + tol) {
        const a = (bx.b.x1 - bx.b.x0) * (bx.b.y1 - bx.b.y0)
        if (a < bestArea) {
          best = bx
          bestArea = a
        }
      }
    }
    return best
  }
  const local = (bx: PieceBox, p: { x: number; y: number }) => (bx.rotated ? { x: p.y - bx.b.y0, y: bx.b.x1 - p.x } : { x: p.x - bx.b.x0, y: p.y - bx.b.y0 })

  for (const c of circles) {
    const center = sc(c.pts[0])
    const bx = containing(center)
    if (!bx) continue
    const nums = layerNums(c.layer)
    const d = c.radius ? c.radius * 2 * k : (nums?.d ?? 5)
    const depth = nums?.z ?? bx.part.thickness
    const face: Machining['face'] = /FACE\s*B\b|INFERIOR|BOTTOM/i.test(strip(c.layer)) ? 'fundo' : 'topo'
    const q = local(bx, center)
    bx.part.machining.push(holeOp(q.x, q.y, d, depth, face, bx.part.thickness, face === 'fundo' ? 'face inferior' : depth <= 1.5 ? 'marcação' : undefined))
  }
  for (const g of grooves) {
    const gb = polyBBox(g.pts)
    const center = { x: (gb.x0 + gb.x1) / 2, y: (gb.y0 + gb.y1) / 2 }
    const bx = containing(center)
    if (!bx) continue
    const a = local(bx, { x: gb.x0, y: gb.y0 })
    const b2 = local(bx, { x: gb.x1, y: gb.y1 })
    const lx0 = Math.min(a.x, b2.x)
    const lx1 = Math.max(a.x, b2.x)
    const ly0 = Math.min(a.y, b2.y)
    const ly1 = Math.max(a.y, b2.y)
    const nums = layerNums(g.layer)
    const alongX = lx1 - lx0 >= ly1 - ly0
    const L = bx.part.length
    const W = bx.part.width
    const m: Machining = {
      id: mid(),
      kind: 'rasgo',
      method: 'rasgo_livre',
      face: /FACE\s*B\b|INFERIOR|BOTTOM/i.test(strip(g.layer)) ? 'fundo' : 'topo',
      x: 0,
      y: 0,
      depth: r2(nums?.z ?? 6),
      axis: alongX ? 'x' : 'y',
    }
    if (alongX) {
      const s = Math.max(lx0, 0)
      m.x = r2(s)
      m.length = r2(Math.min(lx1, L) - s)
      m.width = r2(ly1 - ly0)
      m.y = r2((ly0 + ly1) / 2)
    } else {
      const s = Math.max(ly0, 0)
      m.y = r2(s)
      m.length = r2(Math.min(ly1, W) - s)
      m.width = r2(lx1 - lx0)
      m.x = r2((lx0 + lx1) / 2)
      m.note = 'rasgo no sentido da largura'
    }
    bx.part.machining.push(m)
  }

  // rótulos: número (texto inteiro) e descrição, o mais próximo dentro do contorno
  for (const bx of boxes) {
    const inside = texts.filter((t) => t.p.x >= bx.b.x0 && t.p.x <= bx.b.x1 && t.p.y >= bx.b.y0 && t.p.y <= bx.b.y1)
    const numeric = inside.find((t) => /^\d+$/.test(t.text))
    const named = inside.find((t) => t !== numeric && t.text)
    let label = named?.text ?? ''
    // "N - Nome LxA mm"
    const simple = /^(\d+)\s*-\s*(.+?)\s+\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?\s*mm$/i.exec(label)
    if (simple) label = simple[2]
    bx.part.label = cleanLabel(label) || (numeric ? `Peça ${numeric.text}` : 'Peça')
    if (numeric) bx.part.ref = numeric.text
  }
  return {
    parts: boxes.map((b) => b.part),
    sheet: sheetBox ? { w: Math.max(sheetBox.x1 - sheetBox.x0, sheetBox.y1 - sheetBox.y0), h: Math.min(sheetBox.x1 - sheetBox.x0, sheetBox.y1 - sheetBox.y0) } : undefined,
    thickness,
    warnings,
  }
}

// ───────────────────────────── API ─────────────────────────────

/** Agrupa peças idênticas (mesmo módulo, nome, medidas, material, fitas e usinagens) somando as quantidades. */
export function mergeParts(parts: PromobPart[]): PromobPart[] {
  const map = new Map<string, PromobPart>()
  for (const p of parts) {
    const mach = p.machining
      .map((m) => `${m.kind}${m.face}${m.axis ?? ''}${m.x}:${m.y}:${m.diameter ?? ''}:${m.depth}:${m.length ?? ''}:${m.width ?? ''}`)
      .sort()
      .join('|')
    const key = [
      p.environment ?? '',
      p.module ?? '',
      p.label,
      p.length,
      p.width,
      p.thickness,
      p.material,
      p.grain ? 1 : 0,
      Number(p.edges.top),
      Number(p.edges.bottom),
      Number(p.edges.left),
      Number(p.edges.right),
      p.edgeExtra ?? 0,
      p.contour ? p.contour.map((c) => `${c.x},${c.y},${c.edge ? 1 : 0}`).join(';') : '',
      mach,
    ].join('§')
    const cur = map.get(key)
    if (cur) cur.quantity += p.quantity
    else map.set(key, { ...p, machining: p.machining.map((m) => ({ ...m })) })
  }
  return [...map.values()]
}

export interface PromobFileInput {
  name: string
  bytes: Uint8Array
}

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()

export const PROMOB_EXTENSIONS = ['csv', 'txt', 'xml', 'dxf', 'dxt']
export const isPromobFile = (name: string) => PROMOB_EXTENSIONS.includes(extOf(name))

function sniff(name: string, text: string): PromobFormat | null {
  const ext = extOf(name)
  const head = text.slice(0, 4000)
  if (ext === 'dxf' || /^\s*0\s*\r?\n\s*SECTION/.test(head)) return 'dxf'
  if (ext === 'dxt' || /<ListInformation[\s>]/i.test(head)) return /<PartData/i.test(text.slice(0, 20000)) ? 'dxt' : null
  if (ext === 'xml' || /^\s*<\?xml|^\s*<[A-Za-z]/.test(head)) {
    if (/<LISTING[\s>]/i.test(head) || /<AMBIENTS[\s>]|<CUSTOMERSDATA/i.test(text.slice(0, 200000))) return 'xml'
    if (/<ListInformation[\s>]/i.test(head)) return 'dxt'
    return ext === 'xml' ? 'xml' : null
  }
  if (ext === 'csv' || ext === 'txt') return 'csv-lista'
  return null
}

function parseCsvText(text: string, fileName: string): { format: PromobFormat; parts: PromobPart[]; warnings: string[]; info: PromobImport['info'] } {
  const warnings: string[] = []
  const rows = parseCsv(text, detectDelimiter(text))
  if (rows.length < 2) throw new Error(`${fileName}: arquivo CSV vazio.`)
  const headers = rows[0]
  const lista = resolveColumns(headers, LISTA_COLUMNS)
  const pecas = resolveColumns(headers, PECAS_COLUMNS)
  const isPecas = pecas.px.length > 0 && pecas.py.length > 0 && pecas.length.length > 0
  const isLista = lista.length.length > 0 && lista.width.length > 0
  if (isPecas) {
    const parts = parseCsvPecas(rows, pecas, warnings)
    const info = {
      client: pick(rows[1], pecas.client) || undefined,
      project: pick(rows[1], pecas.project) || undefined,
      environments: [...new Set(parts.map((p) => p.environment).filter(Boolean) as string[])],
    }
    return { format: 'csv-pecas', parts, warnings, info }
  }
  if (isLista) {
    const parts = parseCsvLista(rows, lista, warnings)
    const info = {
      client: pick(rows[1], lista.client) || undefined,
      project: pick(rows[1], lista.clientCode) || undefined,
      responsible: pick(rows[1], lista.responsible) || undefined,
      environments: [...new Set(parts.map((p) => p.environment).filter(Boolean) as string[])],
    }
    return { format: 'csv-lista', parts, warnings, info }
  }
  throw new Error(`${fileName}: não reconheci as colunas (esperado: COMPRIMENTO_X/LARGURA_Y ou PONTO X ITEM/ALTURA (X)).`)
}

/**
 * Lê um ou mais arquivos Promob e devolve um único conjunto de peças.
 * DXFs enviados junto com um DXT (mesmo nome do campo Filename) completam contorno e usinagens das peças.
 */
export function parsePromobFiles(files: PromobFileInput[]): PromobImport {
  if (!files.length) throw new Error('Nenhum arquivo informado.')
  const warnings: string[] = []
  const parts: PromobPart[] = []
  const hardware: PromobHardware[] = []
  const info: PromobImport['info'] = { environments: [] }
  const formats = new Set<PromobFormat>()
  let ignored = 0
  const seenNames = new Map<string, number>()
  const dxfByName = new Map<string, string>()
  const dxts: { name: string; root: XNode }[] = []
  const dxfs: { name: string; text: string }[] = []

  for (const f of files) {
    const nameKey = f.name.toLowerCase()
    seenNames.set(nameKey, (seenNames.get(nameKey) ?? 0) + 1)
    const text = decodeBytes(f.bytes)
    const fmt = sniff(f.name, text)
    if (!fmt) {
      ignored += 1
      if (ignored <= 5) warnings.push(`${f.name}: formato não reconhecido (ignorado).`)
      continue
    }
    try {
      if (fmt === 'dxf') {
        dxfs.push({ name: f.name, text })
        dxfByName.set(f.name.toLowerCase(), text)
      } else if (fmt === 'dxt') dxts.push({ name: f.name, root: parseXml(text) })
      else if (fmt === 'xml') {
        const root = parseXml(text)
        const r = parsePromobXml(root, warnings)
        parts.push(...r.parts)
        hardware.push(...r.hardware)
        info.client ??= r.info.client
        info.project ??= r.info.project
        info.environments.push(...r.info.environments)
        formats.add('xml')
      } else {
        const r = parseCsvText(text, f.name)
        parts.push(...r.parts)
        warnings.push(...r.warnings)
        info.client ??= r.info.client
        info.project ??= r.info.project
        info.responsible ??= r.info.responsible
        info.environments.push(...r.info.environments)
        formats.add(r.format)
      }
    } catch (e) {
      warnings.push(e instanceof Error ? e.message : `${f.name}: falha na leitura.`)
    }
  }

  const usedDxf = new Set<string>()
  for (const d of dxts) {
    const parsed = parseDxt(d.root)
    const dp = parsed.parts
    info.client ??= parsed.client
    info.project ??= parsed.project
    for (const p of dp) {
      const key = (p.ref ?? '').toLowerCase()
      const dxfText = key ? dxfByName.get(key) : undefined
      if (dxfText) {
        const ex = extractDxf(dxfText, p.ref ?? 'peça.dxf')
        const piece = ex.parts[0]
        if (piece) {
          p.machining = piece.machining
          if (piece.contour) p.contour = piece.contour
          // coordenadas do DXF seguem o comprimento maior; ajusta se o DXT veio girado
          if (Math.abs(piece.length - p.length) > 0.6 && Math.abs(piece.length - p.width) < 0.6) {
            warnings.push(`${p.ref}: orientação do DXF difere da lista; usinagens seguem o desenho do DXF.`)
          }
          usedDxf.add(key)
        }
      }
    }
    parts.push(...dp)
    formats.add('dxt')
  }
  if (dxts.length && dxfByName.size && !usedDxf.size) warnings.push('Os DXFs enviados não correspondem aos nomes de arquivo (Filename) do DXT.')

  const dxfStandalone = dxfs.filter((d) => !usedDxf.has(d.name.toLowerCase()))
  let lots = 0
  for (const d of dxfStandalone) {
    const ex = extractDxf(d.text, d.name)
    if (warnings.length < 200) warnings.push(...ex.warnings)
    if (ex.parts.length) lots += 1
    parts.push(...ex.parts)
    formats.add('dxf')
  }
  if (ignored > 5) warnings.push(`… e mais ${ignored - 5} arquivo(s) que não são do Promob foram ignorados.`)
  const repeated = [...seenNames.entries()].filter(([, n]) => n > 1)
  if (repeated.length) {
    const total = repeated.reduce((sum, [, n]) => sum + n - 1, 0)
    warnings.push(`${total} arquivo(s) têm nome repetido (ex.: ${repeated[0][0]}). Todos foram lidos e as peças iguais foram somadas — confira se não são cópias do mesmo lote.`)
  }

  const merged = mergeParts(parts).filter((p) => p.length > 0 && p.width > 0)
  info.environments = [...new Set(info.environments.filter(Boolean))]
  const format: PromobFormat = formats.size === 1 ? [...formats][0] : formats.has('csv-pecas') ? 'csv-pecas' : formats.has('xml') ? 'xml' : ([...formats][0] ?? 'csv-lista')
  if (!merged.length) warnings.push('Nenhuma peça de corte foi encontrada nos arquivos.')
  return { format, fileNames: files.map((f) => f.name), parts: merged, hardware, warnings, info, lots, ignored }
}

/** Materiais distintos do arquivo (chave de mapeamento para o estoque). */
export function summarizeMaterials(parts: PromobPart[]): MaterialSummary[] {
  const map = new Map<string, MaterialSummary>()
  for (const p of parts) {
    const key = `${p.material || 'Sem material'}|${p.thickness}`
    const cur = map.get(key)
    const area = (p.length * p.width * p.quantity) / 1e6
    if (cur) {
      cur.lines += 1
      cur.units += p.quantity
      cur.area += area
      cur.sheetWidth ??= p.sheetWidth
      cur.sheetHeight ??= p.sheetHeight
    } else
      map.set(key, {
        key,
        name: p.material || 'Sem material',
        thickness: p.thickness,
        sheetWidth: p.sheetWidth,
        sheetHeight: p.sheetHeight,
        code: p.materialCode,
        lines: 1,
        units: p.quantity,
        area,
      })
  }
  return [...map.values()].sort((a, b) => b.area - a.area).map((m) => ({ ...m, area: r2(m.area) }))
}

const partEdgeMeters = (p: PromobPart) =>
  ((p.edges.top ? p.length : 0) + (p.edges.bottom ? p.length : 0) + (p.edges.left ? p.width : 0) + (p.edges.right ? p.width : 0) + (p.edgeExtra ?? 0)) / 1000

/** Fitas de borda distintas com o metro linear total (por unidade × quantidade). */
export function summarizeEdges(parts: PromobPart[]): EdgeSummary[] {
  const map = new Map<string, EdgeSummary>()
  for (const p of parts) {
    const m = partEdgeMeters(p) * p.quantity
    if (m <= 0) continue
    const name = p.edgeFinish || 'Fita de borda'
    const key = `${name}|${p.edgeThickness ?? ''}`
    const cur = map.get(key)
    if (cur) {
      cur.meters += m
      cur.height ??= p.edgeHeight
    } else map.set(key, { name, meters: m, height: p.edgeHeight, thickness: p.edgeThickness })
  }
  return [...map.values()].map((e) => ({ ...e, meters: r2(e.meters) })).sort((a, b) => b.meters - a.meters)
}

/** Converte as peças importadas em peças do plano, aplicando o mapeamento material → item do estoque. */
export function toCutPieces(parts: PromobPart[], materialByKey: Record<string, string | undefined>): CutPiece[] {
  return parts.map((p) => {
    const key = `${p.material || 'Sem material'}|${p.thickness}`
    const piece: CutPiece = {
      id: mid(),
      label: p.label,
      module: [p.environment, p.module].filter(Boolean).join(' · ') || undefined,
      length: p.length,
      width: p.width,
      quantity: p.quantity,
      rotate: !p.grain,
      materialId: materialByKey[key],
      edgeTop: p.edges.top || undefined,
      edgeBottom: p.edges.bottom || undefined,
      edgeLeft: p.edges.left || undefined,
      edgeRight: p.edges.right || undefined,
      edgeExtra: p.edgeExtra,
      contour: p.contour?.map((c) => ({ ...c })),
      environment: p.environment,
      sourceMaterial: p.material || undefined,
      machining: p.machining.map((m) => ({ ...m, id: mid() })),
    }
    return piece
  })
}

/** Resumo textual curto para a tela de importação. */
export function importStats(imp: PromobImport) {
  const units = imp.parts.reduce((s, p) => s + p.quantity, 0)
  const holes = imp.parts.reduce((s, p) => s + p.quantity * p.machining.filter((m) => m.kind === 'furo').length, 0)
  const grooves = imp.parts.reduce((s, p) => s + p.quantity * p.machining.filter((m) => m.kind !== 'furo').length, 0)
  const edgeMeters = r2(imp.parts.reduce((s, p) => s + partEdgeMeters(p) * p.quantity, 0))
  const irregular = imp.parts.filter((p) => p.contour).length
  return { lines: imp.parts.length, units, holes, grooves, edgeMeters, irregular }
}

// ───────────────────────────── mapeamento para o estoque ─────────────────────────────

const STOP = new Set(['mm', 'chapa', 'chapas', 'de', 'da', 'do', 'das', 'dos', 'com', 'para', 'espessura', 'cores', 'cor', 'mdf', 'mdp', 'tx'])
const tokens = (s: string) =>
  strip(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !STOP.has(t))

type StockLike = Pick<Material, 'id' | 'name' | 'category' | 'thickness' | 'sheetWidth' | 'sheetHeight' | 'active'>

/**
 * Sugere o item do estoque que corresponde a um nome do Promob: compara as palavras do nome
 * (cor/acabamento) e, para chapas, exige a mesma espessura. Devolve null quando não há correspondência razoável.
 */
export function suggestMaterial(
  name: string,
  thickness: number,
  sheet: { w?: number; h?: number },
  stock: StockLike[],
  category: Material['category'],
): { id: string; score: number } | null {
  const want = tokens(name)
  if (!want.length) return null
  let best: { id: string; score: number } | null = null
  for (const m of stock) {
    if (m.category !== category || m.active === false) continue
    if (category === 'chapa' && thickness > 0 && m.thickness && Math.abs(m.thickness - thickness) > 0.6) continue
    const have = new Set(tokens(m.name))
    const hit = want.filter((t) => have.has(t) || [...have].some((h) => h.length >= 4 && (h.startsWith(t) || t.startsWith(h)))).length
    let score = hit / want.length
    if (score < 0.5) continue
    if (category === 'chapa' && sheet.w && sheet.h && m.sheetWidth && m.sheetHeight) {
      const same = (Math.abs(m.sheetWidth - sheet.w) < 60 && Math.abs(m.sheetHeight - sheet.h) < 60) || (Math.abs(m.sheetWidth - sheet.h) < 60 && Math.abs(m.sheetHeight - sheet.w) < 60)
      if (same) score += 0.15
    }
    if (!best || score > best.score) best = { id: m.id, score }
  }
  return best
}

/** Mapeamento automático material do arquivo → estoque (somente correspondências confiáveis). */
export function autoMapMaterials(parts: PromobPart[], stock: StockLike[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const m of summarizeMaterials(parts)) {
    const hit = suggestMaterial(m.name, m.thickness, { w: m.sheetWidth, h: m.sheetHeight }, stock, 'chapa')
    out[m.key] = hit?.id
  }
  return out
}

/** Fita mais usada do arquivo, procurada entre as fitas do estoque. */
export function autoMapEdge(parts: PromobPart[], stock: StockLike[]): string | undefined {
  const top = summarizeEdges(parts)[0]
  if (!top) return undefined
  return suggestMaterial(top.name, 0, {}, stock, 'fita_borda')?.id
}
