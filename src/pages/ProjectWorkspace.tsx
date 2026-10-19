import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from '../components/Stack'
import {
  AddIcon,
  ArrowBackIcon,
  CalendarMonthIcon,
  DeleteIcon,
  EditIcon,
  MoreHorizIcon,
  SettingsIcon,
  TableChartIcon,
  TimelineIcon,
  ViewKanbanIcon,
  ViewListIcon,
  DashboardIcon,
  FolderIcon,
  BarChartIcon,
  CloseIcon,
  BoltIcon,
  HistoryIcon,
  TimerIcon,
  ArticleIcon,
  SendIcon,
} from '../components/icons'
import { AvatarStack, Dot, EmptyState, LoadingState, ProgressLine, StatusChip } from '../components/ui'
import { ProjectDialog } from '../components/ProjectDialog'
import { ClientUpdateDialog } from '../components/ClientUpdateDialog'
import { FileBrowser } from '../components/FileBrowser'
import { useConfirm, useToast } from '../components/feedback'
import { useCollection, useCompany, useProjectStages, removeDoc, updateDoc } from '../lib/store'
import { PROJECT_PRIORITIES, LABEL_COLORS } from '../domain/constants'
import { progressOf } from '../domain/tasks'
import { daysUntil, fmtDate, uid } from '../lib/format'
import { colors } from '../theme'
import { WorkspaceProvider, useWorkspace } from './workspace/useWorkspace'
import { FilterBar } from './workspace/shared'
import { ListView, GroupBySelect } from './workspace/ListView'
import { BoardView } from './workspace/BoardView'
import { CalendarView } from './workspace/CalendarView'
import { GanttView } from './workspace/GanttView'
import { TableView } from './workspace/TableView'
import { WorkloadView } from './workspace/WorkloadView'
import { Overview } from './workspace/Overview'
import { ActivityView } from './workspace/ActivityView'
import { TimeView } from './workspace/TimeView'
import { DocsView } from './workspace/DocsView'
import { BulkBar } from './workspace/BulkBar'
import { SavedViews } from './workspace/SavedViews'
import { AutomationsDialog } from './workspace/AutomationsDialog'
import { TaskDrawer } from './workspace/TaskDrawer'
import type { CustomFieldDef, Project, TaskStatusDef } from '../types'

const VIEWS = [
  { id: 'visao', label: 'Visão geral', icon: <DashboardIcon fontSize="small" /> },
  { id: 'lista', label: 'Lista', icon: <ViewListIcon fontSize="small" /> },
  { id: 'quadro', label: 'Quadro', icon: <ViewKanbanIcon fontSize="small" /> },
  { id: 'calendario', label: 'Calendário', icon: <CalendarMonthIcon fontSize="small" /> },
  { id: 'cronograma', label: 'Cronograma', icon: <TimelineIcon fontSize="small" /> },
  { id: 'tabela', label: 'Tabela', icon: <TableChartIcon fontSize="small" /> },
  { id: 'carga', label: 'Carga de trabalho', icon: <BarChartIcon fontSize="small" /> },
  { id: 'tempo', label: 'Tempo', icon: <TimerIcon fontSize="small" /> },
  { id: 'docs', label: 'Documentos', icon: <ArticleIcon fontSize="small" /> },
  { id: 'atividade', label: 'Atividade', icon: <HistoryIcon fontSize="small" /> },
  { id: 'arquivos', label: 'Arquivos', icon: <FolderIcon fontSize="small" /> },
] as const
type ViewId = (typeof VIEWS)[number]['id']

export function ProjectWorkspacePage() {
  const { projectId } = useParams()
  const projects = useCollection('projects')
  const project = projects.byId.get(projectId ?? '')
  const [params] = useSearchParams()

  if (projects.loading) return <LoadingState />
  if (!project)
    return <EmptyState title="Projeto não encontrado" description="O projeto pode ter sido excluído ou você não tem acesso a ele." />

  return (
    <WorkspaceProvider project={project} initialTaskId={params.get('tarefa')}>
      <Workspace project={project} />
    </WorkspaceProvider>
  )
}

