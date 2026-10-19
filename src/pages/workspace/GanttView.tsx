import { useMemo, useRef, useState } from 'react'
import { addDays, differenceInCalendarDays, eachDayOfInterval, format, isToday, isWeekend, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Box, Button, ToggleButton, ToggleButtonGroup, Typography, alpha } from '@mui/material'
import { Stack } from '../../components/Stack'
import { useWorkspace } from './useWorkspace'
import { isoDay, toDate } from '../../lib/format'
import { isDoneStatus, progressOf, subtasksOf } from '../../domain/tasks'
import { colors } from '../../theme'
import type { Task } from '../../types'

const ROW = 38
const LABEL_W = 280
const ZOOMS = { dia: 34, semana: 16, mes: 6 } as const

interface Bar {
  task: Task
  start: Date
  end: Date
  derived: boolean
}

function barOf(t: Task): Bar | null {
  const due = toDate(t.dueDate)
  const start = toDate(t.startDate)
  if (!due && !start) return null
  const s = start ?? due!
  let e = due ?? start!
  if (e < s) e = s
  return { task: t, start: s, end: e, derived: !start || !due }
}

export function GanttView() {
  const ws = useWorkspace()
  const [zoom, setZoom] = useState<keyof typeof ZOOMS>('dia')
  const dayW = ZOOMS[zoom]
  const drag = useRef<{ id: string; mode: 'move' | 'resize'; x: number; origStart: Date; origEnd: Date } | null>(null)
  const [preview, setPreview] = useState<{ id: string; start: Date; end: Date } | null>(null)

  const rows = useMemo(() => {
    const items: ({ kind: 'list'; id: string; name: string; color: string } | { kind: 'task'; bar: Bar | null; task: Task })[] = []
    for (const l of ws.lists) {
      const tasks = ws.filtered.filter((t) => t.listId === l.id && !t.parentId).sort((a, b) => (a.startDate ?? a.dueDate ?? '9').localeCompare(b.startDate ?? b.dueDate ?? '9') || a.order - b.order)
      if (!tasks.length) continue
      items.push({ kind: 'list', id: l.id, name: l.name, color: l.color ?? '#8b8f98' })
      tasks.forEach((t) => items.push({ kind: 'task', bar: barOf(t), task: t }))
    }
    return items
  }, [ws.lists, ws.filtered])

  const bars = rows.flatMap((r) => (r.kind === 'task' && r.bar ? [r.bar] : []))
  const { rangeStart, rangeEnd } = useMemo(() => {
    const dates = bars.flatMap((b) => [b.start, b.end])
    const p = toDate(ws.project.startDate)
    const q = toDate(ws.project.dueDate)
    if (p) dates.push(p)
    if (q) dates.push(q)
    dates.push(new Date())
    const min = new Date(Math.min(...dates.map((d) => d.getTime())))
    const max = new Date(Math.max(...dates.map((d) => d.getTime())))
    return { rangeStart: addDays(startOfMonth(min), 0), rangeEnd: addDays(max, 21) }
  }, [bars, ws.project.startDate, ws.project.dueDate])

  const days = useMemo(() => eachDayOfInterval({ start: rangeStart, end: rangeEnd }), [rangeStart, rangeEnd])
  const width = days.length * dayW
  const x = (d: Date) => differenceInCalendarDays(d, rangeStart) * dayW

  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = []
    days.forEach((d, i) => {
      if (i === 0 || d.getDate() === 1) out.push({ label: format(d, 'MMM yyyy', { locale: ptBR }), left: i * dayW, width: 0 })
      out[out.length - 1].width += dayW
    })
    return out
  }, [days, dayW])

  const rowIndex = new Map<string, number>()
  rows.forEach((r, i) => r.kind === 'task' && rowIndex.set(r.task.id, i))

  const onPointerDown = (e: React.PointerEvent, bar: Bar, mode: 'move' | 'resize') => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: bar.task.id, mode, x: e.clientX, origStart: bar.start, origEnd: bar.end }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const delta = Math.round((e.clientX - d.x) / dayW)
    if (d.mode === 'move') setPreview({ id: d.id, start: addDays(d.origStart, delta), end: addDays(d.origEnd, delta) })
    else setPreview({ id: d.id, start: d.origStart, end: addDays(d.origEnd, Math.max(delta, -differenceInCalendarDays(d.origEnd, d.origStart))) })
  }
  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (!d || !preview || preview.id !== d.id) return setPreview(null)
    const moved = preview.start.getTime() !== d.origStart.getTime() || preview.end.getTime() !== d.origEnd.getTime()
    if (moved) void ws.updateTask(d.id, { startDate: isoDay(preview.start), dueDate: isoDay(preview.end) })
    setPreview(null)
  }

  const todayX = x(new Date()) + dayW / 2
  const hasAny = bars.length > 0

  if (!rows.length)
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
        Nenhuma tarefa para exibir no cronograma.
      </Typography>
    )

  return (
    <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 3, bgcolor: '#fff', overflow: 'hidden' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1, borderBottom: `1px solid ${colors.border}` }}>
        <ToggleButtonGroup size="small" exclusive value={zoom} onChange={(_, v) => v && setZoom(v)}>
          <ToggleButton value="dia">Dia</ToggleButton>
          <ToggleButton value="semana">Semana</ToggleButton>
          <ToggleButton value="mes">Mês</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          Arraste uma barra para reprogramar · puxe a ponta direita para alterar o prazo · setas indicam dependências
        </Typography>
        <Button
          size="small"
          onClick={(e) => {
            const scroller = (e.currentTarget.closest('[data-gantt]') as HTMLElement)?.querySelector('[data-scroll]') as HTMLElement | null
            scroller?.scrollTo({ left: Math.max(todayX - 200, 0), behavior: 'smooth' })
          }}
        >
          Ir para hoje
        </Button>
      </Stack>
      <Box data-gantt sx={{ display: 'flex' }}>
        <Box sx={{ width: LABEL_W, flexShrink: 0, borderRight: `1px solid ${colors.border}`, bgcolor: '#fff', zIndex: 2 }}>
          <Box sx={{ height: 52, borderBottom: `1px solid ${colors.border}`, bgcolor: colors.subtle, display: 'flex', alignItems: 'flex-end', px: 1.5, pb: 0.75 }}>
            <Typography variant="overline" color="text.secondary">
              Tarefa
            </Typography>
          </Box>
          {rows.map((r) =>
            r.kind === 'list' ? (
              <Box key={r.id} sx={{ height: ROW, px: 1.5, display: 'flex', alignItems: 'center', bgcolor: alpha(r.color, 0.08), borderBottom: `1px solid ${colors.border}` }}>
                <Typography variant="subtitle2" noWrap>
                  {r.name}
                </Typography>
              </Box>
            ) : (
              <Box
                key={r.task.id}
                onClick={() => ws.openTask(r.task.id)}
                sx={{ height: ROW, px: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { bgcolor: colors.subtle } }}
              >
                <Typography variant="body2" noWrap sx={{ textDecoration: r.task.completedAt ? 'line-through' : 'none' }}>
                  {r.task.title}
                </Typography>
              </Box>
            ),
          )}
        </Box>
        <Box data-scroll sx={{ flex: 1, overflowX: 'auto', position: 'relative' }}>
          <Box sx={{ width, position: 'relative' }} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
            <Box sx={{ height: 52, position: 'sticky', top: 0, bgcolor: colors.subtle, borderBottom: `1px solid ${colors.border}`, zIndex: 1 }}>
              <Box sx={{ position: 'relative', height: 26 }}>
                {months.map((m) => (
                  <Typography key={m.left} variant="caption" sx={{ position: 'absolute', left: m.left + 6, top: 4, fontWeight: 700, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>
                    {m.label}
                  </Typography>
                ))}
              </Box>
              <Box sx={{ position: 'relative', height: 26 }}>
                {zoom !== 'mes'
                  ? days.map((d, i) =>
                      zoom === 'dia' || d.getDay() === 1 ? (
                        <Typography key={i} variant="caption" sx={{ position: 'absolute', left: i * dayW, width: dayW * (zoom === 'dia' ? 1 : 7), textAlign: zoom === 'dia' ? 'center' : 'left', pl: zoom === 'dia' ? 0 : 0.5, color: isToday(d) ? colors.brand : colors.textMuted, fontWeight: isToday(d) ? 800 : 500, fontSize: 10.5 }}>
                          {format(d, 'd')}
                        </Typography>
                      ) : null,
                    )
                  : null}
              </Box>
            </Box>

            {zoom === 'dia'
              ? days.map((d, i) =>
                  isWeekend(d) ? <Box key={i} sx={{ position: 'absolute', top: 52, bottom: 0, left: i * dayW, width: dayW, bgcolor: alpha(colors.text, 0.025) }} /> : null,
                )
              : null}
            <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: todayX, width: 2, bgcolor: alpha(colors.brand, 0.6), zIndex: 1 }} />

            {rows.map((r, i) => {
              const top = 52 + i * ROW
              if (r.kind === 'list') return <Box key={r.id} sx={{ position: 'absolute', top, left: 0, right: 0, height: ROW, bgcolor: alpha(r.color, 0.06), borderBottom: `1px solid ${colors.border}` }} />
              const bar = r.bar
              const pv = preview?.id === r.task.id ? preview : null
              const start = pv?.start ?? bar?.start
              const end = pv?.end ?? bar?.end
              const status = ws.statuses.find((s) => s.id === r.task.status)
              const color = status?.color ?? colors.brand
              const subs = subtasksOf(ws.tasks, r.task.id)
              const prog = subs.length ? progressOf(subs, ws.statuses) : isDoneStatus(ws.statuses, r.task.status) ? 100 : 0
              return (
                <Box key={r.task.id} sx={{ position: 'absolute', top, left: 0, right: 0, height: ROW, borderBottom: `1px solid ${colors.border}` }}>
                  {bar && start && end ? (
                    r.task.milestone ? (
                      <Box
                        onClick={() => ws.openTask(r.task.id)}
                        title={r.task.title}
                        sx={{ position: 'absolute', left: x(end) + dayW / 2 - 9, top: 10, width: 18, height: 18, bgcolor: colors.brand, transform: 'rotate(45deg)', borderRadius: 0.5, cursor: 'pointer' }}
                      />
                    ) : (
                      <Box
                        onPointerDown={(e) => onPointerDown(e, bar, 'move')}
                        onClick={() => ws.openTask(r.task.id)}
                        title={`${r.task.title} · ${format(start, 'dd/MM')} → ${format(end, 'dd/MM')}`}
                        sx={{
                          position: 'absolute',
                          left: x(start),
                          width: Math.max((differenceInCalendarDays(end, start) + 1) * dayW, 10),
                          top: 7,
                          height: 24,
                          borderRadius: 1.5,
                          bgcolor: alpha(color, 0.25),
                          border: `1px solid ${color}`,
                          cursor: 'grab',
                          overflow: 'hidden',
                          touchAction: 'none',
                          opacity: bar.derived ? 0.75 : 1,
                          userSelect: 'none',
                        }}
                      >
                        <Box sx={{ position: 'absolute', inset: 0, width: `${prog}%`, bgcolor: alpha(color, 0.55) }} />
                        <Typography variant="caption" noWrap sx={{ position: 'relative', px: 0.75, fontWeight: 700, lineHeight: '22px', color: colors.text }}>
                          {zoom === 'mes' ? '' : r.task.title}
                        </Typography>
                        <Box
                          onPointerDown={(e) => onPointerDown(e, bar, 'resize')}
                          sx={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 7, cursor: 'ew-resize', bgcolor: alpha(color, 0.5) }}
                        />
                      </Box>
                    )
                  ) : null}
                </Box>
              )
            })}

            <svg width={width} height={52 + rows.length * ROW} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 1 }}>
              {rows.flatMap((r) => {
                if (r.kind !== 'task' || !r.bar) return []
                const rb = r.bar
                return (r.task.dependsOn ?? []).flatMap((depId) => {
                  const fromRow = rowIndex.get(depId)
                  const dep = rows[fromRow ?? -1]
                  if (fromRow === undefined || !dep || dep.kind !== 'task' || !dep.bar) return []
                  const x1 = x(dep.bar.end) + dayW
                  const y1 = 52 + fromRow * ROW + ROW / 2
                  const x2 = x(rb.start)
                  const y2 = 52 + (rowIndex.get(r.task.id) ?? 0) * ROW + ROW / 2
                  const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 12))
                  return [
                    <path key={`${depId}-${r.task.id}`} d={`M${x1} ${y1} H${mid} V${y2} H${x2}`} fill="none" stroke={colors.textMuted} strokeWidth={1.4} markerEnd="url(#arrow)" />,
                  ]
                })
              })}
              <defs>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L8 4 L0 8 z" fill={colors.textMuted} />
                </marker>
              </defs>
            </svg>
            {!hasAny ? (
              <Typography variant="body2" color="text.secondary" sx={{ position: 'absolute', top: 70, left: 20 }}>
                Defina datas de início e entrega nas tarefas para vê-las no cronograma.
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
