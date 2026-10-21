import { CW, LINE, M, MUTED, SOFT, Sheet, logoPng, signatures } from './pdf'
import { OP_STATUS, QUALITY_KINDS, optLabel } from './constants'
import { fmtDate } from '../lib/format'
import { PAUSE_REASONS } from '../../shared/shopfloor.mjs'
import type { LabelUnit } from '../lib/planUnits'
import type { Client, CompanySettings, OpOperation, ProductionOrder, Project, QualityInspection, QualityRecord, WorkCenter } from '../types'

export interface ProductionReportInput {
  company: CompanySettings
  project: Project
  client?: Client
  orders: ProductionOrder[]
  workCenters: Map<string, WorkCenter>
  /** etiquetas de cada ordem (planos de corte vinculados) */
  unitsOf: (order: ProductionOrder) => LabelUnit[]
  quality: QualityRecord[]
  inspections: QualityInspection[]
  /** "agora" (para pausas ainda abertas e etapas em andamento) */
  now?: number
}

const when = (iso?: string | null) => (iso ? fmtDate(iso, 'dd/MM/yyyy HH:mm') : '—')
const elapsed = (op: OpOperation, now: number) => (op.actualSeconds || 0) + (op.runningSince ? Math.max(0, (now - Date.parse(op.runningSince)) / 1000) : 0)
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
// sem tempo apontado não há desvio a mostrar (etapa ainda não feita)
const deviation = (real: number, planned: number) => (planned && real ? `${real >= planned ? '+' : ''}${Math.round(((real - planned) / planned) * 100)}%` : '—')
/** Duração compacta para tabelas: "40 min", "2h 05". */
const fmtDuration = (seconds: number) => {
  const m = Math.round(seconds / 60)
  if (seconds > 0 && m < 1) return '< 1 min'
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`
}
const stepStatus = (op: OpOperation) => ({ pendente: 'Pendente', em_andamento: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída' })[op.status] ?? op.status
const operatorsOf = (op: OpOperation) => {
  const names = [...new Set((op.segments ?? []).map((s) => s.operatorName).filter(Boolean))]
  return names.length ? names.join(', ') : op.operatorName || '—'
}

type Col = { title: string; width: number; align?: 'left' | 'right' | 'center' }

/** Tabela simples com cabeçalho repetido a cada página. */
function table(sheet: Sheet, cols: Col[], rows: string[][]) {
  const header = () => {
    sheet.ensure(14)
    sheet.pdf.setFillColor(...SOFT)
    sheet.pdf.rect(M, sheet.y, CW, 7, 'F')
    let x = M
    for (const c of cols) {
      const tx = c.align === 'right' ? x + c.width - 1.5 : c.align === 'center' ? x + c.width / 2 : x + 1.5
      sheet.text(c.title.toUpperCase(), tx, sheet.y + 4.7, { size: 6.8, bold: true, color: MUTED, align: c.align ?? 'left' })
      x += c.width
    }
    sheet.y += 7
  }
  header()
  for (const row of rows) {
    const cells = row.map((v, i) => sheet.wrap(v || '—', cols[i].width - 3, 8.2))
    const h = Math.max(...cells.map((l) => l.length)) * 3.7 + 3.4
    if (sheet.ensure(h + 1)) header()
    let x = M
    cells.forEach((lines, i) => {
      const c = cols[i]
      const tx = c.align === 'right' ? x + c.width - 1.5 : c.align === 'center' ? x + c.width / 2 : x + 1.5
      sheet.text(lines, tx, sheet.y + 4.4, { size: 8.2, align: c.align ?? 'left' })
      x += c.width
    })
    sheet.rule(sheet.y + h, LINE, 0.15)
    sheet.y += h
  }
}

/**
 * Relatório técnico do chão de fábrica de um projeto: etapas com previsto x real, operadores, etiquetas
 * concluídas, paradas com motivo, ocorrências e inspeção de qualidade.
 */
export async function buildProductionReportPdf(d: ProductionReportInput): Promise<Blob> {
  const now = d.now ?? Date.now()
  const logo = await logoPng(140, d.company)
  const sheet = new Sheet(d.company, logo, 'Relatório técnico de produção', d.project.code)
  const ops = d.orders.flatMap((o) => o.operations)
  const planned = ops.reduce((s, op) => s + (op.plannedMinutes || 0) * 60, 0)
  const real = ops.reduce((s, op) => s + elapsed(op, now), 0)
  const finished = ops.filter((op) => op.status === 'concluida')
  const done = finished.length
  // eficiência e desvio só das etapas concluídas (o previsto das que faltam distorceria a conta)
  const donePlanned = finished.reduce((s, op) => s + (op.plannedMinutes || 0) * 60, 0)
  const doneReal = finished.reduce((s, op) => s + elapsed(op, now), 0)
  const lost = ops.flatMap((op) => op.pauses ?? []).filter((p) => !PAUSE_REASONS.find((r) => r.value === p.reason)?.planned)
  const pauseSeconds = (p: NonNullable<OpOperation['pauses']>[number]) => p.seconds ?? Math.max(0, ((p.end ? Date.parse(p.end) : now) - Date.parse(p.start)) / 1000)

  sheet.masthead('Relatório técnico de produção', d.project.name, [
    ['Projeto', d.project.code ?? '—'],
    ['Emitido em', when(new Date(now).toISOString())],
    ['Etapas', `${done}/${ops.length} concluídas`],
  ])

  sheet.section('Resumo')
  sheet.facts(
    [
      ['Cliente', d.client?.name ?? '—'],
      ['Ordens de produção', d.orders.map((o) => `${o.code} (${optLabel(OP_STATUS, o.status)})`).join(', ') || '—'],
      ['Tempo previsto (roteiro completo)', planned ? fmtDuration(planned) : 'Não informado'],
      ['Tempo apontado até agora', real ? fmtDuration(real) : '—'],
      ['Eficiência das etapas concluídas', donePlanned && doneReal ? pct(donePlanned, doneReal) : '—'],
      ['Desvio das etapas concluídas', deviation(doneReal, donePlanned)],
      ['Paradas (perda)', `${lost.length} · ${fmtDuration(lost.reduce((s, p) => s + pauseSeconds(p), 0))}`],
      ['Ocorrências de qualidade', String(d.quality.length)],
    ],
    2,
  )

  for (const order of d.orders) {
    const steps = [...order.operations].sort((a, b) => a.order - b.order)
    const units = d.unitsOf(order)
    sheet.section(`${order.code} · ${order.title}`, 30)
    sheet.facts(
      [
        ['Situação', optLabel(OP_STATUS, order.status)],
        ['Entrega prevista', fmtDate(order.dueDate)],
        ['Liberada em', when(order.releasedAt)],
        ['Concluída em', when(order.completedAt)],
        ['Itens', order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') || undefined],
        ['Etiquetas (peças)', units.length ? String(units.length) : undefined],
      ],
      2,
    )
    table(
      sheet,
      [
        { title: 'Etapa', width: 30 },
        { title: 'Operador(es)', width: 26 },
        { title: 'Início', width: 21 },
        { title: 'Fim', width: 21 },
        { title: 'Previsto', width: 14, align: 'right' },
        { title: 'Real', width: 14, align: 'right' },
        { title: 'Desvio', width: 12, align: 'right' },
        { title: 'Peças', width: 14, align: 'right' },
        { title: 'Situação', width: CW - 152 },
      ],
      steps.map((op) => {
        const p = (op.plannedMinutes || 0) * 60
        const r = elapsed(op, now)
        return [
          op.name || d.workCenters.get(op.workCenterId)?.name || 'Etapa',
          operatorsOf(op),
          when(op.startedAt),
          when(op.finishedAt),
          p ? fmtDuration(p) : '—',
          r ? fmtDuration(r) : '—',
          op.status === 'concluida' ? deviation(r, p) : '—',
          units.length ? `${op.piecesDone?.length ?? 0}/${units.length}` : String(op.quantityDone ?? 0),
          stepStatus(op),
        ]
      }),
    )

    // peças que ainda não passaram por cada etapa (para conferência)
    if (units.length) {
      const pending = steps
        .map((op) => {
          const set = new Set(op.piecesDone ?? [])
          return { op, missing: units.filter((u) => !set.has(u.key)) }
        })
        .filter((x) => x.missing.length && x.op.startedAt)
      if (pending.length) {
        sheet.y += 3
        sheet.text('Etiquetas pendentes nas etapas iniciadas', M, sheet.y + 4, { size: 8.5, bold: true })
        sheet.y += 6
        for (const { op, missing } of pending) {
          const list = missing.slice(0, 15).map((u) => u.code || `${u.piece.label} ${u.n}/${u.piece.quantity}`).join(', ')
          sheet.paragraph(`${op.name}: ${missing.length} de ${units.length} pendente(s) — ${list}${missing.length > 15 ? ` e mais ${missing.length - 15} (veja em Etiquetas do projeto)` : ''}`, { size: 8.2, color: MUTED })
        }
      }
    }

    const pauses = steps.flatMap((op) => (op.pauses ?? []).map((p) => ({ op, p })))
    if (pauses.length) {
      sheet.y += 3
      sheet.text('Paradas', M, sheet.y + 4, { size: 8.5, bold: true })
      sheet.y += 6
      table(
        sheet,
        [
          { title: 'Etapa', width: 34 },
          { title: 'Motivo', width: 44 },
          { title: 'Início', width: 26 },
          { title: 'Duração', width: 20, align: 'right' },
          { title: 'Por / observação', width: CW - 124 },
        ],
        pauses.map(({ op, p }) => {
          const reason = PAUSE_REASONS.find((r) => r.value === p.reason)
          return [op.name, `${reason?.label ?? p.reason}${reason?.planned ? ' (prevista)' : ''}`, when(p.start), `${fmtDuration(pauseSeconds(p))}${p.end ? '' : ' (aberta)'}`, [p.byName, p.note].filter(Boolean).join(' · ')]
        }),
      )
    }

    const inspection = d.inspections.filter((i) => i.productionOrderId === order.id).sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0]
    if (inspection) {
      sheet.y += 3
      sheet.facts(
        [
          ['Inspeção de qualidade', { pending: 'Aguardando', approved: 'Aprovada', rejected: 'Reprovada' }[inspection.status]],
          ['Conferida por', inspection.checkedByName ? `${inspection.checkedByName} · ${when(inspection.checkedAt)}` : undefined],
          ['Observações da inspeção', inspection.notes || undefined],
        ],
        2,
      )
    }
  }

  if (d.quality.length) {
    sheet.section('Ocorrências de qualidade')
    table(
      sheet,
      [
        { title: 'Data', width: 22 },
        { title: 'Tipo', width: 30 },
        { title: 'Setor', width: 32 },
        { title: 'Descrição', width: CW - 104 },
        { title: 'Situação', width: 20 },
      ],
      d.quality.map((q) => [fmtDate(q.openedAt), optLabel(QUALITY_KINDS, q.kind), d.workCenters.get(q.workCenterId ?? '')?.name ?? '—', [q.title, q.description].filter(Boolean).join(' — '), q.status.replace('_', ' ')]),
    )
  }

  sheet.section('Responsáveis', 40)
  signatures(sheet, ['Responsável pela produção', ''], ['Qualidade', ''], true)
  return sheet.blob()
}
