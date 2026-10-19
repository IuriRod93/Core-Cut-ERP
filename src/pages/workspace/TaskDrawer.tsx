import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from '../../components/Stack'
import { SideDrawer, UserAvatar, Tag } from '../../components/ui'
import { NumberField, TagsInput } from '../../components/forms'
import { useConfirm, useToast } from '../../components/feedback'
import {
  AddIcon,
  CloseIcon,
  ContentCopyIcon,
  DeleteIcon,
  DownloadIcon,
  AttachFileIcon,
  ContentCutIcon,
  MoreHorizIcon,
  PlayArrowIcon,
  StopIcon,
  SubdirectoryArrowRightIcon,
  LinkIcon,
  SendIcon,
} from '../../components/icons'
import { AssigneePicker, DoneToggle, DueChip, PriorityFlag, StatusPill } from './shared'
import { useWorkspace } from './useWorkspace'
import { useTimer } from '../../domain/timer'
import { useAuth } from '../../auth/AuthContext'
import { api, fileUrl } from '../../lib/api'
import { createPlanFromBytes, createPlanFromStoredFile, isPromobFile } from '../../lib/planFromFile'
import { createDoc, refreshCollection, removeDoc, updateDoc, useCollection } from '../../lib/store'
import { fmtDateTime, fmtDuration, fmtRelative, uid } from '../../lib/format'
import { isDoneStatus, trackedSeconds } from '../../domain/tasks'
import { colors } from '../../theme'
import { ProductionTimelineById } from '../../components/ProductionTimeline'
import type { Checklist, Task } from '../../types'

function Label({ children }: { children: string }) {
  return (
    <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
      {children}
    </Typography>
  )
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '120px 1fr', alignItems: 'center', minHeight: 36, gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

export function TaskDrawer() {
  const ws = useWorkspace()
  const task = ws.tasks.find((t) => t.id === ws.openTaskId) ?? null
  return (
    <SideDrawer open={Boolean(task)} onClose={() => ws.openTask(null)} title={task ? <TitleEditor key={task.id} task={task} /> : ''} width={680}>
      {task ? <TaskBody key={task.id} task={task} /> : null}
    </SideDrawer>
  )
}

function TitleEditor({ task }: { task: Task }) {
  const { updateTask } = useWorkspace()
  const [value, setValue] = useState(task.title)
  useEffect(() => setValue(task.title), [task.title])
  return (
    <TextField
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value.trim() && value !== task.title && updateTask(task.id, { title: value.trim() })}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      variant="standard"
      multiline
      slotProps={{ input: { disableUnderline: true, sx: { fontSize: '1.2rem', fontWeight: 600, fontFamily: '"Jost", sans-serif' } } }}
      sx={{ minWidth: 380 }}
    />
  )
}

