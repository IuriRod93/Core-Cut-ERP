import { useMemo, useState } from 'react'
import { addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Box, Button, IconButton, Typography, alpha } from '@mui/material'
import { Stack } from '../../components/Stack'
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/icons'
import { useWorkspace } from './useWorkspace'
import { isoDay } from '../../lib/format'
import { colors } from '../../theme'

const MAX_VISIBLE = 3

export function CalendarView() {
  const ws = useWorkspace()
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const days = useMemo(
    () => eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) }),
    [cursor],
  )

  const byDay = useMemo(() => {
    const map = new Map<string, typeof ws.filtered>()
    for (const t of ws.filtered) {
      if (!t.dueDate) continue
      const arr = map.get(t.dueDate) ?? []
      arr.push(t)
      map.set(t.dueDate, arr)
    }
    return map
  }, [ws.filtered])

  const noDate = ws.filtered.filter((t) => !t.dueDate && !t.parentId).length

  return (
    <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 3, bgcolor: '#fff', overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1.25, borderBottom: `1px solid ${colors.border}` }}>
        <IconButton onClick={() => setCursor((c) => addMonths(c, -1))} aria-label="Mês anterior">
          <ChevronLeftIcon />
        </IconButton>
        <IconButton onClick={() => setCursor((c) => addMonths(c, 1))} aria-label="Próximo mês">
          <ChevronRightIcon />
        </IconButton>
        <Typography variant="h5" sx={{ textTransform: 'capitalize', minWidth: 170 }}>
          {format(cursor, "MMMM 'de' yyyy", { locale: ptBR })}
        </Typography>
        <Button size="small" variant="outlined" color="inherit" onClick={() => setCursor(startOfMonth(new Date()))}>
          Hoje
        </Button>
        <Box sx={{ flex: 1 }} />
        {noDate ? (
          <Typography variant="caption" color="text.secondary">
            {noDate} {noDate === 1 ? 'tarefa sem data' : 'tarefas sem data'} (não exibidas)
          </Typography>
        ) : null}
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', borderBottom: `1px solid ${colors.border}`, bgcolor: colors.subtle }}>
        {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((d) => (
          <Typography key={d} variant="overline" color="text.secondary" sx={{ px: 1.25, py: 0.75 }}>
            {d}
          </Typography>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
        {days.map((day) => {
          const key = isoDay(day)
          const tasks = byDay.get(key) ?? []
          const open = expanded === key
          const shown = open ? tasks : tasks.slice(0, MAX_VISIBLE)
          return (
            <Box
              key={key}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(key)
              }}
              onDragLeave={() => setDragOver((d) => (d === key ? null : d))}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(null)
                const id = e.dataTransfer.getData('text/plain')
                if (id) void ws.updateTask(id, { dueDate: key })
              }}
              sx={{
                minHeight: 118,
                p: 0.75,
                borderRight: `1px solid ${colors.border}`,
                borderBottom: `1px solid ${colors.border}`,
                bgcolor: dragOver === key ? alpha(colors.brand, 0.06) : isSameMonth(day, cursor) ? '#fff' : colors.subtle,
                '&:nth-of-type(7n)': { borderRight: 0 },
              }}
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
                {shown.map((t) => {
                  const status = ws.statuses.find((s) => s.id === t.status)
                  return (
                    <Box
                      key={t.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                      onClick={() => ws.openTask(t.id)}
                      title={t.title}
                      sx={{
                        px: 0.75,
                        py: 0.25,
                        borderRadius: 1,
                        borderLeft: `3px solid ${status?.color ?? colors.textMuted}`,
                        bgcolor: alpha(status?.color ?? colors.textMuted, 0.1),
                        fontSize: 11.5,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        cursor: 'grab',
                        textDecoration: t.completedAt ? 'line-through' : 'none',
                        opacity: t.completedAt ? 0.6 : 1,
                        '&:hover': { bgcolor: alpha(status?.color ?? colors.textMuted, 0.2) },
                      }}
                    >
                      {t.title}
                    </Box>
                  )
                })}
                {tasks.length > MAX_VISIBLE ? (
                  <Typography
                    variant="caption"
                    onClick={() => setExpanded(open ? null : key)}
                    sx={{ cursor: 'pointer', color: colors.brand, fontWeight: 600, px: 0.5 }}
                  >
                    {open ? 'Mostrar menos' : `+${tasks.length - MAX_VISIBLE} mais`}
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
