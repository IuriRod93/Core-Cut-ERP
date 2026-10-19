import { useMemo } from 'react'
import { addDays, differenceInCalendarDays, format, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Box, Tooltip, Typography, alpha } from '@mui/material'
import { Stack } from '../../components/Stack'
import { UserAvatar } from '../../components/ui'
import { useWorkspace } from './useWorkspace'
import { useCompany } from '../../lib/store'
import { isDoneStatus } from '../../domain/tasks'
import { fmtHours, toDate } from '../../lib/format'
import { colors } from '../../theme'

const WEEKS = 8

/**
 * Carga de trabalho: horas estimadas das tarefas abertas distribuídas entre as
 * datas de início/entrega (ou concentradas na entrega), contra a capacidade semanal.
 */
export function WorkloadView() {
  const ws = useWorkspace()
  const company = useCompany()
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weeks = Array.from({ length: WEEKS }, (_, i) => addDays(weekStart, i * 7))
  const capacity = (company.workdayHours || 8) * 5

  const { rows, unestimated } = useMemo(() => {
    const open = ws.tasks.filter((t) => !isDoneStatus(ws.statuses, t.status) && !t.completedAt && !ws.tasks.some((c) => c.parentId === t.id))
    let missing = 0
    const per = new Map<string, number[]>()
    for (const t of open) {
      if (!t.assigneeIds?.length) continue
      if (!t.estimateMinutes) {
        missing += 1
        continue
      }
      const due = toDate(t.dueDate) ?? toDate(t.startDate)
      if (!due) continue
      const start = toDate(t.startDate) ?? due
      const span = Math.max(differenceInCalendarDays(due, start) + 1, 1)
      const hoursPerDay = t.estimateMinutes / 60 / span / t.assigneeIds.length
      for (let d = 0; d < span; d++) {
        const day = addDays(start, d)
        const w = Math.floor(differenceInCalendarDays(day, weekStart) / 7)
        if (w < 0 || w >= WEEKS) continue
        if (day.getDay() === 0 || day.getDay() === 6) continue
        for (const uid of t.assigneeIds) {
          const arr = per.get(uid) ?? Array(WEEKS).fill(0)
          arr[w] += hoursPerDay
          per.set(uid, arr)
        }
      }
    }
    const users = ws.users.filter((u) => per.has(u.id) || ws.project.memberIds?.includes(u.id) || ws.project.managerId === u.id)
    return { rows: users.map((u) => ({ user: u, hours: per.get(u.id) ?? Array(WEEKS).fill(0) })), unestimated: missing }
  }, [ws.tasks, ws.users, ws.statuses, ws.project.memberIds, ws.project.managerId, weekStart])

  const tone = (ratio: number) => (ratio > 1 ? colors.error : ratio > 0.8 ? colors.warning : ratio > 0 ? colors.success : colors.border)

  return (
    <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 3, bgcolor: '#fff', overflow: 'auto' }}>
      <Box sx={{ minWidth: 220 + WEEKS * 96 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: `220px repeat(${WEEKS}, 96px)`, bgcolor: colors.subtle, borderBottom: `1px solid ${colors.border}` }}>
          <Typography variant="overline" color="text.secondary" sx={{ p: 1.25 }}>
            Pessoa · capacidade {capacity} h/sem
          </Typography>
          {weeks.map((w) => (
            <Typography key={w.toISOString()} variant="overline" color="text.secondary" sx={{ p: 1.25, textAlign: 'center' }}>
              {format(w, 'dd MMM', { locale: ptBR })}
            </Typography>
          ))}
        </Box>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
            Atribua responsáveis e estimativas às tarefas para visualizar a carga da equipe.
          </Typography>
        ) : null}
        {rows.map(({ user, hours }) => (
          <Box key={user.id} sx={{ display: 'grid', gridTemplateColumns: `220px repeat(${WEEKS}, 96px)`, borderBottom: `1px solid ${colors.border}` }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ p: 1.25 }}>
              <UserAvatar user={user} size={28} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {user.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {user.position}
                </Typography>
              </Box>
            </Stack>
            {hours.map((h, i) => {
              const ratio = h / capacity
              const c = tone(ratio)
              return (
                <Tooltip key={i} title={`${fmtHours(h)} de ${capacity}h (${Math.round(ratio * 100)}%)`}>
                  <Box sx={{ p: 0.75, display: 'grid', placeItems: 'center' }}>
                    <Box
                      sx={{
                        width: '100%',
                        height: 36,
                        borderRadius: 1.5,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: h > 0 ? alpha(c, Math.min(0.12 + ratio * 0.35, 0.55)) : 'transparent',
                        border: `1px solid ${h > 0 ? alpha(c, 0.4) : colors.border}`,
                        fontSize: 12,
                        fontWeight: 700,
                        color: h > 0 ? c : colors.textMuted,
                      }}
                    >
                      {h > 0 ? `${Math.round(h)}h` : '—'}
                    </Box>
                  </Box>
                </Tooltip>
              )
            })}
          </Box>
        ))}
      </Box>
      {unestimated ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', p: 1.5 }}>
          {unestimated} {unestimated === 1 ? 'tarefa aberta sem estimativa não entra' : 'tarefas abertas sem estimativa não entram'} neste cálculo.
        </Typography>
      ) : null}
    </Box>
  )
}
