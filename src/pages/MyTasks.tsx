import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, Chip, IconButton, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { CheckCircleIcon, PlayArrowIcon, StopIcon, TaskAltIcon, FlagIcon } from '../components/icons'
import { Dot, EmptyState, LoadingState, PageHeader, SearchField, StatCard, UserAvatar } from '../components/ui'
import { Grid } from '@mui/material'
import { useAuth } from '../auth/AuthContext'
import { useCollections, updateDoc, useDefaultTaskStatuses } from '../lib/store'
import { useTimer } from '../domain/timer'
import { doneStatus, firstStatus, isDoneStatus, isOverdue, statusesFor } from '../domain/tasks'
import { TASK_PRIORITIES, optColor } from '../domain/constants'
import { daysUntil, fmtDate, fmtRelative, matches } from '../lib/format'
import { colors } from '../theme'
import type { Task } from '../types'

const BUCKETS = [
  { id: 'late', label: 'Atrasadas', color: '#c23b3b' },
  { id: 'today', label: 'Hoje', color: '#b7791f' },
  { id: 'week', label: 'Próximos 7 dias', color: '#2f6f9f' },
  { id: 'later', label: 'Mais adiante', color: '#7d838c' },
  { id: 'none', label: 'Sem data', color: '#b7b2ac' },
] as const

