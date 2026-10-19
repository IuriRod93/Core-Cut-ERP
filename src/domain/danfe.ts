import { jsPDF } from 'jspdf'
import type { CompanySettings, Invoice } from '../types'

/**
 * DANFE (Documento Auxiliar da Nota Fiscal Eletrônica) no formato retrato A4 clássico:
 * canhoto, identificação do emitente com a logo em preto e branco, código de barras da chave de acesso,
 * destinatário, faturas, cálculo do imposto, transportador, itens, ISSQN e dados adicionais.
 *
 * É a visualização gerada pelo sistema. O DANFE oficial (com o XML assinado) continua disponível no provedor.
 * Sem autorização, ou em homologação, o documento sai marcado como "SEM VALOR FISCAL".
 */

const PW = 210
const PH = 297
const M = 8
const W = PW - M * 2
const ROW_H = 4.4

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)
const qty = (n: number) => new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(n)
const digits = (v?: string | null) => String(v ?? '').replace(/\D/g, '')
const dateBr = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(String(iso).length === 10 ? `${iso}T12:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR')
}
const timeBr = (iso?: string | null) => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString('pt-BR') : ''
}

export function formatCnpjCpf(value?: string | null) {
  const d = digits(value)
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return String(value ?? '')
}
const formatCep = (v?: string) => digits(v).replace(/^(\d{5})(\d{3})$/, '$1-$2') || String(v ?? '')
const formatNumber = (n?: string) => (n ? digits(n).padStart(9, '0').replace(/^(\d{3})(\d{3})(\d{3})$/, '$1.$2.$3') : '000.000.000')
export const formatAccessKey = (key?: string) => digits(key).replace(/(\d{4})(?=\d)/g, '$1 ').trim()

// ------------------------------------------------------------------ código de barras (Code 128, conjunto C)
// Cada símbolo é uma sequência de larguras barra/espaço que soma 11 módulos (o de parada soma 13).
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

/** Larguras (em módulos) das barras e espaços do Code 128C para uma sequência numérica de tamanho par. */
export function code128C(data: string): number[] {
  const d = digits(data)
  if (d.length === 0 || d.length % 2 !== 0) throw new Error('Code 128C exige uma quantidade par de dígitos.')
  const symbols = [105]
  for (let i = 0; i < d.length; i += 2) symbols.push(Number(d.slice(i, i + 2)))
  const check = symbols.reduce((sum, value, index) => sum + value * (index === 0 ? 1 : index), 0) % 103
  symbols.push(check, 106)
  return symbols.flatMap((s) => CODE128_PATTERNS[s].split('').map(Number))
}

// ------------------------------------------------------------------ desenho
export interface DanfeInput {
  invoice: Invoice
  company: Partial<CompanySettings>
  /** logo já convertida para preto e branco */
  logo?: { data: string; ratio: number } | null
  now?: Date
}

export function buildDanfePdf({ invoice, company, logo, now = new Date() }: DanfeInput): Blob {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  const authorized = invoice.status === 'autorizada' && Boolean(invoice.accessKey)
  const warning = invoice.status === 'cancelada' ? 'NOTA FISCAL CANCELADA — SEM VALOR FISCAL' : invoice.environment !== 'producao' ? 'AMBIENTE DE HOMOLOGAÇÃO — DOCUMENTO SEM VALOR FISCAL' : !authorized ? 'NOTA NÃO AUTORIZADA — DOCUMENTO SEM VALOR FISCAL' : ''

  pdf.setLineWidth(0.2)
  pdf.setDrawColor(0)
  pdf.setTextColor(0)

  const fit = (text: string, width: number, size: number) => {
    pdf.setFontSize(size)
    let out = String(text ?? '')
    if (pdf.getTextWidth(out) <= width) return out
    while (out.length > 1 && pdf.getTextWidth(`${out}…`) > width) out = out.slice(0, -1)
    return `${out}…`
  }
  /** Caixa com o rótulo miúdo no topo e o valor embaixo. */
  const box = (x: number, y: number, w: number, h: number, label: string, value = '', opts: { bold?: boolean; align?: 'left' | 'right' | 'center'; size?: number } = {}) => {
    pdf.rect(x, y, w, h)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(5.2)
    pdf.text(label.toUpperCase(), x + 1, y + 2.2)
    if (value) {
      const size = opts.size ?? 8
      pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal')
      const shown = fit(value, w - 2, size)
      pdf.setFontSize(size)
      const align = opts.align ?? 'left'
      const tx = align === 'right' ? x + w - 1 : align === 'center' ? x + w / 2 : x + 1
      pdf.text(shown, tx, y + h - 1.3, { align })
    }
  }
  const title = (text: string, y: number) => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(6.5)
    pdf.text(text.toUpperCase(), M, y + 2.6)
    return y + 3.4
  }

  const total = invoice.total
  const products = invoice.items.reduce((s, i) => s + i.total, 0)
  const emitente = company.legalName || company.name || ''

  // ---- canhoto
  let y = M
  pdf.rect(M, y, W - 34, 8)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6)
  pdf.text(`RECEBEMOS DE ${emitente.toUpperCase()} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO`, M + 1, y + 3.4, { maxWidth: W - 36 })
  box(M, y + 8, 40, 8, 'Data de recebimento')
  box(M + 40, y + 8, W - 34 - 40, 8, 'Identificação e assinatura do recebedor')
  pdf.rect(M + W - 34, y, 34, 16)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text('NF-e', M + W - 17, y + 5, { align: 'center' })
  pdf.setFontSize(8)
  pdf.text(`Nº ${formatNumber(invoice.number)}`, M + W - 17, y + 9.5, { align: 'center' })
  pdf.setFontSize(7)
  pdf.text(`Série ${invoice.serie ?? company.fiscalSerie ?? '1'}`, M + W - 17, y + 13.5, { align: 'center' })
  y += 18
  pdf.setLineDashPattern([1.2, 1.2], 0)
  pdf.line(M, y, M + W, y)
  pdf.setLineDashPattern([], 0)
  y += 2.5

  // ---- identificação
  const headH = 36
  const leftW = 78
  const midW = 36
  const rightW = W - leftW - midW
  pdf.rect(M, y, leftW, headH)
  let textX = M + 2
  if (logo?.data) {
    const lh = 14
    const lw = Math.min(lh * logo.ratio, 30)
    pdf.addImage(logo.data, 'PNG', M + 2, y + 2, lw, lw / logo.ratio)
    textX = M + 2
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text(fit(emitente, leftW - 4, 9), textX, y + (logo?.data ? 21 : 7))
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  const addressLines = [
    [company.address, company.number].filter(Boolean).join(', ') + (company.district ? ` — ${company.district}` : ''),
    [formatCep(company.cep), [company.city, company.state].filter(Boolean).join(' - ')].filter(Boolean).join(' · '),
    [company.phone ? `Fone: ${company.phone}` : '', company.email].filter(Boolean).join(' · '),
  ].filter(Boolean)
  addressLines.forEach((line, i) => pdf.text(fit(line, leftW - 4, 7), textX, y + (logo?.data ? 25 : 11) + i * 3.4))

  // bloco DANFE
  const mx = M + leftW
  pdf.rect(mx, y, midW, headH)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.text('DANFE', mx + midW / 2, y + 6.5, { align: 'center' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6)
  pdf.text('Documento Auxiliar da', mx + midW / 2, y + 10, { align: 'center' })
  pdf.text('Nota Fiscal Eletrônica', mx + midW / 2, y + 12.6, { align: 'center' })
  pdf.setFontSize(6.5)
  pdf.text('0 - Entrada', mx + 3, y + 17)
  pdf.text('1 - Saída', mx + 3, y + 20)
  pdf.rect(mx + midW - 9, y + 15.5, 6, 6)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text('1', mx + midW - 6, y + 20)
  pdf.setFontSize(9)
  pdf.text(`Nº ${formatNumber(invoice.number)}`, mx + midW / 2, y + 27, { align: 'center' })
  pdf.setFontSize(7.5)
  pdf.text(`SÉRIE ${invoice.serie ?? company.fiscalSerie ?? '1'}`, mx + midW / 2, y + 31, { align: 'center' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(6)
  const pageLabelPos = { x: mx + midW / 2, y: y + 34.5 }

  // controle do fisco / código de barras / chave
  const rx = mx + midW
  pdf.rect(rx, y, rightW, 14)
  pdf.setFontSize(5.2)
  pdf.text('CONTROLE DO FISCO', rx + 1, y + 2.2)
  const key = digits(invoice.accessKey)
  if (key.length === 44) {
    const bars = code128C(key)
    const modules = bars.reduce((s, n) => s + n, 0)
    const bw = (rightW - 6) / modules
    let bx = rx + 3
    bars.forEach((n, i) => {
      if (i % 2 === 0) {
        pdf.setFillColor(0, 0, 0)
        pdf.rect(bx, y + 3.4, n * bw, 9.8, 'F')
      }
      bx += n * bw
    })
  } else {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.text('SEM CHAVE DE ACESSO', rx + rightW / 2, y + 8.5, { align: 'center' })
    pdf.setFont('helvetica', 'normal')
  }
  box(rx, y + 14, rightW, 8.5, 'Chave de acesso', formatAccessKey(key) || '—', { bold: true, size: 7.4 })
  pdf.rect(rx, y + 22.5, rightW, headH - 22.5)
  pdf.setFontSize(6.2)
  pdf.text('Consulta de autenticidade no portal nacional da NF-e', rx + rightW / 2, y + 27.5, { align: 'center' })
  pdf.text('www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora', rx + rightW / 2, y + 30.6, { align: 'center' })
  y += headH

  // natureza / protocolo
  box(M, y, 118, 8, 'Natureza da operação', invoice.natureOfOperation || 'Venda de mercadoria')
  const protocolW = W - 118
  const protocolText = authorized ? `${invoice.protocol ?? ''} ${dateBr(invoice.authorizedAt)} ${timeBr(invoice.authorizedAt)}`.trim() : ''
  pdf.rect(M + 118, y, protocolW, 8)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(5.2)
  pdf.text('PROTOCOLO DE AUTORIZAÇÃO DE USO', M + 119, y + 2.2)
  if (protocolText) {
    pdf.setFontSize(7)
    pdf.text(fit(protocolText, protocolW - 2, 7), M + 119, y + (warning ? 4.9 : 6.7))
  }
  if (warning) {
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(200, 0, 0)
    pdf.text(fit(warning, protocolW - 2, 5.4), M + 119, y + 7.4)
    pdf.setFontSize(5.4)
    pdf.setTextColor(0)
  }
  y += 8
  const third = W / 3
  box(M, y, third, 8, 'Inscrição estadual', company.ie ?? '')
  box(M + third, y, third, 8, 'Inscrição estadual do subst. trib.')
  box(M + third * 2, y, third, 8, 'CNPJ', formatCnpjCpf(company.cnpj))
  y += 9

  // ---- destinatário
  const r = invoice.recipient
  y = title('Destinatário / Remetente', y)
  const col = [88, 40, 36, W - 88 - 40 - 36]
  box(M, y, col[0], 8, 'Nome / Razão social', r.name, { bold: true })
  box(M + col[0], y, col[1], 8, 'CNPJ / CPF', formatCnpjCpf(r.document))
  box(M + col[0] + col[1], y, col[2], 8, 'Inscrição estadual', r.ie ?? '')
  box(M + col[0] + col[1] + col[2], y, col[3], 8, 'Data da emissão', dateBr(invoice.issuedAt ?? now.toISOString()))
  y += 8
  box(M, y, col[0], 8, 'Endereço', [r.address, r.number].filter(Boolean).join(', '))
  box(M + col[0], y, col[1], 8, 'Bairro / Distrito', r.district ?? '')
  box(M + col[0] + col[1], y, col[2], 8, 'CEP', formatCep(r.zip))
  box(M + col[0] + col[1] + col[2], y, col[3], 8, 'Data da saída', dateBr(invoice.issuedAt ?? now.toISOString()))
  y += 8
  box(M, y, col[0], 8, 'Município', r.city ?? '')
  box(M + col[0], y, col[1], 8, 'Fone / Fax', r.phone ?? '')
  box(M + col[0] + col[1], y, col[2], 8, 'UF', r.state ?? '')
  box(M + col[0] + col[1] + col[2], y, col[3], 8, 'Hora da saída', timeBr(invoice.issuedAt ?? now.toISOString()))
  y += 9

  // ---- faturas
  const installments = invoice.installments ?? []
  if (installments.length) {
    y = title('Faturas', y)
    const perRow = 4
    const cw = W / perRow
    const visible = installments.slice(0, 12)
    for (let i = 0; i < visible.length; i += perRow) {
      visible.slice(i, i + perRow).forEach((p, j) => {
        const x = M + j * cw
        box(x, y, cw * 0.28, 7, 'Número', p.number)
        box(x + cw * 0.28, y, cw * 0.36, 7, 'Vencimento', dateBr(p.dueDate))
        box(x + cw * 0.64, y, cw * 0.36, 7, 'Valor', brl(p.amount), { align: 'right' })
      })
      y += 7
    }
    y += 1.5
  }

  // ---- cálculo do imposto
  y = title('Cálculo do imposto', y)
  const c5 = W / 5
  box(M, y, c5, 8, 'Base de cálculo do ICMS', brl(0), { align: 'right' })
  box(M + c5, y, c5, 8, 'Valor do ICMS', brl(0), { align: 'right' })
  box(M + c5 * 2, y, c5, 8, 'Base de cálc. ICMS subst.', brl(0), { align: 'right' })
  box(M + c5 * 3, y, c5, 8, 'Valor do ICMS subst.', brl(0), { align: 'right' })
  box(M + c5 * 4, y, c5, 8, 'Valor total dos produtos', brl(products), { align: 'right' })
  y += 8
  const c6 = W / 6
  const labels: [string, number][] = [
    ['Valor do frete', invoice.freight],
    ['Valor do seguro', 0],
    ['Desconto', invoice.discount],
    ['Outras despesas acessórias', 0],
    ['Valor do IPI', 0],
    ['Valor total da nota', total],
  ]
  labels.forEach(([label, value], i) => box(M + c6 * i, y, c6, 8, label, brl(value), { align: 'right', bold: i === 5 }))
  y += 9

  // ---- transportador
  y = title('Transportador / Volumes transportados', y)
  const t = [70, 32, 22, 26, 12, W - 70 - 32 - 22 - 26 - 12]
  const freightMode = invoice.freight > 0 ? '0-Emitente' : '9-Sem frete'
  box(M, y, t[0], 8, 'Nome / Razão social')
  box(M + t[0], y, t[1], 8, 'Frete por conta', freightMode)
  box(M + t[0] + t[1], y, t[2], 8, 'Código ANTT')
  box(M + t[0] + t[1] + t[2], y, t[3], 8, 'Placa do veículo')
  box(M + t[0] + t[1] + t[2] + t[3], y, t[4], 8, 'UF')
  box(M + t[0] + t[1] + t[2] + t[3] + t[4], y, t[5], 8, 'CNPJ / CPF')
  y += 8
  const t2 = [70, 56, 12, W - 138]
  box(M, y, t2[0], 8, 'Endereço')
  box(M + t2[0], y, t2[1], 8, 'Município')
  box(M + t2[0] + t2[1], y, t2[2], 8, 'UF')
  box(M + t2[0] + t2[1] + t2[2], y, t2[3], 8, 'Inscrição estadual')
  y += 8
  const t3 = [24, 34, 34, 34, 34, W - 160]
  ;['Quantidade', 'Espécie', 'Marca', 'Numeração', 'Peso bruto', 'Peso líquido'].forEach((label, i) => box(M + t3.slice(0, i).reduce((a, b) => a + b, 0), y, t3[i], 8, label))
  y += 9

  // ---- itens (com paginação)
  const cols = [
    { h: 'Código', w: 16, a: 'left' as const },
    { h: 'Descrição do produto/serviço', w: 44, a: 'left' as const },
    { h: 'NCM/SH', w: 16, a: 'left' as const },
    { h: 'CST/CSOSN', w: 9, a: 'center' as const },
    { h: 'CFOP', w: 10, a: 'center' as const },
    { h: 'UN', w: 7, a: 'center' as const },
    { h: 'Qtde', w: 12, a: 'right' as const },
    { h: 'Preço un.', w: 15, a: 'right' as const },
    { h: 'Preço total', w: 16, a: 'right' as const },
    { h: 'BC ICMS', w: 13, a: 'right' as const },
    { h: 'Vlr ICMS', w: 12, a: 'right' as const },
    { h: 'Vlr IPI', w: 9, a: 'right' as const },
    { h: '% ICMS', w: 8, a: 'right' as const },
    { h: '% IPI', w: 7, a: 'right' as const },
  ]
  const tailH = 8 + 4 + 34 + 6 // ISSQN + título + adicionais + rodapé
  const bottom = PH - M - 4
  const headerH = 7
  const firstCap = Math.max(Math.floor((bottom - y - 3.4 - headerH) / ROW_H), 0)
  const fitsOne = Math.floor((bottom - tailH - y - 3.4 - headerH) / ROW_H)
  const contCap = Math.floor((bottom - M - 12 - headerH) / ROW_H)
  const contTailCap = Math.floor((bottom - tailH - M - 12 - headerH) / ROW_H)
  const itemsCount = invoice.items.length
  const chunks: number[] = []
  if (itemsCount <= fitsOne) chunks.push(itemsCount)
  else {
    let left = itemsCount
    chunks.push(Math.min(firstCap, left))
    left -= chunks[0]
    while (left > contTailCap) {
      const take = Math.min(contCap, left)
      chunks.push(take)
      left -= take
    }
    chunks.push(left)
  }

  const drawItemsHeader = (yy: number) => {
    let x = M
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(5.2)
    for (const c of cols) {
      pdf.rect(x, yy, c.w, headerH)
      const lines = pdf.splitTextToSize(c.h.toUpperCase(), c.w - 1) as string[]
      lines.slice(0, 2).forEach((line, i) => pdf.text(line, c.a === 'right' ? x + c.w - 0.8 : c.a === 'center' ? x + c.w / 2 : x + 0.8, yy + 2.6 + i * 2.3, { align: c.a }))
      x += c.w
    }
    return yy + headerH
  }
  const pageHeader = () => {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.text(`DANFE — NF-e Nº ${formatNumber(invoice.number)} · Série ${invoice.serie ?? company.fiscalSerie ?? '1'}`, M, M + 4)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6.5)
    pdf.text(fit(`${emitente} · CNPJ ${formatCnpjCpf(company.cnpj)}`, W - 30, 6.5), M, M + 8)
    if (warning) {
      pdf.setTextColor(200, 0, 0)
      pdf.setFont('helvetica', 'bold')
      pdf.text(warning, M + W, M + 4, { align: 'right' })
      pdf.setTextColor(0)
    }
  }

  y = title('Dados dos produtos / serviços', y)
  let cursor = 0
  chunks.forEach((count, page) => {
    if (page > 0) {
      pdf.addPage()
      pageHeader()
      y = M + 12
      y = title('Dados dos produtos / serviços (continuação)', y)
    }
    y = drawItemsHeader(y)
    for (let n = 0; n < count; n++) {
      const item = invoice.items[cursor + n]
      let x = M
      const cells = [
        item.code,
        item.description,
        digits(item.ncm),
        item.taxSituation,
        digits(item.cfop),
        item.unit,
        qty(item.quantity),
        brl(item.unitPrice),
        brl(item.total),
        brl(0),
        brl(0),
        brl(0),
        '0,00',
        '0,00',
      ]
      pdf.setFont('helvetica', 'normal')
      cols.forEach((c, i) => {
        pdf.rect(x, y, c.w, ROW_H)
        const text = fit(cells[i], c.w - 1.4, 6.2)
        pdf.setFontSize(6.2)
        pdf.text(text, c.a === 'right' ? x + c.w - 0.8 : c.a === 'center' ? x + c.w / 2 : x + 0.8, y + ROW_H - 1.2, { align: c.a })
        x += c.w
      })
      y += ROW_H
    }
    cursor += count
    if (page < chunks.length - 1) {
      pdf.setFont('helvetica', 'italic')
      pdf.setFontSize(6)
      pdf.text('Continua na próxima página…', M + W, y + 3.5, { align: 'right' })
    }
  })
  y += 3

  // ---- ISSQN e dados adicionais (última página)
  y = title('Cálculo do ISSQN', y)
  const q = W / 4
  box(M, y, q, 8, 'Inscrição municipal', company.im ?? '')
  box(M + q, y, q, 8, 'Valor total dos serviços', brl(0), { align: 'right' })
  box(M + q * 2, y, q, 8, 'Base de cálculo do ISSQN', brl(0), { align: 'right' })
  box(M + q * 3, y, q, 8, 'Valor do ISSQN', brl(0), { align: 'right' })
  y += 9
  y = title('Dados adicionais', y)
  const addH = Math.max(Math.min(bottom - y - 5, 34), 18)
  pdf.rect(M, y, 130, addH)
  pdf.rect(M + 130, y, W - 130, addH)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(5.2)
  pdf.text('INFORMAÇÕES COMPLEMENTARES', M + 1, y + 2.2)
  pdf.text('RESERVADO AO FISCO', M + 131, y + 2.2)
  pdf.setFontSize(6.4)
  const noteLines = (pdf.splitTextToSize(invoice.notes ?? '', 126) as string[]).slice(0, Math.floor((addH - 4) / 2.8))
  noteLines.forEach((line, i) => pdf.text(line, M + 1, y + 5.4 + i * 2.8))

  // ---- rodapé e numeração de páginas
  const total2 = pdf.getNumberOfPages()
  for (let p = 1; p <= total2; p++) {
    pdf.setPage(p)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6)
    pdf.setTextColor(60)
    pdf.text(`Impresso em ${dateBr(now.toISOString())} ${timeBr(now.toISOString())} pelo Core Cut ERP`, M, PH - M + 1)
    pdf.text(`Folha ${p}/${total2}`, M + W, PH - M + 1, { align: 'right' })
    pdf.setTextColor(0)
    if (p === 1) {
      pdf.setFontSize(6)
      pdf.text(`Folha ${p}/${total2}`, pageLabelPos.x, pageLabelPos.y, { align: 'center' })
    }
  }
  return pdf.output('blob')
}
