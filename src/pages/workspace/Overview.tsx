import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Box, Button, Grid, Typography } from '@mui/material'
import { Stack } from '../../components/Stack'
import { KeyValue, Panel, ProgressLine, StatCard, StatusChip, UserAvatar } from '../../components/ui'
import { AssignmentIcon, CheckCircleIcon, ErrorOutlineIcon, TimerIcon, TrendingUpIcon } from '../../components/icons'
import { useWorkspace } from './useWorkspace'
import { StatusPill, DueChip } from './shared'
import { useAuth } from '../../auth/AuthContext'
import { useCollections } from '../../lib/store'
import { BUDGET_STATUS, OP_STATUS } from '../../domain/constants'
import { isDoneStatus, isOverdue, progressOf, trackedSeconds } from '../../domain/tasks'
import { brl, daysUntil, fmtDate, fmtDuration, fmtHours } from '../../lib/format'
import { colors } from '../../theme'
import { ProductionTimeline } from '../../components/ProductionTimeline'
import { ProjectCostPanel } from '../../components/ProjectCostPanel'
import type { CollectionName } from '../../types'

export function Overview() {
  const ws = useWorkspace()
  const { can } = useAuth()
  const navigate = useNavigate()
  const names = useMemo(() => {
    const n: CollectionName[] = ['clients']
    if (can('budgets')) n.push('budgets')
    if (can('production')) n.push('productionOrders', 'workCenters')
    if (can('cutplan')) n.push('cutPlans')
    if (can('financial')) n.push('receivables', 'payables')
    return n
  }, [can])
  const { data } = useCollections(names)

  const open = ws.tasks.filter((t) => !isDoneStatus(ws.statuses, t.status))
  const overdue = ws.tasks.filter((t) => !isDoneStatus(ws.statuses, t.status) && isOverdue(t))
  const progress = progressOf(ws.tasks, ws.statuses)
  const estimated = ws.tasks.filter((t) => !ws.tasks.some((c) => c.parentId === t.id)).reduce((s, t) => s + (t.estimateMinutes ?? 0), 0) / 60
  const tracked = trackedSeconds(ws.entries) / 3600
  const client = data.clients?.find((c) => c.id === ws.project.clientId)
  const budgets = (data.budgets ?? []).filter((b) => b.projectId === ws.project.id)
  const ops = (data.productionOrders ?? []).filter((o) => o.projectId === ws.project.id)
  const plans = (data.cutPlans ?? []).filter((c) => c.projectId === ws.project.id)
  const receivables = (data.receivables ?? []).filter((r) => r.projectId === ws.project.id)
  const payables = (data.payables ?? []).filter((r) => r.projectId === ws.project.id)

  const byStatus = ws.statuses.map((s) => ({ name: s.label, value: ws.tasks.filter((t) => t.status === s.id).length, color: s.color }))
  const upcoming = open
    .filter((t) => t.dueDate)
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
    .slice(0, 6)
  const dueIn = ws.project.dueDate ? daysUntil(ws.project.dueDate) : null

  const received = receivables.filter((r) => r.status === 'pago').reduce((s, r) => s + r.amount, 0)
  const expected = receivables.filter((r) => r.status !== 'cancelado').reduce((s, r) => s + r.amount, 0)
  const costs = payables.filter((p) => p.status !== 'cancelado').reduce((s, p) => s + p.amount, 0)

  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Progresso" value={`${progress}%`} icon={<TrendingUpIcon />} tone="brand" hint={`${ws.tasks.length - open.length} de ${ws.tasks.length} tarefas concluídas`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em aberto" value={open.length} icon={<AssignmentIcon />} hint={dueIn === null ? 'Sem prazo final' : dueIn < 0 ? `Projeto atrasado ${-dueIn} d` : `${dueIn} dias para a entrega`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Atrasadas" value={overdue.length} icon={overdue.length ? <ErrorOutlineIcon /> : <CheckCircleIcon />} tone={overdue.length ? 'error' : 'success'} hint={overdue.length ? 'Exigem replanejamento' : 'Tudo dentro do prazo'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Horas" value={`${fmtHours(tracked)}`} icon={<TimerIcon />} hint={`${fmtHours(estimated)} estimadas`} tone={estimated && tracked > estimated ? 'warning' : 'default'} />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Stack spacing={2.5}>
            {can('budgets') && can('purchases') ? <ProjectCostPanel projectId={ws.project.id} /> : null}
            <Panel title="Tarefas por status" subtitle="Distribuição atual do trabalho">
              <Box sx={{ height: 220 }}>
                <ResponsiveContainer>
                  <BarChart data={byStatus} layout="vertical" margin={{ left: 20, right: 20 }}>
                    <XAxis type="number" allowDecimals={false} hide />
                    <YAxis type="category" dataKey="name" width={120} tickLine={false} axisLine={false} />
                    <RTooltip cursor={{ fill: colors.subtle }} formatter={(v) => [`${v} tarefas`, '']} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
                      {byStatus.map((s) => (
                        <Cell key={s.name} fill={s.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </Panel>
            <Panel title="Próximas entregas" padded={false}>
              {upcoming.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
                  Nenhuma tarefa aberta com data de entrega.
                </Typography>
              ) : (
                upcoming.map((t) => (
                  <Stack key={t.id} direction="row" spacing={1.5} alignItems="center" onClick={() => ws.openTask(t.id)} sx={{ px: 2.5, py: 1.25, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { bgcolor: colors.subtle } }}>
                    <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }} noWrap>
                      {t.title}
                    </Typography>
                    <StatusPill task={t} statuses={ws.statuses} compact />
                    <DueChip task={t} />
                  </Stack>
                ))
              )}
            </Panel>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Stack spacing={2.5}>
            <Panel title="Dados do projeto">
              <KeyValue
                columns={2}
                items={[
                  { label: 'Cliente', value: client?.name },
                  { label: 'Responsável', value: ws.userMap.get(ws.project.managerId ?? '')?.name },
                  { label: 'Início', value: fmtDate(ws.project.startDate) },
                  { label: 'Entrega', value: fmtDate(ws.project.dueDate) },
                  { label: 'Valor do contrato', value: ws.project.contractValue ? brl(ws.project.contractValue) : '—' },
                  { label: 'Custo previsto', value: ws.project.estimatedCost ? brl(ws.project.estimatedCost) : '—' },
                  { label: 'Local da obra', value: ws.project.address },
                ]}
              />
              {ws.project.description ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2, whiteSpace: 'pre-wrap' }}>
                  {ws.project.description}
                </Typography>
              ) : null}
            </Panel>
            <Panel title="Equipe">
              <Stack spacing={1}>
                {[...new Set([ws.project.managerId, ...(ws.project.memberIds ?? [])].filter(Boolean) as string[])].map((id) => {
                  const u = ws.userMap.get(id)
                  if (!u) return null
                  const mine = open.filter((t) => t.assigneeIds?.includes(id)).length
                  return (
                    <Stack key={id} direction="row" spacing={1.25} alignItems="center">
                      <UserAvatar user={u} size={30} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {u.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {u.position || 'Equipe'}
                        </Typography>
                      </Box>
                      <Typography variant="caption" color="text.secondary">
                        {mine} abertas
                      </Typography>
                    </Stack>
                  )
                })}
              </Stack>
            </Panel>
            {can('production') ? (
              <Panel title="Produção do projeto" subtitle="Início e percurso das etapas na fábrica">
                {ops.length === 0 ? (
                  <Stack spacing={1}>
                    <Typography variant="body2" color="text.secondary">
                      Este projeto ainda não tem ordem de produção. Ela nasce ao aprovar o orçamento, ou você pode criá-la manualmente.
                    </Typography>
                    <Box>
                      <Button size="small" variant="outlined" onClick={() => navigate('/producao')}>
                        Abrir ordens de produção
                      </Button>
                    </Box>
                  </Stack>
                ) : (
                  <Stack spacing={2.5}>
                    {ops.map((o) => (
                      <ProductionTimeline key={o.id} order={o} compact workCenterName={(id) => (data.workCenters ?? []).find((w) => w.id === id)?.name ?? 'Setor'} />
                    ))}
                  </Stack>
                )}
              </Panel>
            ) : null}
            {(budgets.length || ops.length || receivables.length || plans.length) ? (
              <Panel title="Registros vinculados">
                <Stack spacing={1.25}>
                  {budgets.map((b) => (
                    <Stack key={b.id} direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => navigate(`/orcamentos?id=${b.id}`)}>
                      <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                        Orçamento {b.code}
                      </Typography>
                      <StatusChip options={BUDGET_STATUS} value={b.status} />
                    </Stack>
                  ))}
                  {ops.map((o) => (
                    <Stack key={o.id} direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => navigate(`/producao?id=${o.id}`)}>
                      <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                        {o.code} · {o.title}
                      </Typography>
                      <StatusChip options={OP_STATUS} value={o.status} />
                    </Stack>
                  ))}
                  {plans.map((c) => (
                    <Stack key={c.id} direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer' }} onClick={() => navigate(`/plano-de-corte?plano=${c.id}`)}>
                      <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                        Plano de corte {c.code} · {c.title}
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {brl(c.costs?.total)}
                      </Typography>
                    </Stack>
                  ))}
                  {receivables.length ? (
                    <Box>
                      <ProgressLine value={expected ? (received / expected) * 100 : 0} label={`Recebido ${brl(received)} de ${brl(expected)}`} />
                      {costs ? (
                        <Typography variant="caption" color="text.secondary">
                          Custos lançados: {brl(costs)} · Margem realizada: {brl(received - costs)}
                        </Typography>
                      ) : null}
                    </Box>
                  ) : null}
                </Stack>
              </Panel>
            ) : null}
            <Typography variant="caption" color="text.secondary">
              Tempo total registrado: {fmtDuration(trackedSeconds(ws.entries))}
            </Typography>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  )
}
