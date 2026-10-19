import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { Box, Grid, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import {
  AccountBalanceIcon,
  AssignmentIcon,
  ErrorOutlineIcon,
  FactoryIcon,
  Inventory2Icon,
  PaidIcon,
  TaskAltIcon,
  WarningAmberIcon,
  LocalShippingIcon,
} from '../components/icons'
import { EmptyState, Panel, StatCard, StatusChip, ProgressLine } from '../components/ui'
import { OnboardingGuide } from '../components/OnboardingGuide'
import { useAuth } from '../auth/AuthContext'
import { useCollections, useProjectStages, useDefaultTaskStatuses } from '../lib/store'
import { useAlerts } from '../domain/alerts'
import { INSTALL_KINDS, OP_STATUS, optLabel } from '../domain/constants'
import { isDoneStatus, isOverdue, statusesFor } from '../domain/tasks'
import { brl, brlShort, daysUntil, fmtDate, toDate } from '../lib/format'
import { colors, chartPalette } from '../theme'
import type { CollectionName } from '../types'
import { addMonths, format, isSameMonth, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function DashboardPage() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const stages = useProjectStages()
  const defaults = useDefaultTaskStatuses()
  const alerts = useAlerts()

  const names = useMemo(() => {
    const n: CollectionName[] = ['tasks', 'projects', 'clients']
    if (can('financial')) n.push('receivables', 'payables')
    if (can('production') || can('shopfloor')) n.push('productionOrders', 'workCenters')
    if (can('inventory')) n.push('materials')
    if (can('logistics')) n.push('installations')
    if (can('leads')) n.push('leads')
    if (can('quality')) n.push('qualityRecords')
    return n
  }, [can])
  const { data, maps } = useCollections(names)

  const today = new Date()
  const activeProjects = data.projects.filter((p) => !p.archived && !['entregue', 'garantia'].includes(p.stageId))
  const myOpen = data.tasks.filter((t) => t.assigneeIds?.includes(user?.id ?? '') && !t.completedAt && !isDoneStatus(statusesFor(maps.projects.get(t.projectId), defaults), t.status))
  const myLate = myOpen.filter(isOverdue)

  const ops = data.productionOrders ?? []
  const opsActive = ops.filter((o) => ['liberada', 'em_producao', 'qualidade'].includes(o.status))

  const recv = data.receivables ?? []
  const pay = data.payables ?? []
  const monthRecv = recv.filter((r) => r.status === 'pago' && r.paidDate && isSameMonth(toDate(r.paidDate)!, today)).reduce((s, r) => s + r.amount, 0)
  const toReceive = recv.filter((r) => r.status === 'pendente').reduce((s, r) => s + r.amount, 0)
  const lateRecv = recv.filter((r) => r.status === 'pendente' && (daysUntil(r.dueDate) ?? 0) < 0)
  const lowStock = (data.materials ?? []).filter((m) => m.active !== false && m.minStock > 0 && m.stock <= m.minStock)

  const cash = useMemo(() => {
    return Array.from({ length: 6 }, (_, i) => {
      const m = startOfMonth(addMonths(today, i - 5))
      const inc = recv.filter((r) => r.status === 'pago' && r.paidDate && isSameMonth(toDate(r.paidDate)!, m)).reduce((s, r) => s + r.amount, 0)
      const out = pay.filter((p) => p.status === 'pago' && p.paidDate && isSameMonth(toDate(p.paidDate)!, m)).reduce((s, p) => s + p.amount, 0)
      return { mes: format(m, 'MMM', { locale: ptBR }), Receitas: inc, Despesas: out }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recv, pay])

  const byStage = stages.map((s) => ({ name: s.label, value: activeProjects.concat(data.projects.filter((p) => p.stageId === 'entregue')).filter((p) => p.stageId === s.id).length, color: s.color }))
  const sectors = (data.workCenters ?? [])
    .filter((w) => w.active)
    .sort((a, b) => a.order - b.order)
    .map((w) => ({
      name: w.name.split(' ')[0],
      Em_fila: opsActive.reduce((s, o) => s + o.operations.filter((x) => x.workCenterId === w.id && x.status === 'pendente').length, 0),
      Em_andamento: opsActive.reduce((s, o) => s + o.operations.filter((x) => x.workCenterId === w.id && x.status === 'em_andamento').length, 0),
    }))

  const upcoming = (data.installations ?? [])
    .filter((i) => ['agendada', 'em_rota', 'em_andamento', 'reagendada'].includes(i.status) && (daysUntil(i.date) ?? -1) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5)

  const hour = today.getHours()
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite'

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="overline" color="primary">
          {format(today, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </Typography>
        <Typography variant="h2" sx={{ lineHeight: 1.15 }}>
          {greeting}, {user?.name.split(' ')[0]}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {myOpen.length
            ? `Você tem ${myOpen.length} ${myOpen.length === 1 ? 'tarefa em aberto' : 'tarefas em aberto'}${myLate.length ? `, ${myLate.length} atrasada${myLate.length > 1 ? 's' : ''}` : ''}.`
            : 'Nenhuma tarefa pendente atribuída a você.'}
        </Typography>
      </Box>

      <OnboardingGuide />

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 6, md: 4, xl: 2 }}>
          <StatCard label="Projetos ativos" value={activeProjects.length} icon={<AssignmentIcon />} onClick={() => navigate('/projetos')} />
        </Grid>
        <Grid size={{ xs: 6, md: 4, xl: 2 }}>
          <StatCard label="Minhas tarefas" value={myOpen.length} icon={<TaskAltIcon />} tone={myLate.length ? 'warning' : 'default'} hint={myLate.length ? `${myLate.length} atrasadas` : 'Em dia'} onClick={() => navigate('/tarefas')} />
        </Grid>
        {can('production') ? (
          <Grid size={{ xs: 6, md: 4, xl: 2 }}>
            <StatCard label="OPs em andamento" value={opsActive.length} icon={<FactoryIcon />} tone="brand" onClick={() => navigate('/producao')} />
          </Grid>
        ) : null}
        {can('financial') ? (
          <>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}>
              <StatCard label="Recebido no mês" value={brlShort(monthRecv)} icon={<PaidIcon />} tone="success" onClick={() => navigate('/financeiro')} />
            </Grid>
            <Grid size={{ xs: 6, md: 4, xl: 2 }}>
              <StatCard label="A receber" value={brlShort(toReceive)} icon={<AccountBalanceIcon />} hint={lateRecv.length ? `${lateRecv.length} em atraso` : undefined} tone={lateRecv.length ? 'warning' : 'default'} onClick={() => navigate('/financeiro')} />
            </Grid>
          </>
        ) : null}
        {can('inventory') ? (
          <Grid size={{ xs: 6, md: 4, xl: 2 }}>
            <StatCard label="Abaixo do mínimo" value={lowStock.length} icon={<Inventory2Icon />} tone={lowStock.length ? 'error' : 'success'} onClick={() => navigate('/estoque')} />
          </Grid>
        ) : null}
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Stack spacing={2.5}>
            {can('financial') ? (
              <Panel title="Receitas x despesas" subtitle="Valores efetivamente pagos e recebidos nos últimos 6 meses">
                <Box sx={{ height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={cash} barGap={4}>
                      <CartesianGrid vertical={false} stroke={colors.border} />
                      <XAxis dataKey="mes" tickLine={false} axisLine={false} style={{ textTransform: 'capitalize' }} />
                      <YAxis tickFormatter={(v) => brlShort(v as number)} tickLine={false} axisLine={false} width={84} />
                      <RTooltip formatter={(v) => brl(Number(v))} cursor={{ fill: colors.subtle }} />
                      <Legend />
                      <Bar dataKey="Receitas" fill={colors.brand} radius={[6, 6, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="Despesas" fill={colors.oak} radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </Box>
              </Panel>
            ) : null}
            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Panel title="Projetos por etapa">
                  <Box sx={{ height: 280 }}>
                    <ResponsiveContainer>
                      <BarChart data={byStage} layout="vertical" margin={{ left: 10, right: 16 }}>
                        <XAxis type="number" allowDecimals={false} hide />
                        <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} />
                        <RTooltip cursor={{ fill: colors.subtle }} formatter={(v) => [`${v} projetos`, '']} />
                        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={16}>
                          {byStage.map((s, i) => (
                            <Cell key={s.name} fill={s.color ?? chartPalette[i % chartPalette.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Panel>
              </Grid>
              {can('production') || can('shopfloor') ? (
                <Grid size={{ xs: 12, md: 6 }}>
                  <Panel title="Fila de produção por setor" subtitle="Operações pendentes e em andamento">
                    <Box sx={{ height: 280 }}>
                      <ResponsiveContainer>
                        <BarChart data={sectors}>
                          <CartesianGrid vertical={false} stroke={colors.border} />
                          <XAxis dataKey="name" tickLine={false} axisLine={false} />
                          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
                          <RTooltip cursor={{ fill: colors.subtle }} />
                          <Legend />
                          <Bar dataKey="Em_fila" name="Em fila" stackId="a" fill={colors.borderStrong} />
                          <Bar dataKey="Em_andamento" name="Em andamento" stackId="a" fill={colors.brand} radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </Box>
                  </Panel>
                </Grid>
              ) : null}
            </Grid>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 4 }}>
          <Stack spacing={2.5}>
            <Panel title="Alertas" padded={false}>
              {alerts.length === 0 ? (
                <EmptyState title="Tudo em dia" description="Nenhum alerta operacional no momento." />
              ) : (
                alerts.map((a) => (
                  <Stack
                    key={a.id}
                    direction="row"
                    spacing={1.25}
                    onClick={() => navigate(a.path)}
                    sx={{ px: 2.5, py: 1.4, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { bgcolor: colors.subtle } }}
                  >
                    <Box sx={{ color: a.severity === 'error' ? colors.error : colors.warning, pt: 0.2 }}>
                      {a.severity === 'error' ? <ErrorOutlineIcon fontSize="small" /> : <WarningAmberIcon fontSize="small" />}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2">{a.title}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {a.detail}
                      </Typography>
                    </Box>
                  </Stack>
                ))
              )}
            </Panel>

            {can('logistics') ? (
              <Panel title="Próximas entregas e instalações" padded={false}>
                {upcoming.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
                    Nada agendado.
                  </Typography>
                ) : (
                  upcoming.map((i) => (
                    <Stack key={i.id} direction="row" spacing={1.5} alignItems="center" onClick={() => navigate(`/entregas?id=${i.id}`)} sx={{ px: 2.5, py: 1.25, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { bgcolor: colors.subtle } }}>
                      <LocalShippingIcon sx={{ color: colors.brand }} fontSize="small" />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                          {maps.projects.get(i.projectId ?? '')?.name ?? optLabel(INSTALL_KINDS, i.kind)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {optLabel(INSTALL_KINDS, i.kind)} · {fmtDate(i.date, 'dd/MM')} {i.time}
                        </Typography>
                      </Box>
                    </Stack>
                  ))
                )}
              </Panel>
            ) : null}

            {can('production') && opsActive.length ? (
              <Panel title="Ordens em produção" padded={false}>
                {opsActive.slice(0, 5).map((o) => {
                  const total = o.operations.length || 1
                  const done = o.operations.filter((x) => x.status === 'concluida').length
                  return (
                    <Box key={o.id} onClick={() => navigate(`/producao?id=${o.id}`)} sx={{ px: 2.5, py: 1.25, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { bgcolor: colors.subtle } }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }} noWrap>
                          {o.code} · {o.title}
                        </Typography>
                        <StatusChip options={OP_STATUS} value={o.status} />
                      </Stack>
                      <ProgressLine value={(done / total) * 100} height={5} />
                    </Box>
                  )
                })}
              </Panel>
            ) : null}
          </Stack>
        </Grid>
      </Grid>
    </Box>
  )
}
