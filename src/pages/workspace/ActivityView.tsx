import { useMemo, useState } from 'react'
import { Box, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { Stack } from '../../components/Stack'
import { CheckCircleIcon, CommentIcon, AddIcon, AttachFileIcon, HistoryIcon } from '../../components/icons'
import { EmptyState, UserAvatar } from '../../components/ui'
import { useCollection } from '../../lib/store'
import { fmtDate, fmtTime } from '../../lib/format'
import { colors } from '../../theme'
import { useWorkspace } from './useWorkspace'

interface Event {
  id: string
  at: string
  userId?: string
  userName: string
  taskId?: string
  kind: 'comment' | 'system' | 'created' | 'completed' | 'file'
  text: string
}

const ICON = { comment: CommentIcon, system: HistoryIcon, created: AddIcon, completed: CheckCircleIcon, file: AttachFileIcon }
const COLOR = { comment: colors.brand, system: colors.textMuted, created: '#2f6f9f', completed: '#2e7d4f', file: '#8a6d3b' }

/** Feed de atividade do projeto: criações, conclusões, comentários, mudanças e arquivos, em ordem cronológica. */
export function ActivityView() {
  const ws = useWorkspace()
  const files = useCollection('files')
  const [kind, setKind] = useState<'all' | 'comment' | 'changes'>('all')
  const [who, setWho] = useState('')

  const events = useMemo(() => {
    const out: Event[] = []
    const title = (id?: string) => ws.tasks.find((t) => t.id === id)?.title
    for (const c of ws.comments)
      out.push({ id: `c-${c.id}`, at: c.createdAt, userId: c.authorId, userName: c.authorName, taskId: c.taskId, kind: c.kind === 'system' ? 'system' : 'comment', text: c.kind === 'system' ? c.body : `comentou: “${c.body.slice(0, 160)}”` })
    for (const t of ws.tasks) {
      out.push({ id: `n-${t.id}`, at: t.createdAt, userId: t.createdBy, userName: t.createdByName ?? '—', taskId: t.id, kind: 'created', text: `criou a tarefa` })
      if (t.completedAt) out.push({ id: `d-${t.id}`, at: t.completedAt, userName: ws.userMap.get(t.assigneeIds?.[0] ?? '')?.name ?? 'Equipe', userId: t.assigneeIds?.[0], taskId: t.id, kind: 'completed', text: 'concluiu a tarefa' })
    }
    for (const f of files.items.filter((f) => f.projectId === ws.project.id))
      out.push({ id: `f-${f.id}`, at: f.createdAt, userId: f.uploadedBy, userName: f.uploadedByName, taskId: f.refType === 'task' ? (f.refId ?? undefined) : undefined, kind: 'file', text: `anexou “${f.name}”${f.refType === 'task' && title(f.refId ?? undefined) ? '' : ''}` })
    return out.sort((a, b) => b.at.localeCompare(a.at))
  }, [ws.comments, ws.tasks, ws.userMap, ws.project.id, files.items])

  const shown = events.filter((e) => (!who || e.userId === who) && (kind === 'all' || (kind === 'comment' ? e.kind === 'comment' : e.kind !== 'comment')))
  const byDay = useMemo(() => {
    const m = new Map<string, Event[]>()
    for (const e of shown.slice(0, 300)) {
      const k = e.at.slice(0, 10)
      m.set(k, [...(m.get(k) ?? []), e])
    }
    return [...m.entries()]
  }, [shown])

  return (
    <Box sx={{ maxWidth: 860 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={kind} onChange={(_, v) => v && setKind(v)}>
          <ToggleButton value="all">Tudo</ToggleButton>
          <ToggleButton value="comment">Comentários</ToggleButton>
          <ToggleButton value="changes">Alterações</ToggleButton>
        </ToggleButtonGroup>
        <TextField select label="Pessoa" value={who} onChange={(e) => setWho(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 220 } }}>
          <MenuItem value="">Todas</MenuItem>
          {ws.users.map((u) => (
            <MenuItem key={u.id} value={u.id}>
              {u.name}
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="caption" color="text.secondary">
          {shown.length} evento(s)
        </Typography>
      </Stack>
      {byDay.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState icon={<HistoryIcon />} title="Sem atividade" description="As ações do projeto aparecem aqui conforme a equipe trabalha." />
        </Paper>
      ) : (
        byDay.map(([day, list]) => (
          <Box key={day} sx={{ mb: 2.5 }}>
            <Typography variant="overline" color="text.secondary">
              {fmtDate(day)}
            </Typography>
            <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
              {list.map((e, i) => {
                const Icon = ICON[e.kind]
                const task = ws.tasks.find((t) => t.id === e.taskId)
                return (
                  <Stack
                    key={e.id}
                    direction="row"
                    spacing={1.5}
                    alignItems="center"
                    onClick={() => task && ws.openTask(task.id)}
                    sx={{ px: 2, py: 1.1, cursor: task ? 'pointer' : 'default', borderBottom: i < list.length - 1 ? `1px solid ${colors.border}` : 0, '&:hover': task ? { bgcolor: colors.subtle } : undefined }}
                  >
                    <UserAvatar user={ws.userMap.get(e.userId ?? '') ?? { id: e.userId ?? e.userName, name: e.userName }} size={28} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2">
                        <strong>{e.userName}</strong> {e.text}
                        {task ? (
                          <>
                            {' '}
                            em <span style={{ color: colors.brand, fontWeight: 600 }}>{task.title}</span>
                          </>
                        ) : null}
                      </Typography>
                    </Box>
                    <Icon sx={{ fontSize: 16, color: COLOR[e.kind] }} />
                    <Typography variant="caption" color="text.secondary" sx={{ width: 44, textAlign: 'right' }}>
                      {fmtTime(e.at)}
                    </Typography>
                  </Stack>
                )
              })}
            </Paper>
          </Box>
        ))
      )}
    </Box>
  )
}
