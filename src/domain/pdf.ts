import { jsPDF } from 'jspdf'
import { BRAND_COLOR } from '../brand/logoData'
import { brl, fmtDate } from '../lib/format'
import { fileUrl } from '../lib/api'
import { loadLogoDataUrl } from '../lib/image'
import { budgetTotals } from './budget'
import type { Budget, Client, CompanySettings, Contract, Project } from '../types'

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Logotipo para os PDFs: o da empresa (Configurações → Empresa) quando existe; senão a marca Core Cut.
 * `custom` indica que é a marca do cliente, que ganha um pouco mais de altura no cabeçalho.
 */
export async function logoPng(heightPx = 120, company?: Pick<CompanySettings, 'logoFileId'> | null): Promise<{ data: string; ratio: number; custom?: boolean }> {
  if (company?.logoFileId) {
    try {
      return { ...(await loadLogoDataUrl(fileUrl(company.logoFileId, { inline: true }), Math.max(heightPx, 120))), custom: true }
    } catch {
      /* arquivo removido ou sem rede: usa a marca padrão */
    }
  }
  return brandLogoPng(heightPx)
}

/** Renderiza a marca Core Cut em PNG para uso nos PDFs. */
async function brandLogoPng(heightPx = 120): Promise<{ data: string; ratio: number }> {
  const img = new Image()
  img.src = '/core-cut-logo.png'
  await new Promise((res, rej) => {
    img.onload = res
    img.onerror = rej
  })
  const ratio = 4
  const canvas = document.createElement('canvas')
  canvas.width = heightPx * ratio
  canvas.height = heightPx
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Não foi possível preparar a logo Core Cut para o PDF.')
  context.drawImage(img, 0, 0, heightPx, heightPx)
  context.fillStyle = '#142934'
  context.font = `700 ${heightPx * 0.3}px "Segoe UI", sans-serif`
  context.textBaseline = 'middle'
  context.fillText('CORE CUT', heightPx * 1.12, heightPx * 0.43)
  context.fillStyle = BRAND_COLOR
  context.font = `700 ${heightPx * 0.16}px "Segoe UI", sans-serif`
  context.fillText('ERP', heightPx * 1.14, heightPx * 0.72)
  return { data: canvas.toDataURL('image/png'), ratio }
}

// ============================================================== documentos comerciais
// Sistema de layout compartilhado por proposta e contrato: margens fixas, tipografia em poucos tamanhos,
// linhas finas, cabeçalho repetido nas páginas seguintes e rodapé com a numeração.

const PAGE_W = 210
const PAGE_H = 297
const M = 16 // margem lateral
const CW = PAGE_W - M * 2 // largura útil
const TOP = 22 // início do conteúdo nas páginas seguintes
const BOTTOM = PAGE_H - 22 // limite inferior do conteúdo

const INK: [number, number, number] = [31, 41, 51]
const MUTED: [number, number, number] = [107, 119, 128]
const LINE: [number, number, number] = [223, 228, 231]
const SOFT: [number, number, number] = [246, 248, 249]

type Logo = { data: string; ratio: number; custom?: boolean }

class Sheet {
  readonly pdf: jsPDF
  y = 0
  readonly brand = hexToRgb(BRAND_COLOR)
  constructor(
    private readonly company: CompanySettings,
    private readonly logo: Logo,
    private readonly shortTitle: string,
    private readonly code?: string,
  ) {
    this.pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  }

  text(value: string | string[], x: number, y: number, opts: { size?: number; bold?: boolean; color?: [number, number, number]; align?: 'left' | 'right' | 'center'; maxWidth?: number } = {}) {
    const { pdf } = this
    pdf.setFont('helvetica', opts.bold ? 'bold' : 'normal')
    pdf.setFontSize(opts.size ?? 9.5)
    pdf.setTextColor(...(opts.color ?? INK))
    pdf.text(value, x, y, { align: opts.align ?? 'left', maxWidth: opts.maxWidth })
  }

