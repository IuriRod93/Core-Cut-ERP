import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Box, Button, MenuItem, Paper, TextField, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { LoadingState } from '../components/ui'
import { useCollections } from '../lib/store'
import { PROJECT_PRIORITIES, optColor } from '../domain/constants'
import { fmtClock, fmtDuration, todayISO } from '../lib/format'
import { colors } from '../theme'
import { PAUSE_REASONS } from '../../shared/shopfloor.mjs'
import type { OpOperation, ProductionOrder, WorkCenter } from '../types'

const PRIORITY_RANK: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 }
const ACTIVE = ['liberada', 'em_producao']

type Item = { order: ProductionOrder; op: OpOperation }

/** Painel para TV do setor: o que está rodando, o que está parado (e por quê) e o que vem a seguir. Só leitura. */
export function ShopFloorBoardPage() {
  const [params, setParams] = useSearchParams()
  const sector = params.get('setor') ?? ''
  const { data, maps, loading } = useCollections(['productionOrders', 'workCenters', 'projects'] as const)
  const [now, setNow] = useState(Date.now())
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const centers = useMemo(() => data.workCenters.filter((w) => w.active).sort((a, b) => a.order - b.order), [data.workCenters])
  const shown = sector ? centers.filter((c) => c.id === sector) : centers

  const board = useMemo(() => {
    const by = new Map<string, { running: Item[]; paused: Item[]; next: Item[] }>()
    for (const c of centers) by.set(c.id, { running: [], paused: [], next: [] })
    for (const order of data.productionOrders) {
      if (!ACTIVE.includes(order.status)) continue
      const ops = [...order.operations].sort((a, b) => a.order - b.order)
      ops.forEach((op, i) => {
        const col = by.get(op.workCenterId)
        if (!col || op.status === 'concluida') return
        if (op.status === 'em_andamento') col.running.push({ order, op })
        else if (op.status === 'pausada') col.paused.push({ order, op })
        else if (!ops.slice(0, i).some((p) => p.status !== 'concluida')) col.next.push({ order, op })
      })
    }
    const rank = (a: Item, b: Item) => (PRIORITY_RANK[a.order.priority] ?? 9) - (PRIORITY_RANK[b.order.priority] ?? 9) || (a.order.dueDate ?? '9').localeCompare(b.order.dueDate ?? '9')
    for (const col of by.values()) col.next.sort(rank)
    return by
  }, [data.productionOrders, centers])

  const today = todayISO()
  const late = data.productionOrders.filter((o) => ACTIVE.includes(o.status) && o.dueDate && o.dueDate < today).length
  const doneToday = data.productionOrders.reduce((sum, o) => sum + o.operations.filter((op) => op.status === 'concluida' && (op.finishedAt ?? '').slice(0, 10) === today && (!sector || op.workCenterId === sector)).length, 0)

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.current?.requestFullscreen?.().catch(() => undefined)
  }

  if (loading && !data.workCenters.length) return <LoadingState />

  const elapsed = (op: OpOperation) => op.actualSeconds + (op.runningSince ? Math.max(0, (now - Date.parse(op.runningSince)) / 1000) : 0)
  const project = (o: ProductionOrder) => maps.projects.get(o.projectId ?? '')?.name ?? o.title

  return (
    <Box ref={root} sx={{ bgcolor: colors.bg, p: { xs: 1, md: 2 }, minHeight: '100%', overflow: 'auto' }}>
      <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <Typography sx={{ fontSize: { xs: '1.4rem', md: '2rem' }, fontWeight: 700 }}>{sector ? shown[0]?.name ?? 'Setor' : 'Chão de fábrica'}</Typography>
        <Typography sx={{ fontSize: { xs: '1.2rem', md: '1.8rem' }, fontVariantNumeric: 'tabular-nums', color: 'text.secondary' }}>{new Date(now).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Typography>
        <Box sx={{ flex: 1 }} />
        <Stat label="Concluídas hoje" value={doneToday} />
        <Stat label="Ordens atrasadas" value={late} tone={late ? colors.error : undefined} />
        <TextField select size="small" label="Setor" value={sector} onChange={(e) => setParams(e.target.value ? { setor: e.target.value } : {}, { replace: true })} sx={{ minWidth: 200, bgcolor: '#fff' }}>
          <MenuItem value="">Todos os setores</MenuItem>
          {centers.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" color="inherit" onClick={fullscreen}>
          Tela cheia
        </Button>
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: `repeat(${Math.min(Math.max(shown.length, 1), 4)}, minmax(0, 1fr))` } }}>
        {shown.map((c: WorkCenter) => {
          const col = board.get(c.id) ?? { running: [], paused: [], next: [] }
          const big = shown.length === 1
          return (
            <Paper key={c.id} variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: '#fff' }}>
              {!big ? <Typography sx={{ fontSize: '1.4rem', fontWeight: 700, mb: 1 }}>{c.name}</Typography> : null}

              <Section title="Em produção" count={col.running.length} color={colors.success} />
              {col.running.length ? null : <Empty text="Nenhuma etapa rodando" />}
              {col.running.map(({ order, op }) => {
                const over = op.plannedMinutes > 0 && elapsed(op) > op.plannedMinutes * 60
                return (
                  <Card key={order.id + op.id} priority={order.priority} highlight={colors.success}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 700, fontSize: big ? '1.5rem' : '1.1rem' }} noWrap>
                          {order.code} · {project(order)}
                        </Typography>
                        <Typography color="text.secondary" sx={{ fontSize: big ? '1.15rem' : '0.95rem' }} noWrap>
                          {op.operatorName || '—'} · previsto {fmtDuration(op.plannedMinutes * 60)}
                        </Typography>
                      </Box>
                      <Typography sx={{ fontSize: big ? '2.6rem' : '1.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: over ? colors.error : colors.text }}>{fmtClock(elapsed(op))}</Typography>
                    </Stack>
                  </Card>
                )
              })}

              <Section title="Paradas" count={col.paused.length} color={colors.warning} />
              {col.paused.length ? null : <Empty text="Nada parado" />}
              {col.paused.map(({ order, op }) => {
                const open = op.pauses?.find((p) => !p.end)
                const reason = open ? (PAUSE_REASONS.find((r) => r.value === open.reason)?.label ?? open.reason) : 'Pausada'
                return (
                  <Card key={order.id + op.id} priority={order.priority} highlight={colors.warning}>
                    <Typography sx={{ fontWeight: 700, fontSize: big ? '1.3rem' : '1.05rem' }} noWrap>
                      {order.code} · {project(order)}
                    </Typography>
                    <Typography sx={{ color: colors.warning, fontWeight: 600, fontSize: big ? '1.15rem' : '0.95rem' }} noWrap>
                      {reason}
                      {open ? ` · há ${fmtDuration((now - Date.parse(open.start)) / 1000)}` : ''}
                      {open?.note ? ` · ${open.note}` : ''}
                    </Typography>
                  </Card>
                )
              })}

              <Section title="Próximas" count={col.next.length} color={colors.brand} />
              {col.next.length ? null : <Empty text="Fila vazia" />}
              {col.next.slice(0, big ? 8 : 4).map(({ order, op }) => (
                <Card key={order.id + op.id} priority={order.priority}>
                  <Typography sx={{ fontWeight: 600, fontSize: big ? '1.2rem' : '1rem' }} noWrap>
                    {order.code} · {project(order)}
                  </Typography>
                  <Typography color="text.secondary" sx={{ fontSize: big ? '1.05rem' : '0.9rem' }} noWrap>
                    {op.name} · entrega {order.dueDate ? order.dueDate.split('-').reverse().slice(0, 2).join('/') : '—'}
                  </Typography>
                </Card>
              ))}
              {col.next.length > (big ? 8 : 4) ? (
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  +{col.next.length - (big ? 8 : 4)} na fila
                </Typography>
              ) : null}
            </Paper>
          )
        })}
      </Box>
    </Box>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Box sx={{ textAlign: 'right' }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1, color: tone ?? colors.text }}>{value}</Typography>
    </Box>
  )
}

function Section({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5, mb: 1 }}>
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: color }} />
      <Typography variant="overline" sx={{ fontWeight: 700, fontSize: '0.85rem' }}>
        {title} ({count})
      </Typography>
    </Stack>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <Typography color="text.secondary" sx={{ mb: 1, fontSize: '0.95rem' }}>
      {text}
    </Typography>
  )
}

function Card({ children, priority, highlight }: { children: React.ReactNode; priority: string; highlight?: string }) {
  return (
    <Box sx={{ p: 1.25, mb: 1, borderRadius: 2, border: `1px solid ${colors.border}`, borderLeft: `6px solid ${optColor(PROJECT_PRIORITIES, priority)}`, bgcolor: highlight ? alpha(highlight, 0.06) : '#fff' }}>
      {children}
    </Box>
  )
}