function TaskBody({ task }: { task: Task }) {
  const ws = useWorkspace()
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const { running, start, stop } = useTimer()
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const list = ws.lists.find((l) => l.id === task.listId)
  const subtasks = ws.tasks.filter((t) => t.parentId === task.id)
  const done = isDoneStatus(ws.statuses, task.status)
  const trackedHere = running?.taskId === task.id
  const total = trackedSeconds(ws.entries, task.id)
  const parent = task.parentId ? ws.tasks.find((t) => t.id === task.parentId) : null
  const blockers = (task.dependsOn ?? []).map((id) => ws.tasks.find((t) => t.id === id)).filter(Boolean) as Task[]
  const blocked = blockers.some((b) => !isDoneStatus(ws.statuses, b.status))

  const copyLink = async () => {
    await navigator.clipboard?.writeText(`${location.origin}/projetos/${ws.project.id}?tarefa=${task.id}`)
    toast.success('Link da tarefa copiado.')
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2.5, flexWrap: 'wrap' }}>
        <DoneToggle
          done={done}
          size={26}
          onToggle={() => ws.updateTask(task.id, { status: done ? (ws.statuses.find((s) => s.type === 'open') ?? ws.statuses[0]).id : (ws.statuses.find((s) => s.type === 'done') ?? ws.statuses[ws.statuses.length - 1]).id })}
        />
        <StatusPill task={task} statuses={ws.statuses} onChange={(status) => ws.updateTask(task.id, { status })} />
        <Typography variant="caption" color="text.secondary">
          {parent ? `Subtarefa de “${parent.title}”` : list ? `em ${list.name}` : ''}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant={trackedHere ? 'contained' : 'outlined'}
          color={trackedHere ? 'primary' : 'inherit'}
          startIcon={trackedHere ? <StopIcon /> : <PlayArrowIcon />}
          onClick={() => (trackedHere ? stop() : start(task.id, ws.project.id))}
        >
          {trackedHere ? 'Parar' : 'Iniciar tempo'}
        </Button>
        <IconButton size="small" onClick={(e) => setMenu(e.currentTarget)} aria-label="Mais ações">
          <MoreHorizIcon />
        </IconButton>
        <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => { setMenu(null); void copyLink() }}>
            <LinkIcon fontSize="small" sx={{ mr: 1 }} /> Copiar link
          </MenuItem>
          <MenuItem onClick={() => { setMenu(null); void ws.duplicateTask(task.id) }}>
            <ContentCopyIcon fontSize="small" sx={{ mr: 1 }} /> Duplicar
          </MenuItem>
          <MenuItem
            sx={{ color: 'error.main' }}
            onClick={async () => {
              setMenu(null)
              const ok = await confirm({ title: 'Excluir tarefa?', message: subtasks.length ? `Suas ${subtasks.length} subtarefas também serão excluídas.` : 'Ela será movida para a lixeira.', confirmLabel: 'Excluir', danger: true })
              if (ok) {
                ws.openTask(null)
                await ws.deleteTask(task.id)
                toast.success('Tarefa excluída.')
              }
            }}
          >
            <DeleteIcon fontSize="small" sx={{ mr: 1 }} /> Excluir
          </MenuItem>
        </Menu>
      </Stack>

      {blocked ? (
        <Box sx={{ mb: 2, p: 1.25, borderRadius: 2, bgcolor: alpha(colors.warning, 0.1), border: `1px solid ${alpha(colors.warning, 0.3)}`, color: '#7a5311', fontSize: 13 }}>
          Esta tarefa está bloqueada por: <strong>{blockers.filter((b) => !isDoneStatus(ws.statuses, b.status)).map((b) => b.title).join(', ')}</strong>
        </Box>
      ) : null}

      <Stack spacing={0.25} sx={{ mb: 3 }}>
        <Property label="Responsáveis">
          <AssigneePicker task={task} size={26} variant="field" />
        </Property>
        <Property label="Prioridade">
          <PriorityFlag priority={task.priority} showLabel onChange={(p) => ws.updateTask(task.id, { priority: p as Task['priority'] })} />
        </Property>
        <Property label="Início">
          <DueChip task={task} field="startDate" onChange={(d) => ws.updateTask(task.id, { startDate: d })} />
        </Property>
        <Property label="Entrega">
          <DueChip task={task} onChange={(d) => ws.updateTask(task.id, { dueDate: d })} />
        </Property>
        <Property label="Estimativa (h)">
          <Box sx={{ width: 120 }}>
            <NumberField
              value={task.estimateMinutes ? Math.round((task.estimateMinutes / 60) * 100) / 100 : null}
              onChange={(v) => ws.updateTask(task.id, { estimateMinutes: v ? Math.round(v * 60) : 0 })}
              min={0}
              placeholder="0"
            />
          </Box>
        </Property>
        {task.productionOrderId ? (
          <Box sx={{ my: 1.5, p: 1.5, borderRadius: 2, border: `1px solid ${colors.brand}`, bgcolor: colors.brandTint }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Tarefa gerada pela produção: o andamento é atualizado sozinho a partir do Chão de fábrica.
            </Typography>
            <ProductionTimelineById orderId={task.productionOrderId} />
          </Box>
        ) : null}
        <Property label="Etiquetas">
          <TagsInput value={task.tags} onChange={(tags) => ws.updateTask(task.id, { tags })} placeholder="Adicionar etiqueta" />
        </Property>
        <Property label="Lista">
          <TextField select value={task.listId ?? ''} onChange={(e) => ws.updateTask(task.id, { listId: e.target.value })} sx={{ maxWidth: 260 }}>
            {ws.lists.map((l) => (
              <MenuItem key={l.id} value={l.id}>
                {l.name}
              </MenuItem>
            ))}
          </TextField>
        </Property>
        <Property label="Marco do projeto">
          <Switch size="small" checked={Boolean(task.milestone)} onChange={(e) => ws.updateTask(task.id, { milestone: e.target.checked })} />
        </Property>
        <Property label="Repetir">
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              select
              value={task.recurrence ? task.recurrence.unit : ''}
              onChange={(e) => ws.updateTask(task.id, { recurrence: e.target.value ? { every: task.recurrence?.every ?? 1, unit: e.target.value as 'day' | 'week' | 'month' } : null })}
              sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }}
              slotProps={{ select: { displayEmpty: true } }}
            >
              <MenuItem value="">Não repete</MenuItem>
              <MenuItem value="day">Diariamente</MenuItem>
              <MenuItem value="week">Semanalmente</MenuItem>
              <MenuItem value="month">Mensalmente</MenuItem>
            </TextField>
            {task.recurrence ? (
              <Typography variant="caption" color="text.secondary">
                A cada
                <NumberField
                  value={task.recurrence.every}
                  min={1}
                  decimals={0}
                  onChange={(v) => ws.updateTask(task.id, { recurrence: { ...task.recurrence!, every: v ?? 1 } })}
                  fullWidth={false}
                  sx={{ width: 70, mx: 1 }}
                />
              </Typography>
            ) : null}
          </Stack>
        </Property>
        {(ws.project.customFields ?? []).map((f) => (
          <Property key={f.id} label={f.name}>
            {f.type === 'checkbox' ? (
              <Checkbox size="small" checked={Boolean(task.custom?.[f.id])} onChange={(e) => ws.updateTask(task.id, { custom: { ...(task.custom ?? {}), [f.id]: e.target.checked } })} />
            ) : f.type === 'select' ? (
              <TextField select value={String(task.custom?.[f.id] ?? '')} onChange={(e) => ws.updateTask(task.id, { custom: { ...(task.custom ?? {}), [f.id]: e.target.value } })} sx={{ maxWidth: 240 }}>
                <MenuItem value="">—</MenuItem>
                {(f.options ?? []).map((o) => (
                  <MenuItem key={o} value={o}>
                    {o}
                  </MenuItem>
                ))}
              </TextField>
            ) : f.type === 'number' || f.type === 'money' ? (
              <Box sx={{ width: 160 }}>
                <NumberField
                  value={(task.custom?.[f.id] as number) ?? null}
                  adornment={f.type === 'money' ? 'R$' : undefined}
                  onChange={(v) => ws.updateTask(task.id, { custom: { ...(task.custom ?? {}), [f.id]: v } })}
                />
              </Box>
            ) : (
              <TextField
                type={f.type === 'date' ? 'date' : 'text'}
                defaultValue={String(task.custom?.[f.id] ?? '')}
                onBlur={(e) => ws.updateTask(task.id, { custom: { ...(task.custom ?? {}), [f.id]: e.target.value } })}
                sx={{ maxWidth: 260 }}
                slotProps={f.type === 'date' ? { inputLabel: { shrink: true } } : undefined}
              />
            )}
          </Property>
        ))}
      </Stack>

      <Label>Descrição</Label>
      <DescriptionEditor task={task} />

      <Divider sx={{ my: 3 }} />
      <Subtasks task={task} subtasks={subtasks} />

      <Divider sx={{ my: 3 }} />
      <Checklists task={task} />

      <Divider sx={{ my: 3 }} />
      <Dependencies task={task} />

      <Divider sx={{ my: 3 }} />
      <TimeSection task={task} total={total} />

      <Divider sx={{ my: 3 }} />
      <Attachments task={task} />

      <Divider sx={{ my: 3 }} />
      <Discussion task={task} currentUserId={user?.id ?? ''} />
    </Box>
  )
}