  wrap(value: string, width: number, size = 9.5, bold = false): string[] {
    this.pdf.setFont('helvetica', bold ? 'bold' : 'normal')
    this.pdf.setFontSize(size)
    return this.pdf.splitTextToSize(value, width) as string[]
  }

  rule(y: number, color = LINE, width = 0.2, x1 = M, x2 = PAGE_W - M) {
    this.pdf.setDrawColor(...color)
    this.pdf.setLineWidth(width)
    this.pdf.line(x1, y, x2, y)
  }

  /** Garante `h` mm livres; se não couber, abre outra página com o cabeçalho de continuação. */
  ensure(h: number) {
    if (this.y + h <= BOTTOM) return false
    this.pdf.addPage()
    this.text(this.company.name, M, 12, { size: 8, bold: true, color: MUTED })
    this.text([this.shortTitle, this.code].filter(Boolean).join(' · '), PAGE_W - M, 12, { size: 8, color: MUTED, align: 'right' })
    this.rule(14.5)
    this.y = TOP
    return true
  }

  /** Cabeçalho da primeira página: marca à esquerda, dados da empresa à direita. */
  masthead(kicker: string, title: string, meta: [string, string][]) {
    const { pdf, company, logo } = this
    const h = logo.custom ? Math.min(13, 56 / logo.ratio) : 8
    pdf.addImage(logo.data, 'PNG', M, 14 + (13 - h) / 2, h * logo.ratio, h)
    const info = [company.legalName || company.name, company.cnpj ? `CNPJ ${company.cnpj}` : '', [company.address, [company.city, company.state].filter(Boolean).join('/')].filter(Boolean).join(' · '), [company.phone, company.email].filter(Boolean).join(' · ')].filter(Boolean)
    info.forEach((line, i) => this.text(line, PAGE_W - M, 15.5 + i * 3.7, { size: 7.8, color: MUTED, align: 'right', bold: i === 0 }))
    this.rule(33, this.brand, 0.7)
    this.text(kicker.toUpperCase(), M, 43, { size: 8, bold: true, color: this.brand })
    const lines = this.wrap(title, CW - 52, 17, true)
    this.text(lines, M, 51, { size: 17, bold: true })
    // bloco de metadados à direita (número, emissão, validade…)
    meta.forEach(([k, v], i) => {
      this.text(k.toUpperCase(), PAGE_W - M, 42 + i * 9.2, { size: 6.8, color: MUTED, align: 'right', bold: true })
      this.text(v, PAGE_W - M, 46.4 + i * 9.2, { size: 10, align: 'right', bold: true })
    })
    this.y = Math.max(51 + lines.length * 7.2, 42 + meta.length * 9.2) + 7
  }

  /** Rótulo pequeno em caixa-alta seguido de linha fina (título de seção). */
  section(title: string, keepWith = 0) {
    // respiro antes do título (menos no topo da página) e o bloco inteiro fica junto quando `keepWith` é informado
    this.y += 5
    if (this.ensure(14 + keepWith)) this.y -= 0
    this.text(title.toUpperCase(), M, this.y + 4, { size: 8, bold: true, color: this.brand })
    this.rule(this.y + 6.2)
    this.y += 10.5
  }

  /** Pares rótulo/valor em colunas. */
  facts(items: [string, string | undefined][], cols = 2, x = M, width = CW) {
    const colW = width / cols
    const rows: number[] = []
    const used = items.filter(([, v]) => v !== undefined && v !== '')
    let height = 0
    used.forEach(([, v], i) => {
      const lines = this.wrap(String(v), colW - 4, 9.5)
      const r = Math.floor(i / cols)
      rows[r] = Math.max(rows[r] ?? 0, 4 + lines.length * 4.3 + 2)
    })
    height = rows.reduce((s, r) => s + r, 0)
    this.ensure(height)
    let rowY = this.y
    used.forEach(([k, v], i) => {
      const c = i % cols
      const r = Math.floor(i / cols)
      if (c === 0 && r > 0) rowY += rows[r - 1]
      const cx = x + c * colW
      this.text(k.toUpperCase(), cx, rowY + 3, { size: 6.8, bold: true, color: MUTED })
      this.text(this.wrap(String(v), colW - 4, 9.5), cx, rowY + 7.4, { size: 9.5 })
    })
    this.y += height + 2
  }

