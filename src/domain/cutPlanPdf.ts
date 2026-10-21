import { jsPDF } from 'jspdf'
import qrcode from 'qrcode-generator'
import { BRAND_COLOR } from '../brand/logoData.ts'
import { brl, fmtDate } from '../lib/format.ts'
import { edgeMetersOf, edgeSegments, methodLabel, pieceToSheet } from './machining.ts'
import { analyzeSheet, usableLeftovers } from './cutSequence.ts'
import { labelCode } from './shopfloor.ts'
import type { CutPiece, CutPlanCosts, CutPlanGroup } from '../types'

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export interface PlanPdfLogo {
  data: string
  ratio: number
}

export interface PlanPdfData {
  code?: string
  title: string
  projectName?: string
  clientName?: string
  responsibleName?: string
  mode: 'seccionadora' | 'cnc'
  kerf: number
  trim: number
  groups: CutPlanGroup[]
  pieces: CutPiece[]
  costs: CutPlanCosts
  hardware: { description: string; quantity: number; unitCost: number }[]
  edgeName?: string
  edgeUnitCost?: number
  /** logo em PNG (data URL) e proporção largura/altura; sem ele o cabeçalho usa o nome em texto */
  logo?: PlanPdfLogo
  machineName?: string
  notes?: string
  /** origem dos dados (arquivos importados) */
  sources?: string[]
}

// paleta dos símbolos (preenchimento claro + traço), como na legenda do mapa de corte
const PALETTE: [string, string][] = [
  ['#dbeafe', '#2563eb'],
  ['#dcfce7', '#16a34a'],
  ['#fef3c7', '#d97706'],
  ['#fce7f3', '#db2777'],
  ['#ede9fe', '#7c3aed'],
  ['#ccfbf1', '#0d9488'],
  ['#ffedd5', '#ea580c'],
  ['#e0f2fe', '#0284c7'],
  ['#f3e8ff', '#9333ea'],
  ['#fee2e2', '#dc2626'],
  ['#ecfccb', '#65a30d'],
  ['#e2e8f0', '#475569'],
]

const symbolOf = (n: number) => {
  let s = ''
  let i = n
  do {
    s = String.fromCharCode(65 + (i % 26)) + s
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return s
}

const mm = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))
const FACE_LABEL: Record<string, string> = { topo: 'Topo', fundo: 'Face inferior', borda: 'Borda' }

interface Row {
  pieceId: string
  sub?: string
  sym: string
  fill: string
  stroke: string
  name: string
  length: number
  width: number
  thickness: number
  qty: number
}

/**
 * Relatório do plano de corte em A4 retrato: resumo de materiais e custos (com a logo),
 * uma página de mapa por chapa (lista dos cortes, mapa colorido com fitas e usinagens, legendas)
 * e a tabela de usinagens por peça — no estilo do "Mapa de Corte" de referência.
 */
