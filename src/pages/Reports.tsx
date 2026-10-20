import { useMemo, useState } from 'react'
import { Box, Button, GlobalStyles, Grid, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { DownloadIcon, InsightsIcon, PrintIcon } from '../components/icons'
import { DataTable, EmptyState, LoadingState, PageHeader, StatCard, type Column } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { useCollections, useCompany, useProjectStages } from '../lib/store'
import { fileUrl } from '../lib/api'
import { PROJECT_PRIORITIES, OP_STATUS, QUALITY_KINDS, optLabel } from '../domain/constants'
import { bomCost } from '../domain/bom'
import { budgetTotals } from '../domain/budget'
import { addDaysISO, brl, downloadBlob, fmtDate, fmtDuration, isoDay, todayISO, toCsv } from '../lib/format'
import { isDoneStatus, progressOf, statusesFor } from '../domain/tasks'
import { productivity, stopsByReason } from '../domain/shopfloor'
import { colors } from '../theme'
import type { CollectionName } from '../types'

type Row = Record<string, string | number | null>
interface Report {
  id: string
  title: string
  description: string
  module: Parameters<ReturnType<typeof useAuth>['can']>[0]
  needs: CollectionName[]
  dated: boolean
}

const REPORTS: Report[] = [
  { id: 'projects', title: 'Carteira de projetos', description: 'Etapa, prazo, valor, progresso e atrasos por projeto.', module: 'projects', needs: ['projects', 'clients', 'tasks', 'users'], dated: false },
  { id: 'production', title: 'Produtividade da fábrica', description: 'Tempo planejado x apontado por ordem e por setor.', module: 'production', needs: ['productionOrders', 'workCenters', 'projects'], dated: true },
  { id: 'shopfloor', title: 'Apontamentos do chão de fábrica', description: 'Cada etapa feita: setor, operador, início e fim, tempo previsto x real e desvio.', module: 'shopfloor', needs: ['productionOrders', 'workCenters', 'projects'], dated: true },
  { id: 'efficiency', title: 'Previsto x realizado por setor e operador', description: 'Etapas concluídas no período: tempo previsto, tempo real, desvio e eficiência de cada setor e de cada operador.', module: 'production', needs: ['productionOrders', 'workCenters'], dated: true },
  { id: 'stops', title: 'Paradas por motivo', description: 'Quanto tempo a produção ficou pausada e por quê (falta de material, máquina parada, ajuste…), separando paradas previstas.', module: 'production', needs: ['productionOrders', 'workCenters'], dated: true },
  { id: 'inventory', title: 'Posição de estoque', description: 'Saldo, custo, valor em estoque e itens abaixo do mínimo.', module: 'inventory', needs: ['materials', 'suppliers'], dated: false },
  { id: 'purchases', title: 'Compras por fornecedor', description: 'Volume e valor comprado por fornecedor no período.', module: 'purchases', needs: ['purchases', 'suppliers'], dated: true },
  { id: 'sales', title: 'Orçamentos e vendas', description: 'Propostas emitidas, aprovadas e margem no período.', module: 'budgets', needs: ['budgets', 'clients'], dated: true },
  { id: 'finance', title: 'Movimentação financeira', description: 'Lançamentos pagos no período, por categoria.', module: 'financial', needs: ['receivables', 'payables'], dated: true },
  { id: 'quality', title: 'Não conformidades', description: 'Ocorrências, custo da não qualidade e causas.', module: 'quality', needs: ['qualityRecords', 'workCenters'], dated: true },
  { id: 'boms', title: 'Custo das fichas técnicas', description: 'Custo de materiais, ferragens e mão de obra por módulo.', module: 'bom', needs: ['boms', 'materials', 'workCenters'], dated: false },
]

export function ReportsPage() {
  const { can } = useAuth()
  const company = useCompany()
  const available = REPORTS.filter((r) => can(r.module))
  const [id, setId] = useState(available[0]?.id ?? '')
  const [from, setFrom] = useState(addDaysISO(todayISO(), -90))
  const [to, setTo] = useState(todayISO())
  const report = REPORTS.find((r) => r.id === id) ?? available[0]
  const stages = useProjectStages()
  const { data, maps, loading } = useCollections(report?.needs ?? [])
  const d = data as Record<string, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = maps as Record<string, Map<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any

  const built = useMemo<{ columns: string[]; rows: Row[]; summary: { label: string; value: string }[] }>(() => {
    if (!report) return { columns: [], rows: [], summary: [] }
    const inRange = (iso?: string | null) => Boolean(iso) && String(iso).slice(0, 10) >= from && String(iso).slice(0, 10) <= to
    switch (report.id) {
      case 'projects': {
        const rows = (d.projects ?? []).map((p) => {
          const tasks = (d.tasks ?? []).filter((t) => t.projectId === p.id)
          const st = statusesFor(p)
          return {
            Código: p.code,
            Projeto: p.name,
            Cliente: m.clients?.get(p.clientId)?.name ?? '',
            Etapa: stages.find((s) => s.id === p.stageId)?.label ?? p.stageId,
            Prioridade: optLabel(PROJECT_PRIORITIES, p.priority),
            Responsável: m.users?.get(p.managerId)?.name ?? '',
            Entrega: fmtDate(p.dueDate),
            'Valor (R$)': p.contractValue ?? 0,
            'Custo previsto (R$)': p.estimatedCost ?? 0,
            'Progresso (%)': progressOf(tasks, st),
            'Tarefas abertas': tasks.filter((t) => !isDoneStatus(st, t.status)).length,
          } as Row
        })
        return { columns: Object.keys(rows[0] ?? {}), rows, summary: [{ label: 'Projetos', value: String(rows.length) }, { label: 'Valor total', value: brl(rows.reduce((s, r) => s + Number(r['Valor (R$)']), 0)) }] }
      }
      case 'production': {
        const rows: Row[] = []
        for (const o of d.productionOrders ?? []) {
          if (o.dueDate && !inRange(o.dueDate) && !inRange(o.completedAt)) continue
          const planned = o.operations.reduce((s: number, x: { plannedMinutes: number }) => s + x.plannedMinutes * 60, 0)
          const actual = o.operations.reduce((s: number, x: { actualSeconds: number }) => s + x.actualSeconds, 0)
          rows.push({
            OP: o.code,
            Título: o.title,
            Projeto: m.projects?.get(o.projectId)?.name ?? '',
            Situação: optLabel(OP_STATUS, o.status),
            Entrega: fmtDate(o.dueDate),
            Planejado: fmtDuration(planned),
            Apontado: fmtDuration(actual),
            'Desvio (%)': planned ? Math.round(((actual - planned) / planned) * 100) : 0,
          })
        }
        return { columns: Object.keys(rows[0] ?? {}), rows, summary: [{ label: 'Ordens', value: String(rows.length) }] }
      }
      case 'shopfloor': {
        const rows: Row[] = []
        let doneCount = 0
        let plannedSec = 0
        let actualSec = 0
        const bySector = new Map<string, number>()
        const byOperator = new Map<string, number>()
        for (const o of d.productionOrders ?? []) {
          for (const op of o.operations ?? []) {
            const reference = op.finishedAt ?? op.startedAt ?? o.dueDate
            if (!inRange(reference)) continue
            const plannedS = (op.plannedMinutes ?? 0) * 60
            const sector = m.workCenters?.get(op.workCenterId)?.name ?? op.name
            if (op.status === 'concluida') {
              doneCount += 1
              plannedSec += plannedS
              actualSec += op.actualSeconds
              bySector.set(sector, (bySector.get(sector) ?? 0) + op.actualSeconds)
              if (op.operatorName) byOperator.set(op.operatorName, (byOperator.get(op.operatorName) ?? 0) + op.actualSeconds)
            }
            rows.push({
              OP: o.code,
              Projeto: m.projects?.get(o.projectId)?.name ?? '',
              Setor: sector,
              Etapa: op.name,
              Operador: op.operatorName ?? '',
              Início: op.startedAt ? fmtDate(op.startedAt, 'dd/MM/yyyy HH:mm') : '',
              Fim: op.finishedAt ? fmtDate(op.finishedAt, 'dd/MM/yyyy HH:mm') : '',
              'Previsto (min)': Math.round(plannedS / 60),
              'Real (min)': Math.round(op.actualSeconds / 60),
              'Desvio (%)': plannedS && op.actualSeconds ? Math.round(((op.actualSeconds - plannedS) / plannedS) * 100) : 0,
              Quantidade: op.quantityDone ?? 0,
              Situação: op.status === 'concluida' ? 'Concluída' : op.status === 'em_andamento' ? 'Em andamento' : op.status === 'pausada' ? 'Pausada' : 'Pendente',
            })
          }
        }
        const top = (map: Map<string, number>) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]
        const topSector = top(bySector)
        const topOperator = top(byOperator)
        return {
          columns: Object.keys(rows[0] ?? {}),
          rows,
          summary: [
            { label: 'Etapas concluídas', value: String(doneCount) },
            { label: 'Tempo apontado', value: fmtDuration(actualSec) },
            { label: 'Eficiência (previsto ÷ real)', value: actualSec ? `${Math.round((plannedSec / actualSec) * 100)}%` : '—' },
            { label: 'Setor com mais horas', value: topSector ? `${topSector[0]} · ${fmtDuration(topSector[1])}` : '—' },
            ...(topOperator ? [{ label: 'Operador com mais horas', value: `${topOperator[0]} · ${fmtDuration(topOperator[1])}` }] : []),
          ],
        }
      }
      case 'efficiency': {
        const lines = productivity(d.productionOrders ?? [], (id) => m.workCenters?.get(id)?.name ?? '', { from, to })
        const rows = lines.map(
          (l) =>
            ({
              Tipo: l.kind === 'setor' ? 'Setor' : 'Operador',
              Nome: l.name,
              Etapas: l.steps,
              'Previsto (h)': Math.round((l.plannedSeconds / 3600) * 100) / 100,
              'Real (h)': Math.round((l.actualSeconds / 3600) * 100) / 100,
              'Desvio (%)': l.plannedSeconds ? Math.round(((l.actualSeconds - l.plannedSeconds) / l.plannedSeconds) * 100) : 0,
              'Eficiência (%)': l.actualSeconds ? Math.round((l.plannedSeconds / l.actualSeconds) * 100) : 0,
            }) as Row,
        )
        const sectors = lines.filter((l) => l.kind === 'setor')
        const planned = sectors.reduce((sum, l) => sum + l.plannedSeconds, 0)
        const actual = sectors.reduce((sum, l) => sum + l.actualSeconds, 0)
        const worst = [...sectors].filter((l) => l.plannedSeconds > 0).sort((a, b) => b.actualSeconds / b.plannedSeconds - a.actualSeconds / a.plannedSeconds)[0]
        return {
          columns: ['Tipo', 'Nome', 'Etapas', 'Previsto (h)', 'Real (h)', 'Desvio (%)', 'Eficiência (%)'],
          rows,
          summary: [
            { label: 'Etapas concluídas', value: String(sectors.reduce((sum, l) => sum + l.steps, 0)) },
            { label: 'Previsto x real', value: `${fmtDuration(planned)} / ${fmtDuration(actual)}` },
            { label: 'Eficiência geral', value: actual ? `${Math.round((planned / actual) * 100)}%` : '—' },
            { label: 'Setor mais acima do previsto', value: worst && worst.actualSeconds > worst.plannedSeconds ? `${worst.name} · +${Math.round(((worst.actualSeconds - worst.plannedSeconds) / worst.plannedSeconds) * 100)}%` : '—' },
          ],
        }
      }
      case 'stops': {
        const lines = stopsByReason(d.productionOrders ?? [], (id) => m.workCenters?.get(id)?.name ?? '', { from, to })
        const lost = lines.filter((l) => !l.planned).reduce((sum, l) => sum + l.seconds, 0)
        const rows = lines.map(
          (l) =>
            ({
              Motivo: l.label,
              Tipo: l.planned ? 'Prevista' : 'Perda',
              Paradas: l.count,
              'Tempo total': fmtDuration(l.seconds),
              'Tempo médio': fmtDuration(l.count ? l.seconds / l.count : 0),
              '% das perdas': !l.planned && lost ? Math.round((l.seconds / lost) * 100) : 0,
              'Setor mais afetado': l.topSector,
            }) as Row,
        )
        const top = lines.find((l) => !l.planned)
        return {
          columns: ['Motivo', 'Tipo', 'Paradas', 'Tempo total', 'Tempo médio', '% das perdas', 'Setor mais afetado'],
          rows,
          summary: [
            { label: 'Tempo perdido em paradas', value: fmtDuration(lost) },
            { label: 'Paradas previstas', value: fmtDuration(lines.filter((l) => l.planned).reduce((sum, l) => sum + l.seconds, 0)) },
            { label: 'Maior causa de perda', value: top ? `${top.label} · ${fmtDuration(top.seconds)}` : '—' },
          ],
        }
      }
      case 'inventory': {
        const rows = (d.materials ?? []).map((x) => ({
          Código: x.code ?? '',
          Material: x.name,
          Categoria: x.category,
          Unidade: x.unit,
          Saldo: x.stock,
          Mínimo: x.minStock,
          'Custo (R$)': x.cost,
          'Valor em estoque (R$)': Math.round(x.stock * x.cost * 100) / 100,
          Fornecedor: m.suppliers?.get(x.supplierId)?.name ?? '',
          Situação: x.minStock > 0 && x.stock <= x.minStock ? 'Abaixo do mínimo' : 'Normal',
        })) as Row[]
        return { columns: Object.keys(rows[0] ?? {}), rows, summary: [{ label: 'Itens', value: String(rows.length) }, { label: 'Valor em estoque', value: brl(rows.reduce((s, r) => s + Number(r['Valor em estoque (R$)']), 0)) }] }
      }
      case 'purchases': {
        const by = new Map<string, { qtd: number; total: number }>()
        for (const p of d.purchases ?? []) {
          if (!inRange(p.createdAt) || p.status === 'cancelado') continue
          const k = m.suppliers?.get(p.supplierId)?.name ?? 'Sem fornecedor'
          const cur = by.get(k) ?? { qtd: 0, total: 0 }
          cur.qtd += 1
          cur.total += p.items.reduce((s: number, i: { quantity: number; unitCost: number }) => s + i.quantity * i.unitCost, 0) + (p.freight ?? 0)
          by.set(k, cur)
        }
        const rows = [...by.entries()].sort((a, b) => b[1].total - a[1].total).map(([Fornecedor, v]) => ({ Fornecedor, Pedidos: v.qtd, 'Valor (R$)': Math.round(v.total * 100) / 100 })) as Row[]
        return { columns: ['Fornecedor', 'Pedidos', 'Valor (R$)'], rows, summary: [{ label: 'Total comprado', value: brl(rows.reduce((s, r) => s + Number(r['Valor (R$)']), 0)) }] }
      }
      case 'sales': {
        const rows = (d.budgets ?? [])
          .filter((b) => inRange(b.createdAt))
          .map((b) => {
            const t = budgetTotals(b)
            return { Código: b.code, Título: b.title, Cliente: m.clients?.get(b.clientId)?.name ?? '', Situação: b.status, 'Total (R$)': t.total, 'Lucro (R$)': t.profit, 'Lucro (%)': t.profitPercent, Data: fmtDate(b.createdAt) } as Row
          })
        const ap = rows.filter((r) => r.Situação === 'aprovado')
        return { columns: Object.keys(rows[0] ?? {}), rows, summary: [{ label: 'Emitidos', value: String(rows.length) }, { label: 'Aprovados', value: `${ap.length} (${brl(ap.reduce((s, r) => s + Number(r['Total (R$)']), 0))})` }] }
      }
      case 'finance': {
        const mk = (list: any[], tipo: string) => // eslint-disable-line @typescript-eslint/no-explicit-any
          list.filter((e) => e.status === 'pago' && inRange(e.paidDate)).map((e) => ({ Tipo: tipo, Data: fmtDate(e.paidDate), Descrição: e.description, Categoria: e.category, 'Valor (R$)': e.amount }) as Row)
        const rows = [...mk(d.receivables ?? [], 'Receita'), ...mk(d.payables ?? [], 'Despesa')].sort((a, b) => String(a.Data).localeCompare(String(b.Data)))
        const inc = rows.filter((r) => r.Tipo === 'Receita').reduce((s, r) => s + Number(r['Valor (R$)']), 0)
        const out = rows.filter((r) => r.Tipo === 'Despesa').reduce((s, r) => s + Number(r['Valor (R$)']), 0)
        return { columns: ['Tipo', 'Data', 'Descrição', 'Categoria', 'Valor (R$)'], rows, summary: [{ label: 'Receitas', value: brl(inc) }, { label: 'Despesas', value: brl(out) }, { label: 'Resultado', value: brl(inc - out) }] }
      }
      case 'quality': {
        const rows = (d.qualityRecords ?? [])
          .filter((q) => inRange(q.openedAt))
          .map((q) => ({ Código: q.code, Registro: q.title, Tipo: optLabel(QUALITY_KINDS, q.kind), Gravidade: q.severity, Setor: m.workCenters?.get(q.workCenterId)?.name ?? '', Situação: q.status, 'Custo (R$)': q.cost ?? 0, Abertura: fmtDate(q.openedAt) }) as Row)
        return { columns: Object.keys(rows[0] ?? {}), rows, summary: [{ label: 'Ocorrências', value: String(rows.length) }, { label: 'Custo', value: brl(rows.reduce((s, r) => s + Number(r['Custo (R$)']), 0)) }] }
      }
      case 'boms': {
        const rows = (d.boms ?? []).map((b) => {
          const c = bomCost(b, m.materials, m.workCenters)
          return { Código: b.code, Ficha: b.name, 'Área (m²)': c.areaM2, 'Chapas (R$)': c.materials, 'Fita (R$)': c.edge, 'Ferragens (R$)': c.hardware, 'Mão de obra (R$)': c.labor, 'Custo total (R$)': c.total, 'Preço de venda (R$)': b.salePrice ?? 0 } as Row
        })
        return { columns: Object.keys(rows[0] ?? {}), rows, summary: [{ label: 'Fichas', value: String(rows.length) }] }
      }
      default:
        return { columns: [], rows: [], summary: [] }
    }
  }, [report, d, m, from, to, stages])

  const exportCsv = () => {
    const table = [built.columns, ...built.rows.map((r) => built.columns.map((c) => r[c]))]
    downloadBlob(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }), `${report?.id}-${isoDay()}.csv`)
  }
  const exportXlsx = async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.json_to_sheet(built.rows, { header: built.columns })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, (report?.title ?? 'Relatório').slice(0, 30))
    XLSX.writeFile(wb, `${report?.id}-${isoDay()}.xlsx`)
  }

  const columns: Column<Row>[] = built.columns.map((c) => ({
    key: c,
    header: c,
    sort: (r) => r[c],
    align: typeof built.rows[0]?.[c] === 'number' ? 'right' : 'left',
    render: (r) => {
      const v = r[c]
      if (typeof v === 'number') return /R\$/.test(c) ? brl(v) : v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
      return v ?? ''
    },
  }))

  if (!report)
    return <EmptyState icon={<InsightsIcon />} title="Nenhum relatório disponível" description="Seu perfil não possui módulos com relatórios." />

  return (
    <Box>
      {/* Impressão: some o menu do sistema e o relatório sai com a logo e os dados da empresa */}
      <GlobalStyles
        styles={{
          '@media print': {
            'aside, header.MuiAppBar-root, .no-print': { display: 'none !important' },
            body: { background: '#fff !important' },
            main: { padding: '0 !important', maxWidth: 'none !important' },
            '@page': { margin: '12mm' },
          },
        }}
      />
      <Box className="print-only" sx={{ display: 'none', '@media print': { display: 'flex' }, alignItems: 'center', gap: 2, pb: 1.5, mb: 2, borderBottom: `2px solid ${colors.brand}` }}>
        {company.logoFileId ? (
          <Box component="img" src={fileUrl(company.logoFileId, { inline: true })} alt="" sx={{ maxHeight: 54, maxWidth: 220, objectFit: 'contain' }} />
        ) : (
          <Typography variant="h6" sx={{ color: colors.brand, fontWeight: 800 }}>
            {company.name}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {report.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {[company.legalName || company.name, company.cnpj ? `CNPJ ${company.cnpj}` : '', [company.phone, company.email].filter(Boolean).join(' · ')].filter(Boolean).join(' · ')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Emitido em {fmtDate(todayISO())}
          </Typography>
        </Box>
      </Box>
      <Box className="no-print">
        <PageHeader title="Relatórios" subtitle="Consulte, filtre e exporte indicadores de projetos, produção, estoque, compras e financeiro." />
      </Box>
      <Paper className="no-print" variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2.5 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
          <TextField select label="Relatório" value={report.id} onChange={(e) => setId(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 300 } }}>
            {available.map((r) => (
              <MenuItem key={r.id} value={r.id}>
                {r.title}
              </MenuItem>
            ))}
          </TextField>
          {report.dated ? (
            <>
              <TextField type="date" label="De" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }} />
              <TextField type="date" label="Até" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }} />
            </>
          ) : null}
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<PrintIcon />} variant="outlined" color="inherit" onClick={() => window.print()}>
            Imprimir
          </Button>
          <Button startIcon={<DownloadIcon />} variant="outlined" color="inherit" onClick={exportCsv} disabled={!built.rows.length}>
            CSV
          </Button>
          <Button startIcon={<DownloadIcon />} variant="contained" onClick={exportXlsx} disabled={!built.rows.length}>
            Excel
          </Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {report.description}
        </Typography>
      </Paper>

      {built.summary.length ? (
        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          {built.summary.map((s) => (
            <Grid key={s.label} size={{ xs: 6, md: 3 }}>
              <StatCard label={s.label} value={s.value} tone="brand" />
            </Grid>
          ))}
        </Grid>
      ) : null}

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', borderColor: colors.border }}>
        {loading ? (
          <LoadingState />
        ) : built.rows.length === 0 ? (
          <EmptyState icon={<InsightsIcon />} title="Sem dados para o filtro" description="Ajuste o período ou cadastre registros para gerar este relatório." />
        ) : (
          <DataTable rows={built.rows} columns={columns} rowKey={(r) => JSON.stringify(r)} pageSize={25} dense />
        )}
      </Paper>
    </Box>
  )
}