  /** Parágrafo corrido que quebra página quando precisa. */
  paragraph(value: string, opts: { size?: number; color?: [number, number, number]; gap?: number; indent?: number } = {}) {
    const size = opts.size ?? 9.5
    const width = CW - (opts.indent ?? 0)
    for (const part of value.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
      const lines = this.wrap(part, width, size)
      const step = size * 0.47
      for (let i = 0; i < lines.length; ) {
        const room = Math.floor((BOTTOM - this.y) / step)
        // sem espaço para ao menos 2 linhas (ou a última): segue na página seguinte
        if (room < 1 || room < Math.min(lines.length - i, 2)) {
          this.ensure(BOTTOM + 1)
          continue
        }
        const chunk = lines.slice(i, i + room)
        this.text(chunk, M + (opts.indent ?? 0), this.y + step * 0.85, { size, color: opts.color })
        this.y += chunk.length * step
        i += chunk.length
      }
      this.y += opts.gap ?? 2.2
    }
  }

  footers() {
    const { pdf, company } = this
    const pages = pdf.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      pdf.setPage(i)
      this.rule(PAGE_H - 14, LINE, 0.2)
      this.text([company.name, company.website].filter(Boolean).join(' · '), M, PAGE_H - 9.5, { size: 7.5, color: MUTED })
      this.text(`Página ${i} de ${pages}`, PAGE_W - M, PAGE_H - 9.5, { size: 7.5, color: MUTED, align: 'right' })
    }
  }

  blob() {
    this.footers()
    return this.pdf.output('blob')
  }
}

const num = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',')
const today = () => fmtDate(new Date().toISOString())

/** Linhas de assinatura: [rótulo, nome]. */
function signatures(sheet: Sheet, left: [string, string], right: [string, string], dateLine = true) {
  sheet.ensure(40)
  if (dateLine) sheet.text('Local e data: ______________________________, ____ / ____ / ________', M, sheet.y + 4, { size: 9, color: MUTED })
  const base = sheet.y + (dateLine ? 24 : 16)
  const half = CW / 2 - 8
  for (const [i, [role, name]] of [left, right].entries()) {
    const x = M + i * (half + 16)
    sheet.rule(base, INK, 0.25, x, x + half)
    sheet.text(role.toUpperCase(), x, base + 4.4, { size: 7.2, bold: true, color: MUTED })
    sheet.text(sheet.wrap(name, half, 9.5)[0] ?? '', x, base + 9, { size: 9.5 })
  }
  sheet.y = base + 16
}