function Workspace({ project }: { project: Project }) {
  const ws = useWorkspace()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const stages = useProjectStages()
  const clients = useCollection('clients')
  const [params, setParams] = useSearchParams()
  const view = (params.get('vista') as ViewId) ?? 'lista'
  const [editOpen, setEditOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [listsOpen, setListsOpen] = useState(false)
  const [autoOpen, setAutoOpen] = useState(false)
  const [clientOpen, setClientOpen] = useState(false)
  const company = useCompany()
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const [stageMenu, setStageMenu] = useState<HTMLElement | null>(null)

  const stage = stages.find((s) => s.id === project.stageId)
  const client = clients.byId.get(project.clientId ?? '')
  const progress = useMemo(() => progressOf(ws.tasks, ws.statuses), [ws.tasks, ws.statuses])
  const days = project.dueDate ? daysUntil(project.dueDate) : null
  const team = [project.managerId, ...(project.memberIds ?? [])].filter((x, i, a) => x && a.indexOf(x) === i).map((id) => ws.userMap.get(id as string))

  const setView = (v: ViewId) => {
    params.set('vista', v)
    setParams(params, { replace: true })
  }

  const showToolbar = ['lista', 'quadro', 'calendario', 'cronograma', 'tabela'].includes(view)

  // atalhos: C cria tarefa · / foca a busca · Esc limpa a seleção
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.closest('[role=dialog]'))) return
      if (e.key === 'Escape' && ws.selected.length) ws.clearSelection()
      if (e.key.toLowerCase() === 'c' && ws.lists.length && !ws.openTaskId) {
        e.preventDefault()
        void ws.createTask({ title: 'Nova tarefa', listId: ws.lists[0]?.id }).then((t) => ws.openTask(t.id))
      }
      if (e.key === '/' && showToolbar) {
        const input = document.querySelector<HTMLInputElement>('input[placeholder^="Buscar tarefas"]')
        if (input) {
          e.preventDefault()
          input.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ws, showToolbar])

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Button size="small" color="inherit" startIcon={<ArrowBackIcon />} onClick={() => navigate('/projetos')} sx={{ color: 'text.secondary' }}>
          Projetos
        </Button>
        <Typography variant="caption" color="text.secondary">
          {project.code}
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, mb: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Typography variant="h3" sx={{ lineHeight: 1.2 }}>
                {project.name}
              </Typography>
              <Chip
                size="small"
                onClick={(e) => setStageMenu(e.currentTarget)}
                icon={<Dot color={stage?.color ?? colors.textMuted} size={8} />}
                label={stage?.label ?? project.stageId}
                sx={{ bgcolor: alpha(stage?.color ?? colors.textMuted, 0.12), color: stage?.color, border: `1px solid ${alpha(stage?.color ?? colors.textMuted, 0.3)}`, '& .MuiChip-icon': { ml: 0.75 } }}
              />
              <StatusChip options={PROJECT_PRIORITIES} value={project.priority} />
              {project.archived ? <Chip size="small" label="Arquivado" /> : null}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {client?.name ?? 'Sem cliente'}
              {project.address ? ` · ${project.address}` : ''}
              {project.dueDate ? ` · Entrega ${fmtDate(project.dueDate)}${days !== null ? (days < 0 ? ` (${-days} dias de atraso)` : days === 0 ? ' (hoje)' : ` (em ${days} dias)`) : ''}` : ''}
            </Typography>
          </Box>
          <Box sx={{ width: { xs: '100%', md: 220 } }}>
            <ProgressLine value={progress} label="Progresso geral" height={8} />
          </Box>
          <AvatarStack users={team} size={32} max={5} />
          <Stack direction="row" spacing={0.5}>
            <Button variant="outlined" color="inherit" startIcon={<EditIcon />} onClick={() => setEditOpen(true)}>
              Editar
            </Button>
            <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label="Mais opções">
              <MoreHorizIcon />
            </IconButton>
          </Stack>
        </Stack>
        <Menu anchorEl={stageMenu} open={Boolean(stageMenu)} onClose={() => setStageMenu(null)}>
          {stages.map((s) => (
            <MenuItem
              key={s.id}
              selected={s.id === project.stageId}
              onClick={async () => {
                setStageMenu(null)
                await updateDoc('projects', project.id, { stageId: s.id, stageChangedAt: new Date().toISOString() })
              }}
            >
              <Dot color={s.color} />
              <Box component="span" sx={{ ml: 1 }}>
                {s.label}
              </Box>
            </MenuItem>
          ))}
        </Menu>
        <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => { setMenu(null); setClientOpen(true) }}>
            <SendIcon fontSize="small" sx={{ mr: 1 }} /> Atualizar o cliente (e-mail, WhatsApp, link)
          </MenuItem>
          <MenuItem onClick={() => { setMenu(null); setListsOpen(true) }}>
            <ViewListIcon fontSize="small" sx={{ mr: 1 }} /> Gerenciar listas
          </MenuItem>
          <MenuItem onClick={() => { setMenu(null); setAutoOpen(true) }}>
            <BoltIcon fontSize="small" sx={{ mr: 1 }} /> Automações
            {(project.automations ?? []).filter((a) => a.enabled).length ? ` (${(project.automations ?? []).filter((a) => a.enabled).length})` : ''}
          </MenuItem>
          <MenuItem onClick={() => { setMenu(null); setConfigOpen(true) }}>
            <SettingsIcon fontSize="small" sx={{ mr: 1 }} /> Status e campos personalizados
          </MenuItem>
          <MenuItem
            onClick={async () => {
              setMenu(null)
              await updateDoc('projects', project.id, { archived: !project.archived })
              toast.success(project.archived ? 'Projeto reativado.' : 'Projeto arquivado.')
            }}
          >
            {project.archived ? 'Reativar projeto' : 'Arquivar projeto'}
          </MenuItem>
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={async () => {
              setMenu(null)
              const ok = await confirm({
                title: 'Excluir projeto?',
                message: `Todas as tarefas, listas e registros de tempo de “${project.name}” serão movidos para a lixeira.`,
                confirmLabel: 'Excluir projeto',
                danger: true,
              })
              if (ok) {
                await removeDoc('projects', project.id)
                toast.success('Projeto excluído.')
                navigate('/projetos')
              }
            }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Excluir projeto
          </MenuItem>
        </Menu>
      </Paper>

      <Tabs value={view} onChange={(_, v) => setView(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, borderBottom: `1px solid ${colors.border}` }}>
        {VIEWS.map((v) => (
          <Tab key={v.id} value={v.id} label={v.label} icon={v.icon} iconPosition="start" />
        ))}
      </Tabs>

      {showToolbar ? <SavedViews view={view} onApply={(v) => setView(v as ViewId)} /> : null}

      {showToolbar ? (
        <FilterBar
          extra={
            <>
              {view === 'lista' || view === 'quadro' ? <GroupBySelect /> : null}
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={async () => {
                  const t = await ws.createTask({ title: 'Nova tarefa', listId: ws.lists[0]?.id })
                  ws.openTask(t.id)
                }}
                disabled={!ws.lists.length}
              >
                Nova tarefa
              </Button>
            </>
          }
        />
      ) : null}

      {ws.lists.length === 0 && showToolbar ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState
            icon={<ViewListIcon />}
            title="Este projeto ainda não tem listas"
            description="Crie uma lista (por exemplo, Projeto, Produção, Instalação) para começar a adicionar tarefas."
            action={
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setListsOpen(true)}>
                Criar lista
              </Button>
            }
          />
        </Paper>
      ) : (
        <>
          {view === 'visao' ? <Overview /> : null}
          {view === 'lista' ? <ListView /> : null}
          {view === 'quadro' ? <BoardView /> : null}
          {view === 'calendario' ? <CalendarView /> : null}
          {view === 'cronograma' ? <GanttView /> : null}
          {view === 'tabela' ? <TableView /> : null}
          {view === 'carga' ? <WorkloadView /> : null}
          {view === 'tempo' ? <TimeView /> : null}
          {view === 'docs' ? <DocsView /> : null}
          {view === 'atividade' ? <ActivityView /> : null}
          {view === 'arquivos' ? <FileBrowser projectId={project.id} clientId={project.clientId} /> : null}
        </>
      )}

      <TaskDrawer />
      <BulkBar />
      {autoOpen ? <AutomationsDialog onClose={() => setAutoOpen(false)} /> : null}
      {editOpen ? <ProjectDialog open project={project} onClose={() => setEditOpen(false)} /> : null}
      {clientOpen ? <ClientUpdateDialog open project={project} client={client} stage={stage} companyName={company.name} onClose={() => setClientOpen(false)} /> : null}
      {listsOpen ? <ListsDialog onClose={() => setListsOpen(false)} /> : null}
      {configOpen ? <ConfigDialog project={project} onClose={() => setConfigOpen(false)} /> : null}
    </Box>
  )
}