export function buildPlanPdf(d: PlanPdfData): Blob {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })
  const brand = rgb(BRAND_COLOR)
  const PW = pdf.internal.pageSize.getWidth()
  const PH = pdf.internal.pageSize.getHeight()
  const M = 8
  const byId = new Map(d.pieces.map((p) => [p.id, p]))
  const today = fmtDate(new Date().toISOString())
  const totalSheets = d.groups.reduce((s, g) => s + g.sheets.length, 0)
  const methodText = d.mode === 'cnc' ? `Router CNC (fresa/folga ${d.kerf} mm)` : `Seccionadora (disco ${d.kerf} mm)`

  // símbolo e cor por peça, na ordem em que aparecem nas chapas
  const symbols = new Map<string, { sym: string; fill: string; stroke: string }>()
  for (const g of d.groups)
    for (const sh of g.sheets)
      for (const pl of sh.placements) {
        if (symbols.has(pl.pieceId)) continue
        const n = symbols.size
        const [fill, stroke] = PALETTE[n % PALETTE.length]
        symbols.set(pl.pieceId, { sym: symbolOf(n), fill, stroke })
      }

  const setFill = (hex: string) => pdf.setFillColor(...rgb(hex))
  const setDraw = (hex: string) => pdf.setDrawColor(...rgb(hex))
  const frame = () => {
    pdf.setDrawColor(40, 52, 70)
    pdf.setLineWidth(0.3)
    pdf.rect(M, M, PW - 2 * M, PH - 2 * M)
  }
  const label = (text: string, x: number, y: number) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6)
    pdf.setTextColor(...brand)
    pdf.text(text.toUpperCase(), x, y)
    pdf.setFont('helvetica', 'normal')
  }
  const drawLogo = (x: number, y: number, h: number) => {
    if (d.logo) pdf.addImage(d.logo.data, 'PNG', x, y, h * d.logo.ratio, h)
    else {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(h * 2.4)
      pdf.setTextColor(...brand)
      pdf.text('CORE CUT', x, y + h * 0.85)
      pdf.setFont('helvetica', 'normal')
    }
  }
  const metaGrid = (x: number, y: number, w: number, items: [string, string][], cols: number) => {
    const cw = w / cols
    items.forEach(([k, v], i) => {
      const cx = x + (i % cols) * cw
      const cy = y + Math.floor(i / cols) * 9.5
      label(k, cx, cy)
      pdf.setFontSize(7.5)
      pdf.setTextColor(30)
      pdf.text((pdf.splitTextToSize(v || '—', cw - 3) as string[])[0] ?? '—', cx, cy + 4)
    })
  }

  // --------------------------------------------------- 1) resumo do plano
  frame()
  drawLogo(M + 5, M + 5, 9)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(18)
  pdf.setTextColor(...brand)
  pdf.text('Plano de corte', M + 5, M + 28)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9.5)
  pdf.setTextColor(80)
  pdf.text(`${d.code ?? ''}${d.code ? '  ·  ' : ''}${d.title}`.slice(0, 90), M + 5, M + 34)
  pdf.setDrawColor(...brand)
  pdf.setLineWidth(0.6)
  pdf.line(M + 5, M + 38, PW - M - 5, M + 38)
  metaGrid(
    M + 5,
    M + 45,
    PW - 2 * M - 10,
    [
      ['Projeto', d.projectName ?? '—'],
      ['Cliente', d.clientName ?? '—'],
      ['Responsável', d.responsibleName ?? '—'],
      ['Método de corte', methodText],
      ['Refilo', `${d.trim} mm`],
      ['Data de emissão', today],
      ['Chapas', `${totalSheets} em ${d.groups.length} material(is)`],
      ['Peças', `${d.pieces.reduce((s, p) => s + p.quantity, 0)} unidades`],
      ['Custo total', brl(d.costs.total)],
    ],
    3,
  )

  let y = M + 80
  setFill(BRAND_COLOR)
  pdf.rect(M + 5, y, PW - 2 * M - 10, 6.5, 'F')
  pdf.setFontSize(7)
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  const rx = PW - M - 7
  pdf.text('MATERIAL', M + 7, y + 4.4)
  pdf.text('CHAPA (mm)', 112, y + 4.4)
  pdf.text('CHAPAS', 150, y + 4.4, { align: 'right' })
  pdf.text('APROVEIT.', 170, y + 4.4, { align: 'right' })
  pdf.text('CUSTO', rx, y + 4.4, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  y += 6.5
  pdf.setTextColor(40)
  pdf.setFontSize(8)
  for (const g of d.groups) {
    const lines = pdf.splitTextToSize(g.materialName, 98) as string[]
    y += 5.2
    pdf.text(lines[0] ?? '', M + 7, y)
    pdf.text(`${g.sheetWidth} × ${g.sheetHeight} × ${g.thickness || '—'}`, 112, y)
    pdf.text(String(g.sheets.length), 150, y, { align: 'right' })
    pdf.text(`${g.utilization}%`, 170, y, { align: 'right' })
    pdf.text(brl(g.cost), rx, y, { align: 'right' })
    if (lines[1]) {
      y += 4
      pdf.setTextColor(120)
      pdf.text(lines[1], M + 7, y)
      pdf.setTextColor(40)
    }
    pdf.setDrawColor(225)
    pdf.setLineWidth(0.15)
    pdf.line(M + 5, y + 1.8, PW - M - 5, y + 1.8)
    if (y > PH - 80) break
  }

  y += 12
  const costLines: [string, string][] = [
    ['Chapas', brl(d.costs.sheets)],
    [`Fita de borda (${d.costs.edgeMeters.toFixed(1).replace('.', ',')} m${d.edgeName ? ` · ${d.edgeName.slice(0, 40)}` : ''} · +10% de perda)`, brl(d.costs.edge)],
    ['Ferragens', brl(d.costs.hardware)],
    [`Usinagem e mão de obra (${d.costs.holes} furos, ${d.costs.grooves} rasgos/recortes, ${d.costs.minutes} min)`, brl(d.costs.machining)],
  ]
  label('Composição do custo', M + 5, y - 5)
  pdf.setFontSize(8.5)
  for (const [k, v] of costLines) {
    pdf.setTextColor(70)
    pdf.text(k, M + 7, y)
    pdf.text(v, 150, y, { align: 'right' })
    y += 5.2
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(...brand)
  pdf.text('TOTAL', M + 7, y + 2)
  pdf.text(brl(d.costs.total), 150, y + 2, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  y += 12

  if (d.hardware.length) {
    label('Ferragens do plano', M + 5, y)
    y += 4.5
    pdf.setFontSize(8)
    pdf.setTextColor(50)
    for (const h of d.hardware.slice(0, 18)) {
      pdf.text(h.description.slice(0, 70), M + 7, y)
      pdf.text(`${h.quantity} un`, 150, y, { align: 'right' })
      pdf.text(brl(h.quantity * h.unitCost), rx, y, { align: 'right' })
      y += 4.6
      if (y > PH - 40) break
    }
    y += 4
  }
  if (d.sources?.length) {
    label('Arquivos de origem', M + 5, y)
    pdf.setFontSize(7.5)
    pdf.setTextColor(90)
    pdf.text((pdf.splitTextToSize(d.sources.join(' · '), PW - 2 * M - 14) as string[]).slice(0, 3), M + 7, y + 4.4)
    y += 14
  }
  if (d.notes?.trim()) {
    label('Observações', M + 5, y)
    pdf.setFontSize(8)
    pdf.setTextColor(70)
    pdf.text((pdf.splitTextToSize(d.notes.trim(), PW - 2 * M - 14) as string[]).slice(0, 6), M + 7, y + 4.4)
  }

  // --------------------------------------------------- 2) mapa de cada chapa
  const LEFT_W = 64
  const RX = M + LEFT_W + 4 // início da área direita
  const RW = PW - M - RX - 4
  const ROW_H = 8.4
  const LIST_TOP = 63
  const rowsPerPage = Math.floor((PH - M - 6 - LIST_TOP) / ROW_H)
  let distribution = 0

  const leftList = (rows: Row[], thick: number, headerMaterial: string, sheetW: number, sheetH: number) => {
    drawLogo(M + 4, M + 5, 7)
    label('Chapa de', M + 4, M + 22)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9.5)
    pdf.setTextColor(30, 41, 59)
    const nameLines = (pdf.splitTextToSize(headerMaterial, LEFT_W - 8) as string[]).slice(0, 2)
    pdf.text(nameLines, M + 4, M + 27)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.2)
    pdf.setTextColor(90)
    pdf.text(`Tamanho da chapa: ${sheetW} × ${sheetH} mm`, M + 4, M + 27 + nameLines.length * 4.2 + 1)
    label('Lista dos cortes', M + 4, LIST_TOP - 5)
    pdf.setDrawColor(210)
    pdf.setLineWidth(0.2)
    pdf.line(M, LIST_TOP - 3, M + LEFT_W, LIST_TOP - 3)
    pdf.setFontSize(5.8)
    pdf.setTextColor(110)
    pdf.setFont('helvetica', 'bold')
    pdf.text('SÍMB.', M + 2, LIST_TOP)
    pdf.text('PEÇA', M + 13, LIST_TOP)
    pdf.text('COMP.', M + 38.5, LIST_TOP, { align: 'right' })
    pdf.text('LARG.', M + 47, LIST_TOP, { align: 'right' })
    pdf.text('ESP.', M + 54, LIST_TOP, { align: 'right' })
    pdf.text('QTD.', M + 61.5, LIST_TOP, { align: 'right' })
    pdf.setFont('helvetica', 'normal')
    pdf.setDrawColor(210)
    pdf.line(M, LIST_TOP + 1.8, M + LEFT_W, LIST_TOP + 1.8)
    rows.forEach((r, i) => {
      const ry = LIST_TOP + 2 + i * ROW_H
      setFill(r.fill)
      setDraw(r.stroke)
      pdf.setLineWidth(0.35)
      pdf.rect(M + 2, ry + 1.8, 4, 4, 'FD')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(6.5)
      pdf.setTextColor(30)
      pdf.text(r.sym, M + 8.2, ry + 5)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6.2)
      const nm = (pdf.splitTextToSize(r.name, 22) as string[]).slice(0, r.sub ? 1 : 2)
      pdf.text(nm, M + 13, ry + 3.6)
      if (r.sub) {
        pdf.setFontSize(5.2)
        pdf.setTextColor(120)
        pdf.text((pdf.splitTextToSize(r.sub, 22) as string[])[0] ?? '', M + 13, ry + 6.6)
        pdf.setTextColor(30)
      }
      pdf.setFontSize(6.6)
      pdf.text(mm(r.length), M + 38.5, ry + 5, { align: 'right' })
      pdf.text(mm(r.width), M + 47, ry + 5, { align: 'right' })
      pdf.text(thick ? String(thick) : '—', M + 54, ry + 5, { align: 'right' })
      pdf.text(String(r.qty), M + 61.5, ry + 5, { align: 'right' })
      pdf.setDrawColor(228)
      pdf.setLineWidth(0.15)
      pdf.line(M, ry + ROW_H - 0.6, M + LEFT_W, ry + ROW_H - 0.6)
    })
    pdf.setDrawColor(40, 52, 70)
    pdf.setLineWidth(0.3)
    pdf.line(M + LEFT_W, M, M + LEFT_W, PH - M)
    pdf.line(M, M + 46, M + LEFT_W, M + 46)
  }

  for (const g of d.groups) {
    for (const sheet of g.sheets) {
      distribution += 1
      const count = new Map<string, number>()
      for (const pl of sheet.placements) count.set(pl.pieceId, (count.get(pl.pieceId) ?? 0) + 1)
      const rows: Row[] = [...count.entries()]
        .map(([pieceId, qty]) => {
          const piece = byId.get(pieceId)
          const sym = symbols.get(pieceId)!
          return { pieceId, sub: piece?.module, ...sym, name: piece?.label || 'Peça', length: piece?.length ?? 0, width: piece?.width ?? 0, thickness: g.thickness, qty }
        })
        .sort((a, b) => a.sym.length - b.sym.length || a.sym.localeCompare(b.sym))

      pdf.addPage()
      frame()
      leftList(rows.slice(0, rowsPerPage), g.thickness, g.materialName, g.sheetWidth, g.sheetHeight)

      // cabeçalho direito
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(17)
      pdf.setTextColor(30, 41, 59)
      pdf.text('Distribuição do trabalho', RX, M + 14)
      pdf.setFont('helvetica', 'normal')
      pdf.setDrawColor(190)
      pdf.setLineWidth(0.25)
      pdf.line(RX, M + 18, PW - M - 4, M + 18)
      metaGrid(
        RX,
        M + 24,
        RW,
        [
          ['Projeto', d.projectName ?? '—'],
          ['Cliente', d.clientName ?? '—'],
          ['Responsável', d.responsibleName ?? '—'],
          ['Plano', `${d.code ?? ''} ${d.title}`.trim()],
          ['Máquina', d.machineName ?? (d.mode === 'cnc' ? 'Router CNC' : 'Seccionadora')],
          ['Data de emissão', today],
          ['Distribuição', `${distribution} de ${totalSheets}`],
          ['Aproveitamento', `${sheet.utilization}%`],
        ],
        4,
      )
      pdf.setDrawColor(40, 52, 70)
      pdf.setLineWidth(0.3)
      pdf.line(RX - 4, M + 46, PW - M, M + 46)

      // título do mapa
      label('Mapa de produção', RX, M + 53)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(11)
      pdf.setTextColor(30, 41, 59)
      pdf.text(`Chapa ${sheet.index} · ${g.materialName.slice(0, 44)}${g.thickness ? ` · ${g.thickness} mm` : ''}`, RX, M + 59.5)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.setTextColor(110)
      pdf.text(`${g.sheetWidth} × ${g.sheetHeight} mm`, PW - M - 4, M + 53, { align: 'right' })
      pdf.text(`${sheet.placements.length} cortes`, PW - M - 4, M + 57.5, { align: 'right' })

      // mapa
      const mapTop = M + 72
      const GUTTER = 7
      const scale = Math.min((RW - GUTTER) / g.sheetWidth, 128 / g.sheetHeight)
      const mw = g.sheetWidth * scale
      const mh = g.sheetHeight * scale
      const ox = RX + GUTTER + (RW - GUTTER - mw) / 2
      const oy = mapTop
      pdf.setFontSize(7)
      pdf.setTextColor(60)
      pdf.text(`${g.sheetWidth} mm`, ox + mw / 2, oy - 2.5, { align: 'center' })
      pdf.text(`${g.sheetHeight} mm`, ox - 2.5, oy + mh / 2, { align: 'center', angle: 90 })
      setFill('#ffffff')
      pdf.setDrawColor(40, 52, 70)
      pdf.setLineWidth(0.4)
      pdf.rect(ox, oy, mw, mh, 'FD')
      if (d.trim > 0) {
        pdf.setDrawColor(190)
        pdf.setLineWidth(0.15)
        pdf.setLineDashPattern([0.8, 0.8], 0)
        pdf.rect(ox + d.trim * scale, oy + d.trim * scale, mw - 2 * d.trim * scale, mh - 2 * d.trim * scale)
        pdf.setLineDashPattern([], 0)
      }

      const X = (v: number) => ox + v * scale
      const Y = (v: number) => oy + v * scale
      for (const pl of sheet.placements) {
        const piece = byId.get(pl.pieceId)
        const sym = symbols.get(pl.pieceId)!
        setFill(sym.fill)
        setDraw(sym.stroke)
        pdf.setLineWidth(0.3)
        if (piece?.contour && piece.contour.length >= 3) {
          const pts = piece.contour.map((c) => pieceToSheet(pl, piece, c.x, c.y))
          const rel: number[][] = []
          for (let i = 1; i < pts.length; i++) rel.push([(pts[i].x - pts[i - 1].x) * scale, (pts[i].y - pts[i - 1].y) * scale])
          pdf.lines(rel, X(pts[0].x), Y(pts[0].y), [1, 1], 'FD', true)
        } else pdf.rect(X(pl.x), Y(pl.y), pl.w * scale, pl.h * scale, 'FD')

        if (piece) {
          // fitas de borda
          pdf.setLineWidth(0.9)
          pdf.setDrawColor(...brand)
          for (const [x1, y1, x2, y2] of edgeSegments(piece)) {
            const a = pieceToSheet(pl, piece, x1, y1)
            const b = pieceToSheet(pl, piece, x2, y2)
            pdf.line(X(a.x), Y(a.y), X(b.x), Y(b.y))
          }
          // usinagens
          for (const m of piece.machining ?? []) {
            if (m.kind === 'furo') {
              const c = pieceToSheet(pl, piece, m.x, m.y)
              if (m.face === 'borda') {
                setDraw('#d97706')
                pdf.setLineWidth(0.5)
                pdf.circle(X(c.x), Y(c.y), 0.7, 'S')
                continue
              }
              pdf.setLineWidth(0.18)
              pdf.setDrawColor(30)
              setFill('#ffffff')
              if (m.face === 'fundo') pdf.setLineDashPattern([0.4, 0.4], 0)
              pdf.circle(X(c.x), Y(c.y), Math.max(((m.diameter ?? 5) / 2) * scale, 0.55), 'FD')
              pdf.setLineDashPattern([], 0)
            } else if (m.kind === 'rasgo') {
              const alongY = m.axis === 'y'
              const a = pieceToSheet(pl, piece, m.x, m.y)
              const b = alongY ? pieceToSheet(pl, piece, m.x, m.y + (m.length ?? 0)) : pieceToSheet(pl, piece, m.x + (m.length ?? 0), m.y)
              pdf.setDrawColor(30, 41, 59)
              pdf.setLineWidth(Math.max((m.width ?? 6) * scale, 0.35))
              if (m.face === 'fundo') pdf.setLineDashPattern([1, 0.8], 0)
              pdf.line(X(a.x), Y(a.y), X(b.x), Y(b.y))
              pdf.setLineDashPattern([], 0)
            } else {
              const c1 = pieceToSheet(pl, piece, m.x, m.y)
              const c2 = pieceToSheet(pl, piece, m.x + (m.length ?? 0), m.y + (m.width ?? 0))
              pdf.setDrawColor(30, 41, 59)
              pdf.setLineWidth(0.25)
              pdf.setLineDashPattern([1, 0.7], 0)
              pdf.rect(X(Math.min(c1.x, c2.x)), Y(Math.min(c1.y, c2.y)), Math.abs(c2.x - c1.x) * scale, Math.abs(c2.y - c1.y) * scale)
              pdf.setLineDashPattern([], 0)
            }
          }
        }
        // símbolo e medidas
        const cx = X(pl.x + pl.w / 2)
        const cy = Y(pl.y + pl.h / 2)
        if (pl.w * scale > 5 && pl.h * scale > 4) {
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(Math.min(9, Math.max(5.5, Math.min(pl.w, pl.h) * scale * 0.4)))
          pdf.setTextColor(30)
          pdf.text(sym.sym, cx, cy, { align: 'center' })
          pdf.setFont('helvetica', 'normal')
          if (pl.w * scale > 16 && pl.h * scale > 8) {
            pdf.setFontSize(5.6)
            pdf.setTextColor(70)
            pdf.text(`${mm(pl.w)} × ${mm(pl.h)}${pl.rotated ? ' (g)' : ''}`, cx, cy + 3.2, { align: 'center' })
          }
        }
      }

      // ordem dos cortes da seccionadora e sobras aproveitáveis
      if (d.mode !== 'cnc') {
        const t = g.offcutId ? 0 : d.trim
        const a = analyzeSheet(sheet.placements, { x: t, y: t, w: g.sheetWidth - t * 2, h: g.sheetHeight - t * 2 }, d.kerf)
        if (a.guillotine) {
          for (const l of usableLeftovers(a.leftovers)) {
            setFill('#e6f2ea')
            pdf.setDrawColor(46, 125, 79)
            pdf.setLineWidth(0.25)
            pdf.setLineDashPattern([1.2, 0.9], 0)
            pdf.rect(X(l.x), Y(l.y), l.w * scale, l.h * scale, 'FD')
            pdf.setLineDashPattern([], 0)
            if (l.w * scale > 18 && l.h * scale > 6) {
              pdf.setFont('helvetica', 'bold')
              pdf.setFontSize(6)
              pdf.setTextColor(46, 125, 79)
              pdf.text(`SOBRA ${mm(l.w)} × ${mm(l.h)}`, X(l.x + l.w / 2), Y(l.y + l.h / 2) + 1, { align: 'center' })
              pdf.setFont('helvetica', 'normal')
            }
          }
          pdf.setLineWidth(0.25)
          pdf.setDrawColor(29, 78, 216)
          pdf.setLineDashPattern([1.6, 0.9], 0)
          for (const c of a.steps) {
            if (c.axis === 'vertical') pdf.line(X(c.at), Y(c.from), X(c.at), Y(c.to))
            else pdf.line(X(c.from), Y(c.at), X(c.to), Y(c.at))
          }
          pdf.setLineDashPattern([], 0)
          pdf.setFontSize(5.6)
          for (const c of a.steps) {
            const bx = c.axis === 'vertical' ? X(c.at) : X(c.from) + 2.2
            const by = c.axis === 'vertical' ? Y(c.from) + 2.2 : Y(c.at)
            setFill('#1d4ed8')
            pdf.circle(bx, by, 1.9, 'F')
            pdf.setFont('helvetica', 'bold')
            pdf.setTextColor(255)
            pdf.text(String(c.n), bx, by + 0.75, { align: 'center' })
          }
          pdf.setFont('helvetica', 'normal')
        }
      }

      // legenda dos cortes
      let ly = oy + mh + 9
      label('Legenda dos cortes', RX, ly)
      ly += 4
      pdf.setFontSize(6.2)
      let lx = RX
      for (const r of rows) {
        const text = `${r.sym} · ${r.name}`.slice(0, 30)
        const w = 5 + pdf.getTextWidth(text) + 3
        if (lx + w > PW - M - 4) {
          lx = RX
          ly += 4.4
        }
        setFill(r.fill)
        setDraw(r.stroke)
        pdf.setLineWidth(0.3)
        pdf.rect(lx, ly - 2.6, 3, 3, 'FD')
        pdf.setTextColor(50)
        pdf.text(text, lx + 4, ly)
        lx += w + 1
      }
      ly += 6
      // símbolos de fita e usinagem
      pdf.setFontSize(6.2)
      pdf.setTextColor(50)
      pdf.setLineWidth(0.9)
      pdf.setDrawColor(...brand)
      pdf.line(RX, ly - 1, RX + 6, ly - 1)
      pdf.text('Fita de borda', RX + 8, ly)
      pdf.setLineWidth(0.18)
      pdf.setDrawColor(30)
      pdf.circle(RX + 28, ly - 1, 0.9, 'S')
      pdf.text('Furo (topo)', RX + 31, ly)
      pdf.setLineDashPattern([0.4, 0.4], 0)
      pdf.circle(RX + 52, ly - 1, 0.9, 'S')
      pdf.setLineDashPattern([], 0)
      pdf.text('Face inferior', RX + 55, ly)
      pdf.setLineWidth(1)
      pdf.setDrawColor(30, 41, 59)
      pdf.line(RX + 76, ly - 1, RX + 81, ly - 1)
      pdf.text('Rasgo', RX + 83, ly)
      setDraw('#d97706')
      pdf.setLineWidth(0.5)
      pdf.circle(RX + 97, ly - 1, 0.7, 'S')
      pdf.text('Furo de borda', RX + 99, ly)
      ly += 7

      // informações da chapa
      const sheetArea = (g.sheetWidth * g.sheetHeight) / 1e6
      const used = sheet.usedArea > 1000 ? sheet.usedArea / 1e6 : sheet.usedArea
      label('Informações da chapa', RX, ly)
      pdf.setFontSize(7)
      pdf.setTextColor(60)
      pdf.text(
        [
          `Área da chapa ${sheetArea.toFixed(2).replace('.', ',')} m²  ·  área de peças ${used.toFixed(2).replace('.', ',')} m²  ·  sobra ${Math.max(sheetArea - used, 0).toFixed(2).replace('.', ',')} m²`,
          `Método: ${methodText}  ·  refilo ${d.trim} mm  ·  (g) = peça girada 90°`,
        ],
        RX,
        ly + 4.2,
      )

      // resumo de usinagens e fita desta chapa
      let holes = 0
      let slots = 0
      let tape = 0
      for (const pl of sheet.placements) {
        const piece = byId.get(pl.pieceId)
        if (!piece) continue
        holes += (piece.machining ?? []).filter((m) => m.kind === 'furo').length
        slots += (piece.machining ?? []).filter((m) => m.kind !== 'furo').length
        tape += edgeMetersOf(piece)
      }
      ly += 12.5
      label('Usinagem e fita desta chapa', RX, ly)
      pdf.setFontSize(7)
      pdf.setTextColor(60)
      pdf.text(`${holes} furos  ·  ${slots} rasgos/recortes  ·  ${tape.toFixed(2).replace('.', ',')} m de fita de borda`, RX, ly + 4.2)
      ly += 11
      if (distribution === 1 && d.hardware.length) {
        label('Ferragens do plano', RX, ly)
        ly += 4.2
        pdf.setFontSize(6.6)
        pdf.setTextColor(60)
        for (const h of d.hardware.slice(0, 12)) {
          pdf.text(h.description.slice(0, 62), RX, ly)
          pdf.text(`${h.quantity} un`, PW - M - 4, ly, { align: 'right' })
          pdf.setDrawColor(228)
          pdf.setLineWidth(0.1)
          pdf.line(RX, ly + 1.3, PW - M - 4, ly + 1.3)
          ly += 4.3
        }
      }

      // continuação da lista de cortes (muitas peças na mesma chapa)
      for (let from = rowsPerPage; from < rows.length; from += rowsPerPage) {
        pdf.addPage()
        frame()
        leftList(rows.slice(from, from + rowsPerPage), g.thickness, g.materialName, g.sheetWidth, g.sheetHeight)
        pdf.setFontSize(9)
        pdf.setTextColor(90)
        pdf.text(`Continuação da lista de cortes · chapa ${sheet.index} (${distribution} de ${totalSheets})`, RX, M + 20)
      }
    }
  }

  // --------------------------------------------------- 3) usinagens
  interface OpRow {
    piece: string
    type: string
    pos: string
    dia: string
    depth: string
    face: string
  }
  const ops: OpRow[] = []
  const seen = new Set<string>()
  for (const g of d.groups)
    for (const sh of g.sheets)
      for (const pl of sh.placements) {
        const piece = byId.get(pl.pieceId)
        if (!piece || seen.has(piece.id) || !piece.machining?.length) continue
        seen.add(piece.id)
        const sym = symbols.get(piece.id)?.sym ?? ''
        for (const m of piece.machining) {
          ops.push({
            piece: `${sym} · ${piece.label}`,
            type: m.kind === 'furo' ? 'Furo' : m.kind === 'rasgo' ? 'Rasgo' : 'Recorte',
            pos:
              m.kind === 'furo'
                ? `X ${mm(m.x)} · Y ${mm(m.y)}`
                : m.kind === 'rasgo'
                  ? `${m.axis === 'y' ? 'X' : 'Y'} ${mm(m.axis === 'y' ? m.x : m.y)} · ${mm(m.length ?? 0)} × ${mm(m.width ?? 0)}`
                  : `X ${mm(m.x)} · Y ${mm(m.y)} · ${mm(m.length ?? 0)} × ${mm(m.width ?? 0)}`,
            dia: m.kind === 'furo' ? `Ø ${mm(m.diameter ?? 0)}` : '—',
            depth: mm(m.depth),
            face: FACE_LABEL[m.face] ?? m.face,
          })
        }
      }
  if (ops.length) {
    const LIMIT = 700
    let i = 0
    while (i < ops.length && i < LIMIT) {
      pdf.addPage()
      frame()
      drawLogo(M + 5, M + 5, 7)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(13)
      pdf.setTextColor(30, 41, 59)
      pdf.text('Usinagens', M + 5, M + 24)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7)
      pdf.setTextColor(110)
      pdf.text('Coordenadas a partir do canto inferior esquerdo da peça (X no comprimento, Y na largura). Medidas em mm.', M + 5, M + 29)
      let ty = M + 38
      setFill('#f1f5f9')
      pdf.rect(M + 5, ty - 4, PW - 2 * M - 10, 6, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(6.5)
      pdf.setTextColor(60)
      pdf.text('PEÇA', M + 7, ty)
      pdf.text('TIPO', M + 70, ty)
      pdf.text('POSIÇÃO', M + 88, ty)
      pdf.text('DIÂMETRO', M + 138, ty)
      pdf.text('PROF.', M + 160, ty)
      pdf.text('FACE', M + 172, ty)
      pdf.setFont('helvetica', 'normal')
      ty += 5
      pdf.setFontSize(6.8)
      while (i < ops.length && i < LIMIT && ty < PH - M - 8) {
        const o = ops[i]
        pdf.setTextColor(30)
        pdf.text(o.piece.slice(0, 40), M + 7, ty)
        pdf.text(o.type, M + 70, ty)
        pdf.text(o.pos.slice(0, 40), M + 88, ty)
        pdf.text(o.dia, M + 138, ty)
        pdf.text(o.depth, M + 160, ty)
        pdf.text(o.face, M + 172, ty)
        pdf.setDrawColor(235)
        pdf.setLineWidth(0.1)
        pdf.line(M + 5, ty + 1.4, PW - M - 5, ty + 1.4)
        ty += 4.2
        i += 1
      }
      if (i >= LIMIT && ops.length > LIMIT) {
        pdf.setFontSize(7)
        pdf.setTextColor(120)
        pdf.text(`… e mais ${ops.length - LIMIT} usinagens (consulte o G-code ou o plano no sistema).`, M + 7, ty + 3)
      }
    }
  }

  // rodapé
  const pages = pdf.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p)
    pdf.setFontSize(6)
    pdf.setTextColor(130)
    pdf.text(`ERP Core Cut · ${d.code ?? ''} · emitido em ${today}`, M + 2, PH - M + 4)
    pdf.text(`Página ${p} de ${pages}`, PW - M - 2, PH - M + 4, { align: 'right' })
  }
  pdf.setTextColor(0)
  return pdf.output('blob')
}

