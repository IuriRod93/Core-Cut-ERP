import { useMemo } from 'react'
import { Alert, Box, Chip, Grid, Typography } from '@mui/material'
import { Stack } from './Stack'
import { Panel, ProgressLine, StatCard } from './ui'
import { useAuth } from '../auth/AuthContext'
import { useCollections } from '../lib/store'
import type { CollectionName } from '../types'
import { projectCost } from '../domain/projectCost'
import { brl, fmtHours } from '../lib/format'
import { colors } from '../theme'

const OVER = '#b3261e'
const OK = '#2e7d4f'
const WARN = '#b9852e'

/**
 * Fechamento do custo do projeto: previsto no orçamento × realizado (compras recebidas, horas da fábrica,
 * despesas) e a margem que sobra. Fica na visão geral do projeto.
 */
export function ProjectCostPanel({ projectId }: { projectId: string }) {
  const { can } = useAuth()
  // só pede o que o perfil enxerga: o painel mostra o que houver de cada fonte
  const names = useMemo(() => {
    const n: CollectionName[] = ['budgets', 'purchases']
    if (can('production')) n.push('productionOrders', 'workCenters')
    if (can('financial')) n.push('payables', 'receivables')
    return n
  }, [can])
  const { data } = useCollections(names)
  const cost = useMemo(
    () =>
      projectCost({
        projectId,
        budgets: data.budgets ?? [],
        purchases: data.purchases ?? [],
        orders: data.productionOrders ?? [],
        workCenters: data.workCenters ?? [],
        payables: data.payables ?? [],
        receivables: data.receivables ?? [],
      }),
    [projectId, data.budgets, data.purchases, data.productionOrders, data.workCenters, data.payables, data.receivables],
  )

  if (!cost) {
    return (
      <Panel title="Custo real do projeto" subtitle="Orçado × realizado">
        <Typography variant="body2" color="text.secondary">
          Vincule um orçamento a este projeto para acompanhar quanto do previsto já foi gasto.
        </Typography>
      </Panel>
    )
  }

  const tone = cost.status === 'estouro' ? OVER : cost.status === 'atencao' ? WARN : OK
  const usedPercent = cost.planned > 0 ? (cost.projected / cost.planned) * 100 : 0
  const marginDelta = Math.round((cost.projectedMarginPercent - cost.plannedMarginPercent) * 10) / 10

  return (
    <Panel
      title="Custo real do projeto"
      subtitle={`Orçamento ${cost.budgetCode ?? ''} · previsto × realizado`}
      actions={<Chip size="small" label={cost.status === 'estouro' ? 'Acima do orçado' : cost.status === 'atencao' ? 'Pouco acima' : 'Dentro do orçado'} sx={{ bgcolor: `${tone}1f`, color: tone, fontWeight: 600 }} />}
    >
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid size={{ xs: 6 }}>
          <StatCard label="Custo previsto" value={brl(cost.planned)} />
        </Grid>
        <Grid size={{ xs: 6 }}>
          <StatCard label="Realizado" value={brl(cost.actual)} hint={cost.committed ? `+ ${brl(cost.committed)} comprometido` : undefined} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6 }}>
          <StatCard
            label={cost.variance > 0 ? 'Acima do previsto' : 'Ainda disponível'}
            value={brl(Math.abs(cost.variance))}
            hint={cost.variance > 0 ? `+${String(cost.variancePercent).replace('.', ',')}% sobre o previsto` : 'do custo previsto, sem contar o que falta comprar'}
            tone={cost.variance > 0 ? 'error' : 'success'}
          />
        </Grid>
        <Grid size={{ xs: 6 }}>
          <StatCard
            label="Margem projetada"
            value={`${String(cost.projectedMarginPercent).replace('.', ',')}%`}
            hint={`prevista ${String(cost.plannedMarginPercent).replace('.', ',')}% (${marginDelta > 0 ? '+' : ''}${String(marginDelta).replace('.', ',')} p.p.)`}
            tone={cost.projectedProfit < 0 ? 'error' : marginDelta < -3 ? 'warning' : 'success'}
          />
        </Grid>
      </Grid>

      <ProgressLine value={usedPercent} color={tone} label={`Do custo previsto, ${brl(cost.projected)} já realizados ou comprometidos`} height={8} />

      <Stack spacing={1.75} sx={{ mt: 2.5 }}>
        {cost.lines.map((l) => {
          const pct = l.planned > 0 ? (l.projected / l.planned) * 100 : l.projected > 0 ? 100 : 0
          const over = l.variance > 0.005
          return (
            <Box key={l.key}>
              <Stack direction="row" spacing={1} alignItems="baseline" sx={{ flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 180 }}>
                  {l.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  previsto {brl(l.planned)}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {brl(l.actual)}
                </Typography>
                {l.committed ? (
                  <Typography variant="caption" color="text.secondary">
                    + {brl(l.committed)} a chegar
                  </Typography>
                ) : null}
                <Typography variant="caption" sx={{ color: over ? OVER : OK, fontWeight: 700, minWidth: 110, textAlign: 'right' }}>
                  {l.planned || l.projected ? (over ? `+${brl(l.variance)} acima` : `${brl(-l.variance)} livres`) : '—'}
                </Typography>
              </Stack>
              <ProgressLine value={pct} color={over ? OVER : colors.brand} />
              {l.hint ? (
                <Typography variant="caption" color="text.secondary">
                  {l.hint}
                </Typography>
              ) : null}
            </Box>
          )
        })}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <Chip size="small" variant="outlined" label={`Horas na fábrica: ${fmtHours(cost.hours.actual)} de ${fmtHours(cost.hours.planned)} previstas`} />
        <Chip size="small" variant="outlined" label={`Receita do orçamento: ${brl(cost.revenue)}`} />
        <Chip size="small" variant="outlined" label={`Recebido: ${brl(cost.received)}`} />
        <Chip size="small" variant="outlined" label={`Lucro previsto ${brl(cost.plannedProfit)} → projetado ${brl(cost.projectedProfit)}`} />
      </Stack>

      {cost.projectedProfit < 0 ? (
        <Alert severity="error" sx={{ mt: 2 }}>
          Com os custos lançados até aqui o projeto já está no prejuízo. Revise compras e horas antes de fechar a entrega.
        </Alert>
      ) : null}
    </Panel>
  )
}