export function MyTasksPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const defaults = useDefaultTaskStatuses()
  const { data, maps, loading } = useCollections(['tasks', 'projects', 'taskComments', 'users'] as const)
  const { running, start, stop } = useTimer()
  const [showDone, setShowDone] = useState(false)
  const [tab, setTab] = useState<'mine' | 'delegated' | 'mentions'>('mine')
  const [groupBy, setGroupBy] = useState<'prazo' | 'projeto' | 'prioridade'>('prazo')
  const [projectId, setProjectId] = useState('')
  const [query, setQuery] = useState('')

  const mine = useMemo(() => {
    const me = user?.id ?? ''
    const base =
      tab === 'delegated'
        ? data.tasks.filter((t) => t.createdBy === me && (t.assigneeIds?.length ?? 0) > 0 && !t.assigneeIds.includes(me))
        : data.tasks.filter((t) => t.assigneeIds?.includes(me))
    return base.filter((t) => (!projectId || t.projectId === projectId) && matches([t.title, maps.projects.get(t.projectId)?.name], query))
  }, [data.tasks, user?.id, tab, projectId, query, maps.projects])
  const mentions = useMemo(
    () =>
      data.taskComments
        .filter((c) => c.kind !== 'system' && c.mentions?.includes(user?.id ?? '') && (!projectId || c.projectId === projectId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.taskComments, user?.id, projectId],
  )
  const statusesOf = (t: Task) => statusesFor(maps.projects.get(t.projectId), defaults)
  const open = mine.filter((t) => !t.completedAt && !isDoneStatus(statusesOf(t), t.status))
  const done = mine.filter((t) => t.completedAt || isDoneStatus(statusesOf(t), t.status))

  const bucketOf = (t: Task) => {
    if (!t.dueDate) return 'none'
    const d = daysUntil(t.dueDate) ?? 0
    return d < 0 ? 'late' : d === 0 ? 'today' : d <= 7 ? 'week' : 'later'
  }

  const toggle = (t: Task) => {
    const st = statusesOf(t)
    const finished = isDoneStatus(st, t.status)
    void updateDoc('tasks', t.id, finished ? { status: firstStatus(st).id, completedAt: null } : { status: doneStatus(st).id, completedAt: new Date().toISOString() })
  }

  const PRIORITY_GROUPS = [
    { id: 'urgente', label: 'Urgente', color: '#c23b3b' },
    { id: 'alta', label: 'Alta', color: '#b7791f' },
    { id: 'normal', label: 'Normal', color: '#2f6f9f' },
    { id: 'baixa', label: 'Baixa', color: '#7d838c' },
  ]
  const byDue = (a: Task, c: Task) => (a.dueDate ?? '9').localeCompare(c.dueDate ?? '9')
  const groups: { id: string; label: string; color: string; items: Task[] }[] =
    groupBy === 'prazo'
      ? BUCKETS.map((b) => ({ id: b.id, label: b.label, color: b.color, items: open.filter((t) => bucketOf(t) === b.id).sort(byDue) }))
      : groupBy === 'prioridade'
        ? PRIORITY_GROUPS.map((g) => ({ ...g, items: open.filter((t) => (t.priority ?? 'normal') === g.id).sort(byDue) }))
        : [...new Set(open.map((t) => t.projectId))].map((pid) => ({
            id: pid,
            label: maps.projects.get(pid)?.name ?? 'Sem projeto',
            color: maps.projects.get(pid)?.color ?? colors.brand,
            items: open.filter((t) => t.projectId === pid).sort(byDue),
          }))

  if (loading && !data.tasks.length) return <LoadingState />

  const row = (t: Task) => {
    const project = maps.projects.get(t.projectId)
    const status = statusesOf(t).find((s) => s.id === t.status)
    const finished = Boolean(t.completedAt) || isDoneStatus(statusesOf(t), t.status)
    const tracking = running?.taskId === t.id
    return (
      <Stack
        key={t.id}
        direction="row"
        spacing={1.5}
        alignItems="center"
        onClick={() => navigate(`/projetos/${t.projectId}?tarefa=${t.id}`)}
        sx={{ px: 2, py: 1.1, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { bgcolor: alpha(colors.brand, 0.035) } }}
      >
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation()
            toggle(t)
          }}
          sx={{ color: finished ? colors.success : colors.textMuted, p: 0.25 }}
          aria-label="Alternar conclusão"
        >
          <CheckCircleIcon sx={{ fontSize: 22 }} />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600, textDecoration: finished ? 'line-through' : 'none', color: finished ? 'text.secondary' : 'text.primary' }}>
            {t.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {project?.name ?? '—'}
          </Typography>
        </Box>
        <Chip size="small" label={status?.label} icon={<Dot color={status?.color ?? '#999'} size={8} />} sx={{ bgcolor: alpha(status?.color ?? '#999', 0.12), color: status?.color, '& .MuiChip-icon': { ml: 0.75 }, display: { xs: 'none', sm: 'inline-flex' } }} />
        <FlagIcon sx={{ fontSize: 18, color: t.priority && t.priority !== 'normal' ? optColor(TASK_PRIORITIES, t.priority) : colors.border }} />
        <Typography variant="body2" sx={{ width: 74, textAlign: 'right', fontWeight: isOverdue(t) ? 700 : 500, color: isOverdue(t) ? 'error.main' : 'text.secondary' }}>
          {t.dueDate ? fmtDate(t.dueDate, 'dd MMM') : '—'}
        </Typography>
        {!finished ? (
          <Tooltip title={tracking ? 'Parar cronômetro' : 'Iniciar cronômetro'}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation()
                if (tracking) void stop()
                else void start(t.id, t.projectId)
              }}
              sx={{ color: tracking ? colors.brand : colors.textMuted }}
              aria-label="Cronômetro"
            >
              {tracking ? <StopIcon /> : <PlayArrowIcon />}
            </IconButton>
          </Tooltip>
        ) : null}
      </Stack>
    )
  }

  return (
    <Box>
      <PageHeader title="Meu trabalho" subtitle="Tudo o que está com você em todos os projetos — atribuído, delegado e menções." />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em aberto" value={open.length} icon={<TaskAltIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Atrasadas" value={open.filter((t) => bucketOf(t) === 'late').length} tone="error" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Para hoje" value={open.filter((t) => bucketOf(t) === 'today').length} tone="warning" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Concluídas" value={done.length} tone="success" />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={tab} onChange={(_, v) => v && setTab(v)}>
          <ToggleButton value="mine">Atribuídas a mim</ToggleButton>
          <ToggleButton value="delegated">Delegadas por mim</ToggleButton>
          <ToggleButton value="mentions">Menções{mentions.length ? ` (${mentions.length})` : ''}</ToggleButton>
        </ToggleButtonGroup>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar tarefa ou projeto…" />
        <TextField select label="Projeto" value={projectId} onChange={(e) => setProjectId(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 240 } }}>
          <MenuItem value="">Todos</MenuItem>
          {data.projects
            .filter((p) => !p.archived)
            .map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
        </TextField>
        {tab !== 'mentions' ? (
          <ToggleButtonGroup size="small" exclusive value={groupBy} onChange={(_, v) => v && setGroupBy(v)}>
            <ToggleButton value="prazo">Por prazo</ToggleButton>
            <ToggleButton value="projeto">Por projeto</ToggleButton>
            <ToggleButton value="prioridade">Por prioridade</ToggleButton>
          </ToggleButtonGroup>
        ) : null}
      </Stack>

      {tab === 'mentions' ? (
        mentions.length === 0 ? (
          <Paper variant="outlined" sx={{ borderRadius: 3 }}>
            <EmptyState icon={<TaskAltIcon />} title="Nenhuma menção" description="Quando alguém mencionar você com @ em um comentário, aparece aqui." />
          </Paper>
        ) : (
          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
            {mentions.slice(0, 60).map((c) => (
              <Stack
                key={c.id}
                direction="row"
                spacing={1.5}
                alignItems="flex-start"
                onClick={() => navigate(`/projetos/${c.projectId}?tarefa=${c.taskId}`)}
                sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { bgcolor: alpha(colors.brand, 0.035) } }}
              >
                <UserAvatar user={maps.users.get(c.authorId) ?? { id: c.authorId, name: c.authorName }} size={30} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2">
                    <strong>{c.authorName}</strong> em <span style={{ color: colors.brand, fontWeight: 600 }}>{data.tasks.find((t) => t.id === c.taskId)?.title ?? 'tarefa'}</span>
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {c.body}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {maps.projects.get(c.projectId)?.name ?? ''} · {fmtRelative(c.createdAt)}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Paper>
        )
      ) : open.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState
            icon={<TaskAltIcon />}
            title="Nenhuma tarefa em aberto"
            description={tab === 'delegated' ? 'As tarefas que você criar e atribuir a outras pessoas aparecem aqui.' : 'Quando alguém atribuir tarefas a você, elas aparecerão aqui.'}
          />
        </Paper>
      ) : (
        <Stack spacing={2}>
          {groups.map((b) => {
            const items = b.items
            if (!items.length) return null
            return (
              <Paper key={b.id} variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 2, py: 1, bgcolor: alpha(b.color, 0.07), borderBottom: `1px solid ${colors.border}` }}>
                  <Dot color={b.color} size={10} />
                  <Typography variant="subtitle2">{b.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {items.length}
                  </Typography>
                </Stack>
                {items.map(row)}
              </Paper>
            )
          })}
        </Stack>
      )}

      {done.length ? (
        <Box sx={{ mt: 2 }}>
          <Button color="inherit" onClick={() => setShowDone((s) => !s)} sx={{ color: 'text.secondary' }}>
            {showDone ? 'Ocultar concluídas' : `Mostrar ${done.length} concluídas`}
          </Button>
          {showDone ? (
            <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', mt: 1 }}>
              {done.slice(0, 50).map(row)}
            </Paper>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}
