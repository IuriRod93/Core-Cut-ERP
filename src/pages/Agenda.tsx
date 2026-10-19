import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Box, Button, FormControlLabel, IconButton, Paper, Switch, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, ChevronLeftIcon, ChevronRightIcon } from '../components/icons'
import { PageHeader } from '../components/ui'
import { FormDialog, type FieldDef } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { createDoc, removeDoc, updateDoc, useCollections } from '../lib/store'
import { EVENT_KINDS, INSTALL_KINDS, optColor, optLabel } from '../domain/constants'
import { isoDay, todayISO } from '../lib/format'
import { colors } from '../theme'
import type { AgendaEvent } from '../types'

interface Item {
  key: string
  date: string
  title: string
  color: string
  time?: string
  onClick: () => void
}

export function AgendaPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const { user, can } = useAuth()
  const { data } = useCollections(['events', 'installations', 'tasks', 'projects'] as const)
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [showTasks, setShowTasks] = useState(true)
  const [showLogistics, setShowLogistics] = useState(true)
  const [editing, setEditing] = useState<AgendaEvent | { date: string } | null>(null)

  const days = useMemo(() => eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) }), [cursor])

  const items = useMemo(() => {
    const out: Item[] = []
    for (const e of data.events) out.push({ key: `e${e.id}`, date: e.date, title: e.title, color: optColor(EVENT_KINDS, e.kind), time: e.startTime, onClick: () => setEditing(e) })
    if (showLogistics && can('logistics'))
      for (const i of data.installations.filter((x) => !['cancelada', 'concluida'].includes(x.status)))
        out.push({
          key: `i${i.id}`,
          date: i.date,
          title: `${optLabel(INSTALL_KINDS, i.kind)} · ${data.projects.find((p) => p.id === i.projectId)?.name ?? ''}`,
          color: '#3f7a4f',
          time: i.time,
          onClick: () => navigate(`/entregas?id=${i.id}`),
        })
    if (showTasks)
      for (const t of data.tasks.filter((x) => x.assigneeIds?.includes(user?.id ?? '') && x.dueDate && !x.completedAt))
        out.push({ key: `t${t.id}`, date: t.dueDate!, title: t.title, color: '#7d838c', onClick: () => navigate(`/projetos/${t.projectId}?tarefa=${t.id}`) })
    return out
  }, [data, showTasks, showLogistics, can, user?.id, navigate])

  const byDay = useMemo(() => {
    const m = new Map<string, Item[]>()
    items.forEach((i) => m.set(i.date, [...(m.get(i.date) ?? []), i]))
    m.forEach((list) => list.sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99')))
    return m
  }, [items])

  const fields: FieldDef[] = [
    { name: 'title', label: 'Título', type: 'text', required: true, span: 8 },
    { name: 'kind', label: 'Tipo', type: 'select', options: EVENT_KINDS, required: true, span: 4 },
    { name: 'date', label: 'Data', type: 'date', required: true, span: 4 },
    { name: 'startTime', label: 'Início', type: 'time', span: 4 },
    { name: 'endTime', label: 'Término', type: 'time', span: 4 },
    { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', span: 6 },
    { name: 'location', label: 'Local', type: 'text', span: 6 },
    { name: 'attendeeIds', label: 'Participantes', type: 'relations', collection: 'users' },
    { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
  ]

  const existing = editing && 'id' in editing ? (editing as AgendaEvent) : null

  return (
    <Box>
      <PageHeader
        title="Agenda"
        subtitle="Reuniões, medições, entregas e instalações — com seus prazos de tarefas no mesmo calendário."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({ date: todayISO() })}>
            Novo compromisso
          </Button>
        }
      />
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <IconButton onClick={() => setCursor((c) => addMonths(c, -1))} aria-label="Mês anterior">
            <ChevronLeftIcon />
          </IconButton>
          <IconButton onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Próximo mês">
            <ChevronRightIcon />
          </IconButton>
          <Typography variant="h5" sx={{ textTransform: 'capitalize', minWidth: 190 }}>
            {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
          </Typography>
          <Button size="small" variant="outlined" color="inherit" onClick={() => setCursor(startOfMonth(new Date()))}>
            Hoje
          </Button>
          <Box sx={{ flex: 1 }} />
          <FormControlLabel control={<Switch size="small" checked={showTasks} onChange={(e) => setShowTasks(e.target.checked)} />} label="Minhas tarefas" />
          {can('logistics') ? <FormControlLabel control={<Switch size="small" checked={showLogistics} onChange={(e) => setShowLogistics(e.target.checked)} />} label="Entregas e instalações" /> : null}
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', bgcolor: colors.subtle, borderBottom: `1px solid ${colors.border}` }}>
          {['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'].map((d) => (
            <Typography key={d} variant="overline" color="text.secondary" sx={{ px: 1.25, py: 0.75 }}>
              {d}
            </Typography>
          ))}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
          {days.map((day) => {
            const key = isoDay(day)
            const list = byDay.get(key) ?? []
            return (
              <Box
                key={key}
                onDoubleClick={() => setEditing({ date: key })}
                sx={{ minHeight: 128, p: 0.75, borderRight: `1px solid ${colors.border}`, borderBottom: `1px solid ${colors.border}`, bgcolor: isSameMonth(day, cursor) ? '#fff' : colors.subtle, '&:nth-of-type(7n)': { borderRight: 0 } }}
              >
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 12,
                    fontWeight: 600,
                    mb: 0.5,
                    bgcolor: isToday(day) ? colors.brand : 'transparent',
                    color: isToday(day) ? '#fff' : isSameMonth(day, cursor) ? colors.text : colors.textMuted,
                  }}
                >
                  {format(day, 'd')}
                </Box>
                <Stack spacing={0.4}>
                  {list.slice(0, 4).map((i) => (
                    <Box
                      key={i.key}
                      onClick={i.onClick}
                      title={i.title}
                      sx={{
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 1,
                        borderLeft: `3px solid ${i.color}`,
                        bgcolor: alpha(i.color, 0.1),
                        fontSize: 11.5,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: alpha(i.color, 0.2) },
                      }}
                    >
                      {i.time ? `${i.time} ` : ''}
                      {i.title}
                    </Box>
                  ))}
                  {list.length > 4 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                      +{list.length - 4} mais
                    </Typography>
                  ) : null}
                </Stack>
              </Box>
            )
          })}
        </Box>
      </Paper>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        Dica: clique duas vezes em um dia para criar um compromisso.
      </Typography>

      {editing ? (
        <FormDialog
          open
          title={existing ? 'Editar compromisso' : 'Novo compromisso'}
          fields={fields}
          initial={existing ? { ...existing } : { kind: 'reuniao', date: (editing as { date: string }).date, attendeeIds: user ? [user.id] : [] }}
          onClose={() => setEditing(null)}
          extraActions={
            existing ? (
              <Button
                color="error"
                onClick={async () => {
                  if (await confirm({ title: 'Excluir compromisso?', message: existing.title, confirmLabel: 'Excluir', danger: true })) {
                    await removeDoc('events', existing.id)
                    setEditing(null)
                  }
                }}
              >
                Excluir
              </Button>
            ) : undefined
          }
          onSave={async (values) => {
            const { id, createdAt, updatedAt, ...rest } = values
            void createdAt
            void updatedAt
            if (id) await updateDoc('events', id, rest)
            else await createDoc('events', rest)
            toast.success('Compromisso salvo.')
          }}
        />
      ) : null}
    </Box>
  )
}