// ----------------------------------------------------------- gerenciar listas
function ListsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const confirm = useConfirm()
  const [name, setName] = useState('')
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Listas do projeto</DialogTitle>
      <DialogContent>
        <Stack spacing={1}>
          {ws.lists.map((l) => (
            <Stack key={l.id} direction="row" spacing={1} alignItems="center">
              <TextField
                type="color"
                value={l.color ?? '#8b8f98'}
                onChange={(e) => ws.updateList(l.id, { color: e.target.value })}
                sx={{ width: 56, '& input': { height: 22, p: 0.5 } }}
              />
              <TextField defaultValue={l.name} onBlur={(e) => e.target.value.trim() && e.target.value !== l.name && ws.updateList(l.id, { name: e.target.value.trim() })} />
              <Typography variant="caption" color="text.secondary" sx={{ minWidth: 60 }}>
                {ws.tasks.filter((t) => t.listId === l.id).length} tarefas
              </Typography>
              <IconButton
                aria-label="Excluir lista"
                disabled={ws.lists.length <= 1}
                onClick={async () => {
                  if (await confirm({ title: `Excluir lista “${l.name}”?`, message: 'As tarefas serão movidas para outra lista do projeto.', confirmLabel: 'Excluir', danger: true })) await ws.deleteList(l.id)
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
            <TextField placeholder="Nome da nova lista" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && ws.createList(name.trim(), LABEL_COLORS[ws.lists.length % LABEL_COLORS.length]).then(() => setName(''))} />
            <Button
              variant="contained"
              disabled={!name.trim()}
              onClick={() => ws.createList(name.trim(), LABEL_COLORS[ws.lists.length % LABEL_COLORS.length]).then(() => setName(''))}
            >
              Criar
            </Button>
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}

// ----------------------------------------- status e campos personalizados
function ConfigDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const ws = useWorkspace()
  const toast = useToast()
  const [statuses, setStatuses] = useState<TaskStatusDef[]>(ws.statuses)
  const [fields, setFields] = useState<CustomFieldDef[]>(project.customFields ?? [])

  const save = async () => {
    if (!statuses.some((s) => s.type === 'done')) return toast.error('Mantenha ao menos um status do tipo “Concluído”.')
    await updateDoc('projects', project.id, { statuses, customFields: fields })
    toast.success('Configuração do projeto salva.')
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Status e campos personalizados</DialogTitle>
      <DialogContent>
        <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 1 }}>
          Status das tarefas
        </Typography>
        <Stack spacing={1}>
          {statuses.map((s, i) => (
            <Stack key={s.id} direction="row" spacing={1} alignItems="center">
              <TextField type="color" value={s.color} onChange={(e) => setStatuses((l) => l.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} sx={{ width: 56, '& input': { height: 22, p: 0.5 } }} />
              <TextField value={s.label} onChange={(e) => setStatuses((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <TextField select value={s.type} onChange={(e) => setStatuses((l) => l.map((x, j) => (j === i ? { ...x, type: e.target.value as TaskStatusDef['type'] } : x)))} sx={{ width: { xs: 'calc(50% - 6px)', sm: 190 } }}>
                <MenuItem value="open">Aberto</MenuItem>
                <MenuItem value="active">Em andamento</MenuItem>
                <MenuItem value="done">Concluído</MenuItem>
              </TextField>
              <TextField
                type="number"
                label="Limite WIP"
                value={s.wipLimit ?? ''}
                onChange={(e) => setStatuses((l) => l.map((x, j) => (j === i ? { ...x, wipLimit: e.target.value ? Math.max(Number(e.target.value), 1) : undefined } : x)))}
                sx={{ width: { xs: 'calc(50% - 6px)', sm: 120 } }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <IconButton
                aria-label="Mover para cima"
                disabled={i === 0}
                onClick={() => setStatuses((l) => { const c = [...l]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c })}
              >
                <Box component="span" sx={{ fontSize: 16 }}>↑</Box>
              </IconButton>
              <IconButton aria-label="Remover status" disabled={statuses.length <= 2} onClick={() => setStatuses((l) => l.filter((_, j) => j !== i))}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button startIcon={<AddIcon />} onClick={() => setStatuses((l) => [...l, { id: `st-${uid().slice(0, 6)}`, label: 'Novo status', color: '#7d838c', type: 'active' }])}>
              Adicionar status
            </Button>
          </Box>
        </Stack>

        <Typography variant="overline" color="primary" sx={{ display: 'block', mt: 3, mb: 1 }}>
          Campos personalizados
        </Typography>
        <Stack spacing={1}>
          {fields.map((f, i) => (
            <Stack key={f.id} direction="row" spacing={1} alignItems="center">
              <TextField value={f.name} placeholder="Nome do campo" onChange={(e) => setFields((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <TextField select value={f.type} onChange={(e) => setFields((l) => l.map((x, j) => (j === i ? { ...x, type: e.target.value as CustomFieldDef['type'] } : x)))} sx={{ width: { xs: 'calc(50% - 6px)', sm: 190 } }}>
                <MenuItem value="text">Texto</MenuItem>
                <MenuItem value="number">Número</MenuItem>
                <MenuItem value="money">Valor (R$)</MenuItem>
                <MenuItem value="date">Data</MenuItem>
                <MenuItem value="select">Lista de opções</MenuItem>
                <MenuItem value="checkbox">Caixa de seleção</MenuItem>
              </TextField>
              {f.type === 'select' ? (
                <TextField
                  placeholder="Opções separadas por vírgula"
                  defaultValue={(f.options ?? []).join(', ')}
                  onBlur={(e) => setFields((l) => l.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x)))}
                />
              ) : null}
              <IconButton aria-label="Remover campo" onClick={() => setFields((l) => l.filter((_, j) => j !== i))}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button startIcon={<AddIcon />} onClick={() => setFields((l) => [...l, { id: `cf-${uid().slice(0, 6)}`, name: '', type: 'text' }])}>
              Adicionar campo
            </Button>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit">
          Cancelar
        </Button>
        <Button variant="contained" onClick={save}>
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