export interface LabelsPdfData {
  code?: string
  projectName?: string
  clientName?: string
  responsibleName?: string
  groups: CutPlanGroup[]
  pieces: CutPiece[]
  defaultMaterialName?: string
  materialNames: Map<string, string>
  logo?: PlanPdfLogo
  /** endereço do sistema; o QR Code abre o plano na peça (ex.: https://erp.arcoplan.com.br) */
  baseUrl?: string
  planId?: string
  /** completa = 2 × 4 por A4, com desenho da peça e da chapa · compacta = 3 × 8 */
  layout?: 'completa' | 'compacta'
  /** chamado durante a geração (etiquetas feitas, total) para mostrar progresso sem travar a tela */
  onProgress?: (done: number, total: number) => void
  /** permite cancelar uma geração longa */
  signal?: AbortSignal
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Desenha o QR Code como retângulos vetoriais (agrupa módulos escuros consecutivos da mesma linha). */
function drawQr(pdf: jsPDF, text: string, x: number, y: number, size: number) {
  const qr = qrcode(0, 'M')
  qr.addData(text, 'Byte')
  qr.make()
  const n = qr.getModuleCount()
  const cell = size / n
  pdf.setFillColor(255, 255, 255)
  pdf.rect(x - 0.8, y - 0.8, size + 1.6, size + 1.6, 'F')
  pdf.setFillColor(20, 20, 20)
  for (let r = 0; r < n; r++) {
    let c = 0
    while (c < n) {
      if (!qr.isDark(r, c)) {
        c += 1
        continue
      }
      let run = 1
      while (c + run < n && qr.isDark(r, c + run)) run += 1
      pdf.rect(x + c * cell, y + r * cell, run * cell + 0.02, cell + 0.02, 'F')
      c += run
    }
  }
}

/** Desenho da peça (vista de topo, origem embaixo à esquerda) com fitas, furos, rasgos e cotas. */
function drawPieceDrawing(pdf: jsPDF, piece: CutPiece, x: number, y: number, w: number, h: number, brand: [number, number, number]) {
  const padL = 5
  const padT = 3.5
  const aw = w - padL
  const ah = h - padT
  const s = Math.min(aw / Math.max(piece.length, 1), ah / Math.max(piece.width, 1))
  const pw = piece.length * s
  const ph = piece.width * s
  const ox = x + padL + (aw - pw) / 2
  const oy = y + padT + (ah - ph) / 2
  const X = (v: number) => ox + v * s
  const Y = (v: number) => oy + (piece.width - v) * s
  pdf.setFillColor(246, 243, 238)
  pdf.setDrawColor(110, 100, 92)
  pdf.setLineWidth(0.25)
  if (piece.contour && piece.contour.length >= 3) {
    const rel: number[][] = []
    for (let i = 1; i < piece.contour.length; i++) rel.push([(piece.contour[i].x - piece.contour[i - 1].x) * s, -(piece.contour[i].y - piece.contour[i - 1].y) * s])
    pdf.lines(rel, X(piece.contour[0].x), Y(piece.contour[0].y), [1, 1], 'FD', true)
  } else pdf.rect(ox, oy, pw, ph, 'FD')
  pdf.setLineWidth(0.7)
  pdf.setDrawColor(...brand)
  for (const [x1, y1, x2, y2] of edgeSegments(piece)) pdf.line(X(x1), Y(y1), X(x2), Y(y2))
  for (const m of piece.machining ?? []) {
    if (m.kind === 'furo') {
      if (m.face === 'borda') {
        pdf.setDrawColor(217, 119, 6)
        pdf.setLineWidth(0.4)
        pdf.circle(X(m.x), Y(m.y), 0.6, 'S')
        continue
      }
      pdf.setDrawColor(30)
      pdf.setLineWidth(0.15)
      pdf.setFillColor(255, 255, 255)
      if (m.face === 'fundo') pdf.setLineDashPattern([0.35, 0.35], 0)
      pdf.circle(X(m.x), Y(m.y), Math.max(((m.diameter ?? 5) / 2) * s, 0.45), 'FD')
      pdf.setLineDashPattern([], 0)
    } else if (m.kind === 'rasgo') {
      const along = m.axis === 'y'
      pdf.setDrawColor(30, 41, 59)
      pdf.setLineWidth(Math.max((m.width ?? 6) * s, 0.3))
      if (m.face === 'fundo') pdf.setLineDashPattern([0.9, 0.7], 0)
      if (along) pdf.line(X(m.x), Y(m.y), X(m.x), Y(m.y + (m.length ?? 0)))
      else pdf.line(X(m.x), Y(m.y), X(m.x + (m.length ?? 0)), Y(m.y))
      pdf.setLineDashPattern([], 0)
    } else {
      pdf.setDrawColor(30, 41, 59)
      pdf.setLineWidth(0.2)
      pdf.setLineDashPattern([0.8, 0.6], 0)
      pdf.rect(X(m.x), Y(m.y + (m.width ?? 0)), (m.length ?? 0) * s, (m.width ?? 0) * s)
      pdf.setLineDashPattern([], 0)
    }
  }
  // cotas
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(5.5)
  pdf.setTextColor(60)
  pdf.text(`${mm(piece.length)}`, ox + pw / 2, oy - 0.9, { align: 'center' })
  pdf.text(`${mm(piece.width)}`, ox - 1, oy + ph / 2, { align: 'center', angle: 90 })
}

/** Miniatura da chapa otimizada com a posição da peça em destaque. */
function drawSheetMini(
  pdf: jsPDF,
  group: CutPlanGroup,
  sheet: CutPlanGroup['sheets'][number],
  highlight: { x: number; y: number; w: number; h: number } | undefined,
  x: number,
  y: number,
  w: number,
  h: number,
  brand: [number, number, number],
) {
  const s = Math.min(w / group.sheetWidth, h / group.sheetHeight)
  const mw = group.sheetWidth * s
  const mh = group.sheetHeight * s
  const ox = x + (w - mw) / 2
  const oy = y + (h - mh) / 2
  pdf.setFillColor(255, 255, 255)
  pdf.setDrawColor(40, 52, 70)
  pdf.setLineWidth(0.3)
  pdf.rect(ox, oy, mw, mh, 'FD')
  pdf.setLineWidth(0.12)
  pdf.setDrawColor(150)
  pdf.setFillColor(235, 238, 243)
  for (const pl of sheet.placements) pdf.rect(ox + pl.x * s, oy + pl.y * s, pl.w * s, pl.h * s, 'FD')
  if (highlight) {
    pdf.setFillColor(...brand)
    pdf.setDrawColor(...brand)
    pdf.setLineWidth(0.3)
    pdf.rect(ox + highlight.x * s, oy + highlight.y * s, highlight.w * s, highlight.h * s, 'FD')
  }
}

/**
 * Etiquetas adesivas — uma por unidade de peça, com logo, QR Code e (no layout completo) o desenho
 * da peça com fitas/usinagens e a miniatura da chapa otimizada em que ela será cortada.
 */
export async function buildLabelsPdf(d: LabelsPdfData): Promise<Blob> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const brand = rgb(BRAND_COLOR)
  const full = (d.layout ?? 'completa') === 'completa'
  const cols = full ? 2 : 3
  const rows = full ? 4 : 8
  const lw = 210 / cols
  const lh = full ? 74.25 : 37
  const per = cols * rows