// -------------------------------------------------------------------------- proposta
export async function buildBudgetPdf(budget: Budget, client: Client | undefined, company: CompanySettings): Promise<Blob> {
  const logo = await logoPng(140, company)
  const sheet = new Sheet(company, logo, 'Proposta comercial', budget.code)
  const totals = budgetTotals(budget)
  const margin = (budget.marginPercent ?? 0) / 100
  const priceOf = (i: Budget['items'][number]) => (i.unitPrice > 0 ? i.unitPrice : i.unitCost * (1 + margin))

  sheet.masthead('Proposta comercial', budget.title || 'Proposta', [
    ['Número', budget.code ?? '—'],
    ['Emitida em', today()],
    ['Válida até', fmtDate(budget.validUntil)],
  ])

  sheet.section('Cliente')
  sheet.facts(
    [
      ['Nome / razão social', client?.name ?? '—'],
      ['CPF / CNPJ', client?.document],
      ['Contato', client?.contactName],
      ['Telefone / e-mail', [client?.phone, client?.email].filter(Boolean).join(' · ') || undefined],
      ['Endereço', [client?.address, [client?.city, client?.state].filter(Boolean).join('/')].filter(Boolean).join(' — ') || undefined],
    ],
    2,
  )

  sheet.section('Condições')
  sheet.facts(
    [
      ['Prazo de entrega', budget.deliveryDays ? `${budget.deliveryDays} dias úteis após a aprovação` : 'A combinar'],
      ['Forma de pagamento', budget.paymentTerms || company.paymentTerms || 'A combinar'],
    ],
    2,
  )

  // ------------------------------------------------ itens, agrupados por ambiente
  sheet.section('Itens da proposta')
  const COL = { n: M + 1, desc: M + 10, qtyR: 130, unitR: 160, totalR: PAGE_W - M - 1 }
  const tableHeader = () => {
    sheet.ensure(14)
    sheet.pdf.setFillColor(...SOFT)
    sheet.pdf.rect(M, sheet.y, CW, 7, 'F')
    const t = (value: string, x: number, align: 'left' | 'right' = 'left') => sheet.text(value, x, sheet.y + 4.7, { size: 7.2, bold: true, color: MUTED, align })
    t('Nº', COL.n)
    t('DESCRIÇÃO', COL.desc)
    t('QTD.', COL.qtyR, 'right')
    t('VALOR UNIT.', COL.unitR, 'right')
    t('TOTAL', COL.totalR, 'right')
    sheet.y += 7
  }
  tableHeader()

  const groups = [...new Set(budget.items.map((i) => i.group || 'Itens'))]
  let seq = 0
  for (const g of groups) {
    const items = budget.items.filter((i) => (i.group || 'Itens') === g)
    const subtotal = items.reduce((s, i) => s + priceOf(i) * i.quantity, 0)
    if (sheet.ensure(22)) tableHeader()
    sheet.y += 2
    sheet.text(g, M + 1, sheet.y + 4.2, { size: 9.5, bold: true, color: sheet.brand })
    sheet.text(brl(subtotal), COL.totalR, sheet.y + 4.2, { size: 9.5, bold: true, color: sheet.brand, align: 'right' })
    sheet.y += 7
    for (const it of items) {
      seq += 1
      const lines = sheet.wrap(it.description || '—', COL.qtyR - 24 - COL.desc, 9)
      const rowH = Math.max(lines.length * 4 + 3.6, 8)
      if (sheet.ensure(rowH + 2)) tableHeader()
      const top = sheet.y
      sheet.text(String(seq).padStart(2, '0'), COL.n, top + 5, { size: 8, color: MUTED })
      sheet.text(lines, COL.desc, top + 5, { size: 9 })
      sheet.text(`${num(it.quantity)} ${it.unit ?? ''}`.trim(), COL.qtyR, top + 5, { size: 9, align: 'right' })
      sheet.text(brl(priceOf(it)), COL.unitR, top + 5, { size: 9, align: 'right', color: MUTED })
      sheet.text(brl(priceOf(it) * it.quantity), COL.totalR, top + 5, { size: 9, align: 'right', bold: true })
      sheet.rule(top + rowH, LINE, 0.15)
      sheet.y += rowH
    }
  }

  // ------------------------------------------------ totais
  sheet.y += 6
  sheet.ensure(46)
  const boxX = PAGE_W - M - 86
  const row = (label: string, value: string) => {
    sheet.text(label, boxX, sheet.y + 4, { size: 9, color: MUTED })
    sheet.text(value, PAGE_W - M, sheet.y + 4, { size: 9, align: 'right' })
    sheet.y += 6
  }
  row('Itens e serviços', brl(totals.price))
  if (totals.extras) row('Frete e instalação', brl(totals.extras))
  if (totals.discount) row('Desconto', `- ${brl(totals.discount)}`)
  if (totals.taxes) row('Impostos', brl(totals.taxes))
  sheet.y += 2
  sheet.pdf.setFillColor(...sheet.brand)
  sheet.pdf.roundedRect(boxX - 4, sheet.y, 90, 13, 1.5, 1.5, 'F')
  sheet.text('VALOR TOTAL', boxX, sheet.y + 8.2, { size: 8.5, bold: true, color: [255, 255, 255] })
  sheet.text(brl(totals.total), PAGE_W - M - 3, sheet.y + 8.6, { size: 13, bold: true, color: [255, 255, 255], align: 'right' })
  sheet.y += 20

  if (budget.notes?.trim()) {
    sheet.section('Observações')
    sheet.paragraph(budget.notes, { color: INK })
  }

  sheet.section('Aceite', 60)
  sheet.paragraph(`Esta proposta é válida até ${fmtDate(budget.validUntil)}. Ao assinar abaixo, o cliente aprova os itens, valores e condições descritos.`, { color: MUTED })
  signatures(sheet, ['Cliente', client?.name ?? ''], ['Empresa', company.legalName || company.name])
  return sheet.blob()
}

