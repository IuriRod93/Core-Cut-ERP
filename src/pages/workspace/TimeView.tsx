import { useMemo, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { Stack } from '../../components/Stack'
import { AddIcon, FileDownloadIcon, TimerIcon } from '../../components/icons'
import { EmptyState, ProgressLine, StatCard, UserAvatar } from '../../components/ui'
import { NumberField } from '../../components/forms'
import { useToast } from '../../components/feedback'
import { useAuth } from '../../auth/AuthContext'
import { createDoc } from '../../lib/store'
import { downloadBlob, fmtDate, fmtDuration, fmtHours, todayISO } from '../../lib/format'
import { colors } from '../../theme'
import { useWorkspace } from './useWorkspace'

const seconds = (e: { end?: string | null; seconds: number; start: string }) => (e.end ? e.seconds : Math.max(0, (Date.now() - new Date(e.start).getTime()) / 1000))

/** Folha de horas do projeto: registrado × estimado por pessoa e por tarefa, com lançamento manual e exportação. */
export function TimeView() {
  const ws = useWorkspace()
  const [range, setRange] = useState<'7' | '30' | 'all'>('30')
  const [adding, setAdding] = useState(false)

  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86400000
  const entries = useMemo(() => ws.entries.filter((e) => new Date(e.start).getTime() >= since), [ws.entries, since])

  const total = entries.reduce((s, e) => s + seconds(e), 0)
  const billable = entries.filter((e) => e.billable).reduce((s, e) => s + seconds(e), 0)
  const estimate = ws.tasks.reduce((s, t) => s + (t.estimateMinutes ?? 0), 0) * 60
  const allTime = ws.entries.reduce((s, e) => s + seconds(e), 0)

  const perUser = useMemo(() => {
    const m = new Map<string, { name: string; sec: number; n: number }>()
    for (const e of entries) {
      const cur = m.get(e.userId) ?? { name: e.userName ?? ws.userMap.get(e.userId)?.name ?? '—', sec: 0, n: 0 }
      cur.sec += seconds(e)
      cur.n += 1
      m.set(e.userId, cur)
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.sec - a.sec)
  }, [entries, ws.userMap])

  const perTask = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of ws.entries) if (e.taskId) m.set(e.taskId, (m.get(e.taskId) ?? 0) + seconds(e))
    return ws.tasks
      .filter((t) => m.has(t.id) || t.estimateMinutes)
      .map((t) => ({ task: t, sec: m.get(t.id) ?? 0, est: (t.estimateMinutes ?? 0) * 60 }))
      .sort((a, b) => b.sec - a.sec)
  }, [ws.entries, ws.tasks])

  const exportCsv = () => {
    const rows = [['Data', 'Pessoa', 'Tarefa', 'Horas', 'Faturável', 'Nota']]
    for (const e of [...entries].sort((a, b) => a.start.localeCompare(b.start)))
      rows.push([
        fmtDate(e.start),
        e.userName ?? ws.userMap.get(e.userId)?.name ?? '',
        ws.tasks.find((t) => t.id === e.taskId)?.title ?? '',
        (seconds(e) / 3600).toFixed(2).replace('.', ','),
        e.billable ? 'Sim' : 'Não',
        (e.note ?? '').replace(/[\r\n;]+/g, ' '),
      ])
    downloadBlob(new Blob(['﻿' + rows.map((r) => r.join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `horas-${ws.project.code ?? 'projeto'}.csv`)
  }

  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={range} onChange={(_, v) => v && setRange(v)}>
          <ToggleButton value="7">7 dias</ToggleButton>
          <ToggleButton value="30">30 dias</ToggleButton>
          <ToggleButton value="all">Tudo</ToggleButton>
        </ToggleButtonGroup>
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<FileDownloadIcon />} color="inherit" variant="outlined" onClick={exportCsv} disabled={!entries.length}>
          Exportar CSV
        </Button>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setAdding(true)} disabled={!ws.tasks.length}>
          Lançar horas
        </Button>
      </Stack>

      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Registrado no período" value={fmtHours(total / 3600)} icon={<TimerIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Faturável" value={fmtHours(billable / 3600)} tone="success" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Estimado (projeto)" value={fmtHours(estimate / 3600)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Total × estimado" value={estimate ? `${Math.round((allTime / estimate) * 100)}%` : '—'} tone={estimate && allTime > estimate ? 'error' : 'brand'} />
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              Por pessoa
            </Typography>
            {perUser.length === 0 ? (
              <EmptyState icon={<TimerIcon />} title="Sem horas no período" description="Use “Iniciar tempo” na tarefa ou lance horas manualmente." />
            ) : (
              perUser.map((u) => (
                <Stack key={u.id} direction="row" spacing={1.25} alignItems="center" sx={{ mb: 1.25 }}>
                  <UserAvatar user={ws.userMap.get(u.id) ?? { id: u.id, name: u.name }} size={30} />
                  <Box sx={{ flex: 1 }}>
                    <ProgressLine value={perUser[0].sec ? (u.sec / perUser[0].sec) * 100 : 0} label={u.name} />
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, width: 74, textAlign: 'right' }}>
                    {fmtDuration(u.sec)}
                  </Typography>
                </Stack>
              ))
            )}
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              Estimado × registrado por tarefa
            </Typography>
            {perTask.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Defina estimativas nas tarefas para comparar com o tempo registrado.
              </Typography>
            ) : (
              perTask.slice(0, 25).map(({ task, sec, est }) => {
                const over = est > 0 && sec > est
                return (
                  <Box key={task.id} onClick={() => ws.openTask(task.id)} sx={{ py: 0.9, cursor: 'pointer', borderBottom: `1px solid ${colors.border}`, '&:hover': { bgcolor: colors.subtle } }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2" sx={{ flex: 1, fontWeight: 600 }} noWrap>
                        {task.title}
                      </Typography>
                      <Typography variant="caption" color={over ? 'error.main' : 'text.secondary'} sx={{ whiteSpace: 'nowrap' }}>
                        {fmtDuration(sec)} / {est ? fmtDuration(est) : 'sem estimativa'}
                      </Typography>
                    </Stack>
                    {est ? <ProgressLine value={Math.min((sec / est) * 100, 100)} color={over ? colors.error : colors.brand} height={5} /> : null}
                  </Box>
                )
              })
            )}
          </Paper>
        </Grid>
      </Grid>

      {adding ? <ManualEntry onClose={() => setAdding(false)} /> : null}
    </Box>
  )
}

