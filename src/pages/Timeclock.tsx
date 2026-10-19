import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { addMonths, eachDayOfInterval, endOfMonth, format, isWeekend, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Alert, Box, Button, Grid, IconButton, Link, MenuItem, Paper, TextField, Tooltip, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { AccessTimeIcon, ChevronLeftIcon, ChevronRightIcon, LoginIcon, LogoutIcon } from '../components/icons'
import { EmptyState, LoadingState, PageHeader, Panel, StatCard } from '../components/ui'
import { useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { createDoc, updateDoc, useCollections } from '../lib/store'
import { api } from '../lib/api'
import { geoPermission, getPosition, osmLink } from '../lib/geo'
import { CLOCK_TYPES, optColor, optLabel } from '../domain/constants'
import { fmtClock, fmtHours, fmtTime, isoDay, todayISO } from '../lib/format'
import { isManagerRole } from '../../shared/access.mjs'
import { colors } from '../theme'
import type { ClockEntry } from '../types'
import type { MapMarker } from '../components/MapView'

const MapView = lazy(() => import('../components/MapView'))

const dayKey = (iso: string) => isoDay(new Date(iso))

/** Soma as horas trabalhadas de um dia: entrada/volta abrem, saída/saída p/ intervalo fecham. */
function workedSeconds(entries: ClockEntry[], now = Date.now()) {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at))
  let open: number | null = null
  let total = 0
  for (const e of sorted) {
    const t = new Date(e.at).getTime()
    if (e.type === 'entrada' || e.type === 'volta_intervalo') open = open ?? t
    else if (open !== null) {
      total += (t - open) / 1000
      open = null
    }
  }
  if (open !== null) total += Math.max(0, (now - open) / 1000)
  return total
}

const nextType = (entries: ClockEntry[]): ClockEntry['type'] => {
  const last = [...entries].sort((a, b) => a.at.localeCompare(b.at)).at(-1)
  if (!last || last.type === 'saida') return 'entrada'
  if (last.type === 'entrada') return 'saida_intervalo'
  if (last.type === 'saida_intervalo') return 'volta_intervalo'
  return 'saida'
}