// -------------------------------------------------------------- descrição
function DescriptionEditor({ task }: { task: Task }) {
  const { updateTask } = useWorkspace()
  const [value, setValue] = useState(task.description ?? '')
  const dirty = useRef(false)
  return (
    <TextField
      multiline
      minRows={3}
      maxRows={14}
      placeholder="Detalhes, medidas, observações do cliente…"
      value={value}
      onChange={(e) => {
        dirty.current = true
        setValue(e.target.value)
      }}
      onBlur={() => {
        if (dirty.current && value !== (task.description ?? '')) updateTask(task.id, { description: value })
        dirty.current = false
      }}
    />
  )
}

// ------------------------------------------------------------ subtarefas
function Subtasks({ task, subtasks }: { task: Task; subtasks: Task[] }) {
  const ws = useWorkspace()
  const [title, setTitle] = useState('')
  const doneCount = subtasks.filter((s) => isDoneStatus(ws.statuses, s.status)).length
  const add = async () => {
    if (!title.trim()) return
    await ws.createTask({ title: title.trim(), parentId: task.id, listId: task.listId, assigneeIds: task.assigneeIds, dueDate: task.dueDate })
    setTitle('')
  }
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Label>{`Subtarefas${subtasks.length ? ` · ${doneCount}/${subtasks.length}` : ''}`}</Label>
      </Stack>
      {subtasks.length ? <LinearProgress variant="determinate" value={(doneCount / subtasks.length) * 100} sx={{ mb: 1.5, '& .MuiLinearProgress-bar': { bgcolor: colors.success } }} /> : null}
      {subtasks
        .sort((a, b) => a.order - b.order)
        .map((s) => {
          const sdone = isDoneStatus(ws.statuses, s.status)
          return (
            <Stack key={s.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5, borderBottom: `1px solid ${colors.border}` }}>
              <SubdirectoryArrowRightIcon sx={{ fontSize: 16, color: colors.textMuted }} />
              <DoneToggle
                done={sdone}
                onToggle={() => ws.updateTask(s.id, { status: sdone ? (ws.statuses.find((x) => x.type === 'open') ?? ws.statuses[0]).id : (ws.statuses.find((x) => x.type === 'done') ?? ws.statuses[ws.statuses.length - 1]).id })}
              />
              <Typography
                variant="body2"
                sx={{ flex: 1, cursor: 'pointer', textDecoration: sdone ? 'line-through' : 'none', color: sdone ? 'text.secondary' : 'text.primary', '&:hover': { color: colors.brand } }}
                onClick={() => ws.openTask(s.id)}
              >
                {s.title}
              </Typography>
              <DueChip task={s} onChange={(d) => ws.updateTask(s.id, { dueDate: d })} />
              <AssigneePicker task={s} size={22} />
            </Stack>
          )
        })}
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <TextField placeholder="Adicionar subtarefa e pressionar Enter" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Button startIcon={<AddIcon />} onClick={add} disabled={!title.trim()}>
          Adicionar
        </Button>
      </Stack>
    </Box>
  )
}