function ManualEntry({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const { user } = useAuth()
  const toast = useToast()
  const [taskId, setTaskId] = useState(ws.tasks[0]?.id ?? '')
  const [date, setDate] = useState(todayISO())
  const [hours, setHours] = useState<number | null>(1)
  const [billable, setBillable] = useState(false)
  const [note, setNote] = useState('')

  const save = async () => {
    if (!user || !taskId || !hours || hours <= 0) return
    const start = new Date(`${date}T08:00:00`)
    const sec = Math.round(hours * 3600)
    await createDoc('timeEntries', {
      taskId,
      projectId: ws.project.id,
      userId: user.id,
      userName: user.name,
      start: start.toISOString(),
      end: new Date(start.getTime() + sec * 1000).toISOString(),
      seconds: sec,
      billable,
      note: note.trim() || undefined,
    })
    toast.success('Horas lançadas.')
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Lançar horas</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField select label="Tarefa" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            {ws.tasks.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.title}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1.5}>
            <TextField type="date" label="Data" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <NumberField label="Horas" value={hours} min={0} decimals={2} onChange={setHours} />
          </Stack>
          <TextField label="Nota (opcional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <TextField select label="Cobrança" value={billable ? 'sim' : 'nao'} onChange={(e) => setBillable(e.target.value === 'sim')}>
            <MenuItem value="nao">Interna</MenuItem>
            <MenuItem value="sim">Faturável</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={save} disabled={!taskId || !hours}>
          Lançar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
