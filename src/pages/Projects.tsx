import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Box, Button, Grid, IconButton, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, AssignmentIcon, CheckCircleIcon, ErrorOutlineIcon, PaidIcon, ViewKanbanIcon, ViewListIcon } from '../components/icons'
import { AvatarStack, DataTable, Dot, EmptyState, LoadingState, PageHeader, ProgressLine, SearchField, StatCard, StatusChip, type Column } from '../components/ui'
import { ProjectDialog } from '../components/ProjectDialog'
import { ProjectCard, type ProjectCardData } from '../components/ProjectCard'
import { useAuth } from '../auth/AuthContext'
import { useCollections, updateDoc, useProjectStages, useDefaultTaskStatuses } from '../lib/store'
import { ENVIRONMENTS, PROJECT_PRIORITIES } from '../domain/constants'
import { isDoneStatus, isOverdue, progressOf, statusesFor } from '../domain/tasks'
import { brl, brlShort, daysUntil, fmtDate, matches } from '../lib/format'
import { colors } from '../theme'
import type { CollectionName, Project } from '../types'

export function ProjectsPage() {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const stages = useProjectStages()
  const defaults = useDefaultTaskStatuses()
  const names = useMemo<CollectionName[]>(() => {
    const n: CollectionName[] = ['projects', 'clients', 'users', 'tasks', 'taskComments', 'files']
    if (can('production')) n.push('productionOrders', 'workCenters')
    return n
  }, [can])
  const { data, maps, loading } = useCollections(names)
  const [view, setView] = useState<'quadro' | 'lista'>('quadro')
  const [query, setQuery] = useState('')
  const [manager, setManager] = useState('')
  const [priority, setPriority] = useState('')
  const [environment, setEnvironment] = useState('')
  const [showArchived, setShowArchived] = useState(false)
  const [dialog, setDialog] = useState<{ project: Project | null; stageId?: string } | null>(params.get('novo') === '1' ? { project: null } : null)

  const tasks = data.tasks
  const comments = data.taskComments
  const files = data.files
  const tasksByProject = useMemo(() => {
    const m = new Map<string, typeof tasks>()
    for (const t of tasks) (m.get(t.projectId) ?? m.set(t.projectId, []).get(t.projectId)!).push(t)
    return m
  }, [tasks])
  const commentsBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of comments) if (c.kind !== 'system') m.set(c.projectId, (m.get(c.projectId) ?? 0) + 1)
    return m
  }, [comments])
  const filesBy = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of files) if (f.projectId && f.refType !== 'avatar') m.set(f.projectId, (m.get(f.projectId) ?? 0) + 1)
    return m
  }, [files])
  const ops = data.productionOrders ?? []
  const centers = data.workCenters ?? []

  const cardOf = (p: Project): ProjectCardData => {
    const list = tasksByProject.get(p.id) ?? []
    const statuses = statusesFor(p, defaults)
    const done = list.filter((t) => isDoneStatus(statuses, t.status)).length
    const stage = stages.find((s) => s.id === p.stageId)
    // ordem de produção mais relevante do projeto (a que está em andamento)
    const op = ops
      .filter((o) => o.projectId === p.id && o.status !== 'cancelada')
      .sort((a, b) => Number(['em_producao', 'liberada'].includes(b.status)) - Number(['em_producao', 'liberada'].includes(a.status)))[0]
    let production: ProjectCardData['production'] = null
    if (op) {
      const sorted = [...op.operations].sort((a, b) => a.order - b.order)
      const current = sorted.find((x) => x.status !== 'concluida')
      production = {
        code: op.code ?? '',
        current: current ? (centers.find((c) => c.id === current.workCenterId)?.name ?? current.name) : 'Concluída',
        done: sorted.filter((x) => x.status === 'concluida').length,
        total: sorted.length,
      }
    }
    const memberIds = [...new Set(p.memberIds ?? [])]
    return {
      project: p,
      clientName: maps.clients.get(p.clientId ?? '')?.name,
      manager: maps.users.get(p.managerId ?? ''),
      team: memberIds.map((id) => maps.users.get(id)).filter(Boolean) as ProjectCardData['team'],
      stageColor: stage?.color ?? colors.textMuted,
      progress: progressOf(list, statuses),
      openTasks: list.length - done,
      doneTasks: done,
      overdueTasks: list.filter((t) => !isDoneStatus(statuses, t.status) && isOverdue(t)).length,
      totalTasks: list.length,
      comments: commentsBy.get(p.id) ?? 0,
      attachments: filesBy.get(p.id) ?? 0,
      production,
    }
  }

  const visible = data.projects.filter((p) => {
    if (!showArchived && p.archived) return false
    if (manager && p.managerId !== manager) return false
    if (priority && p.priority !== priority) return false
    if (environment && p.environment !== environment) return false
    return matches([p.name, p.code, maps.clients.get(p.clientId ?? '')?.name, p.address, p.tags?.join(' ')], query)
  })

  const active = data.projects.filter((p) => !p.archived && !['entregue', 'garantia'].includes(p.stageId))
  const late = active.filter((p) => p.dueDate && (daysUntil(p.dueDate) ?? 0) < 0)

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return
    const stageId = r.destination.droppableId
    void updateDoc('projects', r.draggableId, { stageId, stageChangedAt: new Date().toISOString(), ...(stageId === 'entregue' ? { completedAt: new Date().toISOString() } : {}) })
  }

  const closeDialog = () => {
    setDialog(null)
    // não sobrescreve uma navegação já feita (ex.: abrir o projeto recém-criado)
    if (params.get('novo') && window.location.pathname === '/projetos') {
      params.delete('novo')
      params.delete('cliente')
      setParams(params, { replace: true })
    }
  }

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Projeto',
      sort: (p) => p.name,
      render: (p) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {p.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {p.code} · {maps.clients.get(p.clientId ?? '')?.name ?? 'Sem cliente'}
          </Typography>
        </Box>
      ),
    },
    {
      key: 'stage',
      header: 'Etapa',
      sort: (p) => stages.findIndex((s) => s.id === p.stageId),
      render: (p) => {
        const s = stages.find((x) => x.id === p.stageId)
        return (
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Dot color={s?.color ?? colors.textMuted} />
            <span>{s?.label ?? p.stageId}</span>
          </Stack>
        )
      },
    },
    { key: 'priority', header: 'Prioridade', hideBelow: 'md', render: (p) => <StatusChip options={PROJECT_PRIORITIES} value={p.priority} /> },
    { key: 'progress', header: 'Progresso', sort: (p) => cardOf(p).progress, width: 170, render: (p) => <ProgressLine value={cardOf(p).progress} label={`${cardOf(p).openTasks} abertas`} /> },
    {
      key: 'team',
      header: 'Equipe',
      hideBelow: 'lg',
      render: (p) => <AvatarStack users={[p.managerId, ...(p.memberIds ?? [])].filter((x, i, a) => x && a.indexOf(x) === i).map((id) => maps.users.get(id as string))} size={26} />,
    },
    {
      key: 'due',
      header: 'Entrega',
      sort: (p) => p.dueDate,
      render: (p) => {
        const d = p.dueDate ? daysUntil(p.dueDate) : null
        return <Box sx={{ color: d !== null && d < 0 && !['entregue', 'garantia'].includes(p.stageId) ? 'error.main' : 'text.primary', fontWeight: d !== null && d < 0 ? 700 : 400 }}>{fmtDate(p.dueDate)}</Box>
      },
    },
    { key: 'value', header: 'Valor', align: 'right', hideBelow: 'md', sort: (p) => p.contractValue, render: (p) => (p.contractValue ? brl(p.contractValue) : '—') },
  ]

  if (loading && !data.projects.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Projetos"
        subtitle="Portfólio de obras e lotes de produção. Abra um projeto para gerenciar listas, quadro, cronograma e carga de trabalho."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ project: null })}>
            Novo projeto
          </Button>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Projetos ativos" value={active.length} icon={<AssignmentIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em carteira" value={brlShort(active.reduce((s, p) => s + (p.contractValue ?? 0), 0))} icon={<PaidIcon />} tone="brand" hint="Contratos em andamento" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Atrasados" value={late.length} icon={<ErrorOutlineIcon />} tone={late.length ? 'error' : 'success'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Entregues" value={data.projects.filter((p) => p.stageId === 'entregue').length} icon={<CheckCircleIcon />} tone="success" />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar projeto, cliente, código…" />
        <TextField select label="Responsável" value={manager} onChange={(e) => setManager(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 190 } }}>
          <MenuItem value="">Todos</MenuItem>
          {data.users
            .filter((u) => u.active !== false)
            .map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {u.name}
              </MenuItem>
            ))}
        </TextField>
        <TextField select label="Ambiente" value={environment} onChange={(e) => setEnvironment(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 190 } }}>
          <MenuItem value="">Todos</MenuItem>
          {ENVIRONMENTS.map((e) => (
            <MenuItem key={e.value} value={e.value}>
              {e.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 160 } }}>
          <MenuItem value="">Todas</MenuItem>
          {PROJECT_PRIORITIES.map((p) => (
            <MenuItem key={p.value} value={p.value}>
              {p.label}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="text" color="inherit" onClick={() => setShowArchived((s) => !s)} sx={{ color: 'text.secondary' }}>
          {showArchived ? 'Ocultar arquivados' : 'Mostrar arquivados'}
        </Button>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="quadro">
            <ViewKanbanIcon fontSize="small" sx={{ mr: 0.75 }} /> Quadro
          </ToggleButton>
          <ToggleButton value="lista">
            <ViewListIcon fontSize="small" sx={{ mr: 0.75 }} /> Lista
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {data.projects.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState
            icon={<AssignmentIcon />}
            title="Nenhum projeto cadastrado"
            description="Crie seu primeiro projeto a partir de um modelo de marcenaria: listas, tarefas, prazos e estimativas já nascem prontos."
            action={
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ project: null })}>
                Novo projeto
              </Button>
            }
          />
        </Paper>
      ) : view === 'quadro' ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
            {stages.map((stage) => {
              const items = visible.filter((p) => p.stageId === stage.id)
              const total = items.reduce((s, p) => s + (p.contractValue ?? 0), 0)
              return (
                <Box key={stage.id} sx={{ width: 318, flexShrink: 0 }}>
                  <Box sx={{ px: 1.25, py: 1, borderRadius: 2.5, bgcolor: alpha(stage.color, 0.1), mb: 1, borderTop: `3px solid ${stage.color}` }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle2" sx={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.74rem' }} noWrap>
                        {stage.label}
                      </Typography>
                      <Typography variant="caption" sx={{ fontWeight: 800, color: stage.color, bgcolor: '#fff', borderRadius: 1, px: 0.75 }}>
                        {items.length}
                      </Typography>
                      <Tooltip title={`Novo projeto em “${stage.label}”`}>
                        <IconButton size="small" onClick={() => setDialog({ project: null, stageId: stage.id })} aria-label="Adicionar projeto" sx={{ p: 0.25 }}>
                          <AddIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                    {total ? (
                      <Typography variant="caption" color="text.secondary">
                        {brl(total)}
                      </Typography>
                    ) : null}
                  </Box>
                  <Droppable droppableId={stage.id}>
                    {(p, snap) => (
                      <Box ref={p.innerRef} {...p.droppableProps} sx={{ minHeight: 90, p: 0.5, borderRadius: 2, bgcolor: snap.isDraggingOver ? alpha(colors.brand, 0.05) : 'transparent' }}>
                        {items.map((project, i) => (
                          <Draggable key={project.id} draggableId={project.id} index={i}>
                            {(dp, ds) => (
                              <Box ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} sx={{ mb: 1.25 }}>
                                <ProjectCard data={cardOf(project)} dragging={ds.isDragging} onClick={() => navigate(`/projetos/${project.id}`)} />
                              </Box>
                            )}
                          </Draggable>
                        ))}
                        {p.placeholder}
                      </Box>
                    )}
                  </Droppable>
                </Box>
              )
            })}
          </Box>
        </DragDropContext>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <DataTable rows={visible} columns={columns} rowKey={(p) => p.id} onRowClick={(p) => navigate(`/projetos/${p.id}`)} initialSort={{ key: 'due', dir: 'asc' }} />
        </Paper>
      )}

      {dialog ? <ProjectDialog open project={dialog.project} initialStageId={dialog.stageId} onClose={closeDialog} /> : null}
    </Box>
  )
}