  // posição de cada unidade: a n-ésima unidade da peça ocupa o n-ésimo encaixe nas chapas
  interface Slot {
    group: CutPlanGroup
    sheet: CutPlanGroup['sheets'][number]
    pl: CutPlanGroup['sheets'][number]['placements'][number]
    sheets: number
  }
  const slots = new Map<string, Slot[]>()
  for (const g of d.groups)
    for (const s of g.sheets)
      for (const pl of s.placements) {
        const list = slots.get(pl.pieceId) ?? []
        list.push({ group: g, sheet: s, pl, sheets: g.sheets.length })
        slots.set(pl.pieceId, list)
      }

  const units: { piece: CutPiece; n: number; index: number }[] = []
  d.pieces.forEach((p, index) => {
    for (let i = 1; i <= p.quantity; i++) units.push({ piece: p, n: i, index })
  })

  for (let idx = 0; idx < units.length; idx++) {
    const u = units[idx]
    // a cada página devolve o controle ao navegador: planos com milhares de etiquetas não congelam a tela
    if (idx % per === 0) {
      d.onProgress?.(idx, units.length)
      await yieldToUi()
      if (d.signal?.aborted) throw new DOMException('Geração das etiquetas cancelada.', 'AbortError')
    }
    if (idx > 0 && idx % per === 0) pdf.addPage()
    const slot = idx % per
    const x = (slot % cols) * lw
    const y = Math.floor(slot / cols) * lh + (full ? 0 : 0.5)
    const at = slots.get(u.piece.id)?.[u.n - 1] ?? slots.get(u.piece.id)?.[0]
    const mat = (u.piece.materialId && d.materialNames.get(u.piece.materialId)) || at?.group.materialName || d.defaultMaterialName || ''
    const edges = [u.piece.edgeTop ? 'C1' : '', u.piece.edgeBottom ? 'C2' : '', u.piece.edgeLeft ? 'L1' : '', u.piece.edgeRight ? 'L2' : ''].filter(Boolean).join(' ')
    const ops = (u.piece.machining ?? []).length
    const qrText = d.baseUrl && d.planId
      ? `${d.baseUrl.replace(/\/$/, '')}/plano-de-corte?plano=${d.planId}&peca=${u.piece.id}&un=${u.n}`
      : `CORE CUT|${d.code ?? ''}|${u.piece.label}|${u.piece.length}x${u.piece.width}|${u.n}/${u.piece.quantity}`

    pdf.setDrawColor(190)
    pdf.setLineWidth(0.15)
    pdf.rect(x + 1, y + 1, lw - 2, lh - 2)
    pdf.setFillColor(...brand)
    pdf.rect(x + 1, y + 1, 2.2, lh - 2, 'F')

    if (!full) {
      // ---------- compacta (3 × 8)
      drawQr(pdf, qrText, x + lw - 17, y + 3.5, 14)
      if (d.logo) pdf.addImage(d.logo.data, 'PNG', x + lw - 26, y + 21.5, 3.4 * d.logo.ratio, 3.4)
      pdf.setFontSize(6.5)
      pdf.setTextColor(110)
      pdf.text(`${d.code ?? ''} · ${(d.projectName ?? '').slice(0, 24)}`, x + 6, y + 5.5)
      pdf.setFontSize(11)
      pdf.setTextColor(...brand)
      pdf.text(u.piece.label.slice(0, 20), x + 6, y + 12)
      pdf.setFontSize(13)
      pdf.setTextColor(20)
      pdf.text(`${u.piece.length} × ${u.piece.width}`, x + 6, y + 20)
      pdf.setFontSize(6.5)
      pdf.setTextColor(90)
      pdf.text(mat.slice(0, 40), x + 6, y + 25)
      const opsText = (u.piece.machining ?? []).map((m) => methodLabel(m.method)).slice(0, 2).join(', ')
      pdf.text(`Fita: ${edges || '—'}${opsText ? ` · ${opsText}`.slice(0, 30) : ''}`, x + 6, y + 29.5)
      pdf.text(at ? `${at.group.materialName.slice(0, 18)} · ch. ${at.sheet.index}/${at.sheets}` : '', x + 6, y + 33.5)
      pdf.setFontSize(7.5)
      pdf.setTextColor(...brand)
      pdf.text(`${u.n}/${u.piece.quantity}`, x + lw - 4, y + 33.5, { align: 'right' })
      // código para digitar no chão de fábrica quando não há câmera
      if (d.code) {
        pdf.setFontSize(5.2)
        pdf.setTextColor(60)
        pdf.text(labelCode(d.code, u.index, u.n), x + lw - 10, y + 20, { align: 'center' })
      }
      continue
    }

    // ---------- completa (2 × 4)
    if (d.logo) pdf.addImage(d.logo.data, 'PNG', x + 6, y + 3.5, 5.5 * d.logo.ratio, 5.5)
    else {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(...brand)
      pdf.text('CORE CUT', x + 6, y + 8)
      pdf.setFont('helvetica', 'normal')
    }
    pdf.setFontSize(6.3)
    pdf.setTextColor(100)
    pdf.text(`${d.code ?? ''} · ${(d.projectName ?? '').slice(0, 44)}`, x + 6, y + 13)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11.5)
    pdf.setTextColor(...brand)
    pdf.text((pdf.splitTextToSize(u.piece.label || 'Peça', lw - 40) as string[])[0] ?? '', x + 6, y + 19)
    pdf.setFont('helvetica', 'normal')
    if (u.piece.module) {
      pdf.setFontSize(6.3)
      pdf.setTextColor(100)
      pdf.text((pdf.splitTextToSize(u.piece.module, lw - 40) as string[])[0] ?? '', x + 6, y + 23)
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(15)
    pdf.setTextColor(20)
    pdf.text(`${mm(u.piece.length)} × ${mm(u.piece.width)}`, x + 6, y + 31)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(80)
    pdf.text(at?.group.thickness ? `esp. ${at.group.thickness} mm` : '', x + 6 + 38, y + 31)

    drawQr(pdf, qrText, x + lw - 26.5, y + 3.5, 22)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(...brand)
    pdf.text(`${u.n}/${u.piece.quantity}`, x + lw - 15.5, y + 32, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
    if (d.code) {
      pdf.setFontSize(6)
      pdf.setTextColor(60)
      pdf.text(labelCode(d.code, u.index, u.n), x + lw - 15.5, y + 28.2, { align: 'center' })
    }

    // desenhos
    const dy = y + 35
    const dh = 26
    pdf.setDrawColor(225)
    pdf.setLineWidth(0.1)
    pdf.line(x + 5, dy - 1.2, x + lw - 4, dy - 1.2)
    drawPieceDrawing(pdf, u.piece, x + 5, dy, 48, dh, brand)
    pdf.setFontSize(5.5)
    pdf.setTextColor(120)
    pdf.text('Peça (vista superior)', x + 5, dy + dh + 2.6)
    if (at) {
      drawSheetMini(pdf, at.group, at.sheet, { x: at.pl.x, y: at.pl.y, w: at.pl.w, h: at.pl.h }, x + 58, dy, lw - 63, dh, brand)
      pdf.setFontSize(5.5)
      pdf.setTextColor(120)
      pdf.text(`Chapa ${at.sheet.index}/${at.sheets} · ${at.group.sheetWidth} × ${at.group.sheetHeight} mm · ${at.sheet.utilization}%`, x + 58, dy + dh + 2.6)
    } else {
      pdf.setFontSize(6.5)
      pdf.setTextColor(150)
      pdf.text('Peça fora do plano calculado', x + 58, dy + 12)
    }

    // rodapé da etiqueta
    pdf.setFontSize(6.4)
    pdf.setTextColor(60)
    pdf.text(mat.slice(0, 64), x + 6, y + lh - 6.4)
    const line = [
      `Fita: ${edges || '—'}${edgeMetersOf(u.piece) ? ` (${edgeMetersOf(u.piece).toFixed(2).replace('.', ',')} m)` : ''}`,
      ops ? `${ops} usinagem(ns)` : 'sem usinagem',
      at ? `posição X ${Math.round(at.pl.x)} · Y ${Math.round(at.pl.y)}${at.pl.rotated ? ' · girada' : ''}` : '',
    ]
      .filter(Boolean)
      .join('  ·  ')
    pdf.text(line.slice(0, 96), x + 6, y + lh - 3.2)
  }
  d.onProgress?.(units.length, units.length)
  return pdf.output('blob')
}