export function TimeclockPage() {
  const { user } = useAuth()
  const toast = useToast()
  const manager = isManagerRole(user?.role ?? '')
  const { data, loading } = useCollections(['timeclock', 'users'] as const)
  const [now, setNow] = useState(Date.now())
  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [target, setTarget] = useState(user?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [permission, setPermission] = useState<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt')

  useEffect(() => {
    void geoPermission().then(setPermission)
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const mine = data.timeclock.filter((e) => e.userId === user?.id)
  const today = todayISO()
  const todayEntries = mine.filter((e) => dayKey(e.at) === today).sort((a, b) => a.at.localeCompare(b.at))
  const next = nextType(todayEntries)
  const workedToday = workedSeconds(todayEntries, now)

  const punch = async (type: ClockEntry['type']) => {
    if (busy) return
    setBusy(true)
    try {
      // a posição entra no registro; sem permissão ou sem sinal o ponto é registrado do mesmo jeito
      const geo = await getPosition(8000)
      setPermission(await geoPermission())
      const at = new Date().toISOString()
      const doc = await createDoc('timeclock', { userId: user!.id, type, at, locationStatus: geo.status, ...(geo.fix ?? {}) })
      toast.success(`${optLabel(CLOCK_TYPES, type)} registrada às ${fmtTime(at)}${geo.fix ? ' · localização registrada' : ''}.`)
      if (geo.fix) {
        // endereço legível (não bloqueia o registro)
        void api
          .get<{ label: string | null }>(`/geo/reverse?lat=${geo.fix.lat}&lng=${geo.fix.lng}`)
          .then((r) => (r.label ? updateDoc('timeclock', doc.id, { place: r.label }) : undefined))
          .catch(() => undefined)
      } else if (geo.status === 'denied') {
        toast.warning('Ponto registrado sem localização: a permissão está bloqueada neste aparelho.')
      }
    } finally {
      setBusy(false)
    }
  }

  // gestores: onde cada pessoa bateu o ponto hoje
  const todayMarkers = useMemo<MapMarker[]>(() => {
    const names = new Map(data.users.map((u) => [u.id, u.name]))
    return data.timeclock
      .filter((e) => dayKey(e.at) === today && typeof e.lat === 'number' && typeof e.lng === 'number')
      .map((e) => ({ id: e.id, kind: 'punch' as const, lat: e.lat!, lng: e.lng!, label: `${names.get(e.userId) ?? 'Colaborador'} · ${optLabel(CLOCK_TYPES, e.type)} ${fmtTime(e.at)}` }))
  }, [data.timeclock, data.users, today])

  const viewUser = manager ? target || user?.id || '' : user?.id ?? ''
  const monthDays = useMemo(() => eachDayOfInterval({ start: month, end: endOfMonth(month) }), [month])
  const sheet = useMemo(() => {
    const rows = monthDays.map((d) => {
      const key = isoDay(d)
      const entries = data.timeclock.filter((e) => e.userId === viewUser && dayKey(e.at) === key)
      return { day: d, key, entries, seconds: workedSeconds(entries, now) }
    })
    return { rows, total: rows.reduce((s, r) => s + r.seconds, 0), daysWorked: rows.filter((r) => r.seconds > 0).length }
  }, [monthDays, data.timeclock, viewUser, now])

  if (loading) return <LoadingState />

  const labelFor = (t: ClockEntry['type']) => optLabel(CLOCK_TYPES, t)

  return (
    <Box>
      <PageHeader title="Ponto" subtitle="Registro de jornada com entrada, intervalo e saída — e espelho de ponto mensal." />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, textAlign: 'center' }}>
            <Typography variant="overline" color="text.secondary">
              {format(new Date(now), "EEEE, d 'de' MMMM", { locale: ptBR })}
            </Typography>
            <Typography sx={{ fontSize: '3rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', color: colors.brand, lineHeight: 1.15 }}>
              {format(new Date(now), 'HH:mm:ss')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Trabalhado hoje: <strong>{fmtClock(workedToday)}</strong>
            </Typography>
            {permission === 'denied' ? (
              <Alert severity="warning" sx={{ mb: 2, textAlign: 'left' }}>
                A localização está bloqueada neste aparelho: o ponto é registrado sem o local. Libere nas permissões do navegador (cadeado ao lado do endereço).
              </Alert>
            ) : null}
            <Button
              fullWidth
              size="large"
              variant="contained"
              disabled={busy}
              startIcon={next === 'entrada' || next === 'volta_intervalo' ? <LoginIcon /> : <LogoutIcon />}
              onClick={() => punch(next)}
              sx={{ py: 1.5, fontSize: '1rem' }}
            >
              {busy ? 'Obtendo localização…' : `Registrar ${labelFor(next).toLowerCase()}`}
            </Button>
            <Stack direction="row" spacing={1} justifyContent="center" sx={{ mt: 1.5, flexWrap: 'wrap' }}>
              {CLOCK_TYPES.filter((t) => t.value !== next).map((t) => (
                <Button key={t.value} size="small" variant="text" color="inherit" onClick={() => punch(t.value as ClockEntry['type'])} sx={{ color: 'text.secondary' }}>
                  {t.label}
                </Button>
              ))}
            </Stack>
          </Paper>
          <Panel title="Registros de hoje" sx={{ mt: 2.5 }}>
            {todayEntries.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Nenhum registro hoje.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {todayEntries.map((e) => (
                  <Stack key={e.id} direction="row" spacing={1.5} alignItems="center">
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: optColor(CLOCK_TYPES, e.type) }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2">{labelFor(e.type)}</Typography>
                      {typeof e.lat === 'number' && typeof e.lng === 'number' ? (
                        <Typography variant="caption" color="text.secondary" component="div" noWrap>
                          📍 {e.place ?? `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}`} ·{' '}
                          <Link href={osmLink(e.lat, e.lng)} target="_blank" rel="noreferrer">
                            ver no mapa
                          </Link>
                        </Typography>
                      ) : (
                        <Typography variant="caption" color="text.disabled" component="div">
                          {e.locationStatus === 'denied' ? 'localização bloqueada' : 'sem localização'}
                        </Typography>
                      )}
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtTime(e.at)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          {manager && todayMarkers.length ? (
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
              <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Onde bateram o ponto hoje ({todayMarkers.length})
              </Typography>
              <Suspense fallback={<Box sx={{ height: 260 }} />}>
                <MapView markers={todayMarkers} height={260} />
              </Suspense>
            </Paper>
          ) : null}
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
            <IconButton onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Mês anterior">
              <ChevronLeftIcon />
            </IconButton>
            <Typography variant="h5" sx={{ textTransform: 'capitalize', minWidth: 170, textAlign: 'center' }}>
              {format(month, "MMMM 'de' yyyy", { locale: ptBR })}
            </Typography>
            <IconButton onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Próximo mês">
              <ChevronRightIcon />
            </IconButton>
            <Box sx={{ flex: 1 }} />
            {manager ? (
              <TextField select label="Colaborador" value={viewUser} onChange={(e) => setTarget(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 230 } }}>
                {data.users.filter((u) => u.active !== false).map((u) => (
                  <MenuItem key={u.id} value={u.id}>
                    {u.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={4}>
              <StatCard label="Horas no mês" value={fmtHours(sheet.total / 3600)} icon={<AccessTimeIcon />} tone="brand" />
            </Grid>
            <Grid size={4}>
              <StatCard label="Dias trabalhados" value={sheet.daysWorked} />
            </Grid>
            <Grid size={4}>
              <StatCard label="Média diária" value={sheet.daysWorked ? fmtHours(sheet.total / 3600 / sheet.daysWorked) : '—'} />
            </Grid>
          </Grid>
          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '90px 1fr 100px', px: 2, py: 1, bgcolor: colors.subtle, borderBottom: `1px solid ${colors.border}` }}>
              {['Dia', 'Marcações', 'Total'].map((h, i) => (
                <Typography key={h} variant="overline" color="text.secondary" sx={{ textAlign: i === 2 ? 'right' : 'left' }}>
                  {h}
                </Typography>
              ))}
            </Box>
            {sheet.rows.length === 0 ? (
              <EmptyState title="Sem dados" />
            ) : (
              sheet.rows.map((r) => (
                <Box
                  key={r.key}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '90px 1fr 100px',
                    px: 2,
                    py: 0.9,
                    alignItems: 'center',
                    borderBottom: `1px solid ${colors.border}`,
                    bgcolor: isWeekend(r.day) ? alpha(colors.text, 0.025) : 'transparent',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                    {format(r.day, 'dd · EEE', { locale: ptBR })}
                  </Typography>
                  <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                    {r.entries.length === 0 ? (
                      <Typography variant="caption" color="text.disabled">
                        —
                      </Typography>
                    ) : (
                      [...r.entries]
                        .sort((a, b) => a.at.localeCompare(b.at))
                        .map((e) => (
                          <Tooltip key={e.id} title={typeof e.lat === 'number' ? e.place ?? `${e.lat?.toFixed(4)}, ${e.lng?.toFixed(4)}` : 'sem localização'}>
                            <Box
                              component={typeof e.lat === 'number' && typeof e.lng === 'number' ? 'a' : 'div'}
                              {...(typeof e.lat === 'number' && typeof e.lng === 'number' ? { href: osmLink(e.lat, e.lng), target: '_blank', rel: 'noreferrer' } : {})}
                              sx={{ fontSize: 12, px: 0.75, py: 0.1, borderRadius: 1, bgcolor: alpha(optColor(CLOCK_TYPES, e.type), 0.12), color: optColor(CLOCK_TYPES, e.type), fontWeight: 700, fontVariantNumeric: 'tabular-nums', textDecoration: 'none' }}
                            >
                              {typeof e.lat === 'number' ? '📍 ' : ''}
                              {fmtTime(e.at)}
                            </Box>
                          </Tooltip>
                        ))
                    )}
                  </Stack>
                  <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {r.seconds ? fmtHours(r.seconds / 3600) : ''}
                  </Typography>
                </Box>
              ))
            )}
          </Paper>
        </Grid>
      </Grid>
    </Box>
  )
}