// ------------------------------------------------------------- checklists
function Checklists({ task }: { task: Task }) {
  const { updateTask } = useWorkspace()
  const lists = task.checklists ?? []
  const save = (next: Checklist[]) => updateTask(task.id, { checklists: next })
  const [newItem, setNewItem] = useState<Record<string, string>>({})

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Label>Checklists</Label>
        <Button size="small" startIcon={<AddIcon />} onClick={() => save([...lists, { id: uid(), title: 'Checklist', items: [] }])}>
          Nova checklist
        </Button>
      </Stack>
      {lists.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Use checklists para conferências de produção, itens de instalação ou pendências do cliente.
        </Typography>
      ) : null}
      {lists.map((cl) => {
        const done = cl.items.filter((i) => i.done).length
        return (
          <Box key={cl.id} sx={{ mb: 2, p: 1.5, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <TextField
                variant="standard"
                defaultValue={cl.title}
                onBlur={(e) => e.target.value !== cl.title && save(lists.map((c) => (c.id === cl.id ? { ...c, title: e.target.value } : c)))}
                slotProps={{ input: { disableUnderline: true, sx: { fontWeight: 600 } } }}
              />
              <Typography variant="caption" color="text.secondary">
                {done}/{cl.items.length}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" onClick={() => save(lists.filter((c) => c.id !== cl.id))} aria-label="Remover checklist">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
            {cl.items.length ? <LinearProgress variant="determinate" value={(done / cl.items.length) * 100} sx={{ my: 1, '& .MuiLinearProgress-bar': { bgcolor: colors.success } }} /> : null}
            {cl.items.map((it) => (
              <Stack key={it.id} direction="row" alignItems="center" spacing={0.5}>
                <Checkbox size="small" checked={it.done} onChange={(e) => save(lists.map((c) => (c.id === cl.id ? { ...c, items: c.items.map((i) => (i.id === it.id ? { ...i, done: e.target.checked } : i)) } : c)))} />
                <Typography variant="body2" sx={{ flex: 1, textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'text.secondary' : 'text.primary' }}>
                  {it.text}
                </Typography>
                <IconButton size="small" onClick={() => save(lists.map((c) => (c.id === cl.id ? { ...c, items: c.items.filter((i) => i.id !== it.id) } : c)))} aria-label="Remover item">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <TextField
              placeholder="Novo item…"
              value={newItem[cl.id] ?? ''}
              onChange={(e) => setNewItem((s) => ({ ...s, [cl.id]: e.target.value }))}
              onKeyDown={(e) => {
                const text = (newItem[cl.id] ?? '').trim()
                if (e.key === 'Enter' && text) {
                  save(lists.map((c) => (c.id === cl.id ? { ...c, items: [...c.items, { id: uid(), text, done: false }] } : c)))
                  setNewItem((s) => ({ ...s, [cl.id]: '' }))
                }
              }}
              sx={{ mt: 1 }}
            />
          </Box>
        )
      })}
    </Box>
  )
}

// ------------------------------------------------------------ dependências
function Dependencies({ task }: { task: Task }) {
  const ws = useWorkspace()
  const candidates = ws.tasks.filter((t) => t.id !== task.id && !(task.dependsOn ?? []).includes(t.id) && !t.parentId)
  const [pick, setPick] = useState('')
  return (
    <Box>
      <Label>Dependências (esta tarefa aguarda)</Label>
      {(task.dependsOn ?? []).map((id) => {
        const dep = ws.tasks.find((t) => t.id === id)
        if (!dep) return null
        return (
          <Stack key={id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
            <StatusPill task={dep} statuses={ws.statuses} compact />
            <Typography variant="body2" sx={{ flex: 1, cursor: 'pointer' }} onClick={() => ws.openTask(dep.id)}>
              {dep.title}
            </Typography>
            <IconButton size="small" onClick={() => ws.updateTask(task.id, { dependsOn: (task.dependsOn ?? []).filter((d) => d !== id) })} aria-label="Remover dependência">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        )
      })}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField select label="Adicionar dependência" value={pick} onChange={(e) => setPick(e.target.value)}>
          {candidates.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.title}
            </MenuItem>
          ))}
        </TextField>
        <Button
          disabled={!pick}
          onClick={() => {
            ws.updateTask(task.id, { dependsOn: [...(task.dependsOn ?? []), pick] })
            setPick('')
          }}
        >
          Vincular
        </Button>
      </Stack>
    </Box>
  )
}

// ------------------------------------------------------------------ tempo
function TimeSection({ task, total }: { task: Task; total: number }) {
  const ws = useWorkspace()
  const { user } = useAuth()
  const toast = useToast()
  const [minutes, setMinutes] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const mine = ws.entries.filter((e) => e.taskId === task.id).sort((a, b) => b.start.localeCompare(a.start))
  const est = (task.estimateMinutes ?? 0) * 60

  const addManual = async () => {
    if (!minutes || !user) return
    const end = new Date()
    const start = new Date(end.getTime() - minutes * 60_000)
    await createDoc('timeEntries', { taskId: task.id, projectId: ws.project.id, userId: user.id, userName: user.name, start: start.toISOString(), end: end.toISOString(), seconds: minutes * 60, note, billable: true })
    setMinutes(null)
    setNote('')
    toast.success('Tempo registrado.')
  }

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between">
        <Label>Tempo registrado</Label>
        <Typography variant="body2">
          <strong>{fmtDuration(total)}</strong>
          {est ? <span style={{ color: colors.textSecondary }}> de {fmtDuration(est)} estimadas</span> : null}
        </Typography>
      </Stack>
      {est ? (
        <LinearProgress
          variant="determinate"
          value={Math.min((total / est) * 100, 100)}
          sx={{ mb: 1.5, '& .MuiLinearProgress-bar': { bgcolor: total > est ? colors.error : colors.brand } }}
        />
      ) : null}
      {mine.slice(0, 6).map((e) => (
        <Stack key={e.id} direction="row" spacing={1} alignItems="center" sx={{ py: 0.5 }}>
          <Typography variant="body2" sx={{ flex: 1 }} noWrap>
            {e.userName ?? '—'} · {fmtDateTime(e.start)}
            {e.note ? ` · ${e.note}` : ''}
          </Typography>
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {e.end ? fmtDuration(e.seconds) : 'em andamento'}
          </Typography>
          <IconButton size="small" onClick={() => removeDoc('timeEntries', e.id)} aria-label="Remover registro">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Box sx={{ width: 130 }}>
          <NumberField value={minutes} onChange={setMinutes} placeholder="minutos" min={1} />
        </Box>
        <TextField placeholder="Observação (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button onClick={addManual} disabled={!minutes}>
          Lançar
        </Button>
      </Stack>
    </Box>
  )
}

// ----------------------------------------------------------------- anexos
function Attachments({ task }: { task: Task }) {
  const ws = useWorkspace()
  const toast = useToast()
  const navigate = useNavigate()
  const { user } = useAuth()
  const files = useCollection('files')
  const plans = useCollection('cutPlans')
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState<string | null>(null)
  const mine = files.items.filter((f) => f.refType === 'task' && f.refId === task.id)
  const planOf = (fileId: string) => plans.items.find((p) => (p.imports ?? []).some((i) => i.fileId === fileId))

  const makePlan = async (fileId: string, name: string, bytes?: Uint8Array) => {
    const origin = { fileId, fileName: name, projectId: ws.project.id, taskId: task.id, taskTitle: task.title, responsibleId: user?.id }
    const plan = bytes ? await createPlanFromBytes(bytes, origin) : await createPlanFromStoredFile(origin)
    if (plan) toast.success(`Plano de corte ${plan.code} criado no projeto — abra em Plano de corte para revisar e otimizar.`)
    else toast.warning(`${name}: nenhuma peça de corte foi encontrada no arquivo.`)
    return plan
  }

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setBusy(true)
    try {
      for (const file of Array.from(list)) {
        const qs = new URLSearchParams({ name: file.name, folder: 'Tarefas', projectId: ws.project.id, refType: 'task', refId: task.id, visibility: 'interno' })
        const meta = await api.upload<{ id: string }>(`/files/upload?${qs}`, file)
        // arquivos do Promob (CSV/XML/DXF/DXT) viram um plano de corte do projeto
        if (isPromobFile(file.name) && !/\.txt$/i.test(file.name)) {
          try {
            await makePlan(meta.id, file.name, new Uint8Array(await file.arrayBuffer()))
          } catch (e) {
            toast.warning(`${file.name}: anexado, mas não foi possível criar o plano (${e instanceof Error ? e.message : 'erro de leitura'}).`)
          }
        }
      }
      await refreshCollection('files')
      toast.success('Arquivo anexado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no upload.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Label>Anexos</Label>
        <Button size="small" startIcon={<AttachFileIcon />} onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Enviando…' : 'Anexar'}
        </Button>
        <input ref={input} type="file" hidden multiple onChange={(e) => upload(e.target.files)} />
      </Stack>
      {mine.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Anexe desenhos, fotos da obra, listas de corte e documentos.
        </Typography>
      ) : null}
      {mine.map((f) => (
        <Stack key={f.id} direction="row" alignItems="center" spacing={1} sx={{ py: 0.5 }}>
          <AttachFileIcon sx={{ fontSize: 18, color: colors.textMuted }} />
          <Typography variant="body2" sx={{ flex: 1 }} noWrap>
            {f.name}
          </Typography>
          {isPromobFile(f.name) && !/\.txt$/i.test(f.name) ? (
            planOf(f.id) ? (
              <Chip
                size="small"
                color="primary"
                variant="outlined"
                icon={<ContentCutIcon />}
                label={`Plano ${planOf(f.id)?.code ?? ''}`}
                onClick={() => navigate(`/plano-de-corte?plano=${planOf(f.id)?.id}`)}
              />
            ) : (
              <Button
                size="small"
                startIcon={<ContentCutIcon />}
                disabled={creating === f.id}
                onClick={async () => {
                  setCreating(f.id)
                  try {
                    await makePlan(f.id, f.name)
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Falha ao criar o plano.')
                  } finally {
                    setCreating(null)
                  }
                }}
              >
                {creating === f.id ? 'Lendo…' : 'Criar plano'}
              </Button>
            )
          ) : null}
          <Typography variant="caption" color="text.secondary">
            {(f.size / 1024).toFixed(0)} KB
          </Typography>
          <Tooltip title="Baixar">
            <IconButton size="small" component="a" href={fileUrl(f.id)} aria-label="Baixar arquivo">
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={() => removeDoc('files', f.id)} aria-label="Remover arquivo">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
    </Box>
  )
}

// ---------------------------------------------------- comentários/atividade
function Discussion({ task, currentUserId }: { task: Task; currentUserId: string }) {
  const ws = useWorkspace()
  const { user } = useAuth()
  const [text, setText] = useState('')
  const items = ws.comments.filter((c) => c.taskId === task.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const send = async () => {
    const body = text.trim()
    if (!body || !user) return
    const mentions = ws.users.filter((u) => new RegExp(`@${u.name.split(' ')[0]}\\b`, 'i').test(body)).map((u) => u.id)
    await updateDoc('tasks', task.id, {}) // toca updatedAt
    await createDoc('taskComments', { taskId: task.id, projectId: ws.project.id, authorId: user.id, authorName: user.name, body, kind: 'comment', mentions })
    setText('')
  }

  return (
    <Box>
      <Label>Atividade e comentários</Label>
      <Stack spacing={1.25}>
        {items.map((c) =>
          c.kind === 'system' ? (
            <Stack key={c.id} direction="row" spacing={1} alignItems="center">
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colors.borderStrong, mx: 1.25 }} />
              <Typography variant="caption" color="text.secondary">
                <strong>{c.authorName}</strong> {c.body} · {fmtRelative(c.createdAt)}
              </Typography>
            </Stack>
          ) : (
            <Stack key={c.id} direction="row" spacing={1.25} alignItems="flex-start">
              <UserAvatar user={ws.userMap.get(c.authorId) ?? { id: c.authorId, name: c.authorName }} size={30} />
              <Box sx={{ flex: 1, bgcolor: c.authorId === currentUserId ? colors.brandTint : colors.subtle, border: `1px solid ${colors.border}`, borderRadius: 2, px: 1.5, py: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  <strong style={{ color: colors.text }}>{c.authorName}</strong> · {fmtRelative(c.createdAt)}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mt: 0.25 }}>
                  {c.body.split(/(@\p{L}+)/gu).map((part, i) =>
                    part.startsWith('@') ? (
                      <Box key={i} component="span" sx={{ color: colors.brand, fontWeight: 700 }}>
                        {part}
                      </Box>
                    ) : (
                      part
                    ),
                  )}
                </Typography>
              </Box>
            </Stack>
          ),
        )}
      </Stack>
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mt: 2 }}>
        <TextField
          multiline
          minRows={2}
          placeholder="Escreva um comentário… use @nome para mencionar alguém"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send()
          }}
        />
        <Button variant="contained" onClick={send} disabled={!text.trim()} startIcon={<SendIcon />} sx={{ minWidth: 110 }}>
          Enviar
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Ctrl + Enter para enviar. Tags: {ws.users.slice(0, 4).map((u) => <Tag key={u.id} label={`@${u.name.split(' ')[0]}`} />)}
      </Typography>
    </Box>
  )
}