// -------------------------------------------------------------------------- contrato
export async function buildContractPdf(contract: Contract, client: Client | undefined, company: CompanySettings, extra: { project?: Project; budget?: Budget } = {}): Promise<Blob> {
  const logo = await logoPng(140, company)
  const sheet = new Sheet(company, logo, 'Contrato', contract.code)
  const parcels = contract.installments ?? []
  const parcelsTotal = parcels.reduce((s, p) => s + p.amount, 0)

  sheet.masthead('Contrato', 'Fornecimento e instalação de mobiliário planejado', [
    ['Número', contract.code ?? '—'],
    ['Emitido em', today()],
    ['Valor', brl(contract.value)],
  ])

  sheet.section('Das partes')
  sheet.facts(
    [
      ['Contratante', client?.name ?? '—'],
      ['CPF / CNPJ', client?.document],
      ['Endereço', [client?.address, [client?.city, client?.state].filter(Boolean).join('/')].filter(Boolean).join(' — ') || undefined],
      ['Contato', [client?.phone, client?.email].filter(Boolean).join(' · ') || undefined],
    ],
    2,
  )
  sheet.facts(
    [
      ['Contratada', company.legalName || company.name],
      ['CNPJ', company.cnpj],
      ['Endereço', [company.address, [company.city, company.state].filter(Boolean).join('/')].filter(Boolean).join(' — ') || undefined],
      ['Contato', [company.phone, company.email].filter(Boolean).join(' · ') || undefined],
    ],
    2,
  )

  let clause = 0
  const heading = (title: string, keepWith = 0) => {
    clause += 1
    sheet.section(`Cláusula ${clause}ª — ${title}`, keepWith)
  }

  heading('Do objeto')
  sheet.paragraph(`O presente contrato tem por objeto o fornecimento e a instalação de mobiliário planejado conforme o projeto aprovado: ${contract.title}.`)
  const { project, budget } = extra
  if (project || budget) {
    sheet.facts(
      [
        ['Projeto', project ? [project.code, project.name].filter(Boolean).join(' · ') : undefined],
        ['Ambiente', project?.environment],
        ['Local de execução', project?.address],
        ['Orçamento de origem', budget ? [budget.code, budget.title].filter(Boolean).join(' · ') : undefined],
        ['Prazo de entrega', budget?.deliveryDays ? `${budget.deliveryDays} dias úteis` : undefined],
      ],
      2,
    )
  }
  // escopo contratado: ambientes e valores do orçamento
  if (budget?.items?.length) {
    const margin = (budget.marginPercent ?? 0) / 100
    const price = (i: Budget['items'][number]) => (i.unitPrice > 0 ? i.unitPrice : i.unitCost * (1 + margin)) * i.quantity
    const groups = [...new Set(budget.items.map((i) => i.group || 'Itens'))]
    sheet.text('ESCOPO CONTRATADO', M, sheet.y + 3, { size: 7.2, bold: true, color: MUTED })
    sheet.y += 6
    for (const group of groups) {
      const items = budget.items.filter((i) => (i.group || 'Itens') === group)
      sheet.ensure(8)
      sheet.text(group, M + 1, sheet.y + 5, { size: 9.5 })
      sheet.text(`${items.length} ${items.length === 1 ? 'item' : 'itens'}`, PAGE_W - M - 36, sheet.y + 5, { size: 8.5, color: MUTED, align: 'right' })
      sheet.text(brl(items.reduce((s, i) => s + price(i), 0)), PAGE_W - M - 1, sheet.y + 5, { size: 9.5, bold: true, align: 'right' })
      sheet.rule(sheet.y + 7.6, LINE, 0.15)
      sheet.y += 7.6
    }
    sheet.y += 3
  }

  heading('Do valor e da forma de pagamento', 55)
  sheet.paragraph(`O valor total do contrato é de ${brl(contract.value)}, pago conforme o cronograma a seguir.`)
  if (parcels.length) {
    const COLS = { n: M + 1, label: M + 12, due: PAGE_W - M - 42, amount: PAGE_W - M - 1 }
    const head = () => {
      sheet.ensure(16)
      sheet.pdf.setFillColor(...SOFT)
      sheet.pdf.rect(M, sheet.y, CW, 7, 'F')
      sheet.text('Nº', COLS.n, sheet.y + 4.7, { size: 7.2, bold: true, color: MUTED })
      sheet.text('PARCELA', COLS.label, sheet.y + 4.7, { size: 7.2, bold: true, color: MUTED })
      sheet.text('VENCIMENTO', COLS.due, sheet.y + 4.7, { size: 7.2, bold: true, color: MUTED, align: 'right' })
      sheet.text('VALOR', COLS.amount, sheet.y + 4.7, { size: 7.2, bold: true, color: MUTED, align: 'right' })
      sheet.y += 7
    }
    head()
    parcels.forEach((p, i) => {
      if (sheet.ensure(9)) head()
      const top = sheet.y
      sheet.text(String(i + 1).padStart(2, '0'), COLS.n, top + 5.6, { size: 8, color: MUTED })
      sheet.text(p.label || `Parcela ${i + 1}`, COLS.label, top + 5.6, { size: 9.5 })
      sheet.text(fmtDate(p.dueDate), COLS.due, top + 5.6, { size: 9.5, align: 'right' })
      sheet.text(brl(p.amount), COLS.amount, top + 5.6, { size: 9.5, bold: true, align: 'right' })
      sheet.rule(top + 8.4, LINE, 0.15)
      sheet.y += 8.4
    })
    sheet.text('Total das parcelas', COLS.due, sheet.y + 6, { size: 8.5, color: MUTED, align: 'right' })
    sheet.text(brl(parcelsTotal), COLS.amount, sheet.y + 6, { size: 10, bold: true, align: 'right' })
    sheet.y += 10
    if (Math.abs(parcelsTotal - contract.value) > 0.05) {
      sheet.paragraph(`Atenção: a soma das parcelas (${brl(parcelsTotal)}) difere do valor do contrato (${brl(contract.value)}).`, { color: [192, 57, 43] })
    }
  }

  heading('Dos prazos')
  sheet.paragraph(`Início previsto em ${fmtDate(contract.startDate)} e conclusão prevista em ${fmtDate(contract.endDate)}, contados conforme as condições gerais abaixo.`)

  if (contract.terms?.trim()) {
    heading('Das condições gerais')
    sheet.paragraph(contract.terms)
  }

  sheet.section('Assinaturas', 78)
  sheet.paragraph('E, por estarem de acordo, as partes assinam o presente instrumento em duas vias de igual teor.', { color: MUTED })
  signatures(sheet, ['Contratante', client?.name ?? ''], ['Contratada', company.legalName || company.name])
  sheet.ensure(26)
  sheet.text('TESTEMUNHAS', M, sheet.y + 2, { size: 7.2, bold: true, color: MUTED })
  const half = CW / 2 - 8
  for (const i of [0, 1]) {
    const x = M + i * (half + 16)
    sheet.rule(sheet.y + 14, INK, 0.25, x, x + half)
    sheet.text('Nome e CPF', x, sheet.y + 18.4, { size: 7.5, color: MUTED })
  }
  sheet.y += 24
  return sheet.blob()
}

// layout compartilhado com outros documentos (relatório técnico de produção)
export { Sheet, signatures, M, CW, PAGE_W, INK, MUTED, LINE, SOFT }
