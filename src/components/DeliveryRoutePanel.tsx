import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Link, Typography } from '@mui/material'
import { Stack } from './Stack'
import { useToast } from './feedback'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { updateDoc } from '../lib/store'
import { fmtDistance, fmtDuration, googleRouteLink, watchPosition, wazeLink, type GeoFix } from '../lib/geo'
import { fmtRelative } from '../lib/format'
import { colors } from '../theme'
import type { Installation } from '../types'
import type { MapMarker } from './MapView'

const MapView = lazy(() => import('./MapView'))

interface RouteInfo {
  found: boolean
  distanceM?: number
  durationS?: number
  points?: [number, number][]
}

const SEND_EVERY_MS = 20_000
const REROUTE_METERS = 150

const meters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Rota da entrega/instalação no mapa: destino pelo endereço, posição do funcionário em tempo quase real
 * (enquanto ele mantém o rastreamento ligado), caminho percorrido e distância/tempo até o destino.
 */
export function DeliveryRoutePanel({ id }: { id: string }) {
  const toast = useToast()
  const { user } = useAuth()
  const [job, setJob] = useState<Installation | null>(null)
  const [route, setRoute] = useState<RouteInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [mine, setMine] = useState<GeoFix | null>(null)
  const [problem, setProblem] = useState('')
  const lastSent = useRef(0)
  const routedFrom = useRef<GeoFix | null>(null)

  const load = useCallback(async () => {
    try {
      setJob(await api.get<Installation>(`/data/installations/${id}`))
    } catch {
      /* mantém o último estado */
    }
  }, [id])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 12_000)
    return () => window.clearInterval(timer)
  }, [load])

  const canTrack = Boolean(job && user && ((job.teamIds ?? []).includes(user.id) || user.role === 'admin' || user.role === 'gerente'))
  const dest = job && typeof job.destLat === 'number' && typeof job.destLng === 'number' ? { lat: job.destLat, lng: job.destLng } : null
  const person = tracking && mine ? mine : job?.lastLocation ? { lat: job.lastLocation.lat, lng: job.lastLocation.lng } : null

  // rota por ruas: recalcula quando a pessoa se afasta do ponto usado antes
  useEffect(() => {
    if (!dest || !person) return
    const from = routedFrom.current
    if (from && meters(from, person) < REROUTE_METERS && route?.found) return
    routedFrom.current = { lat: person.lat, lng: person.lng }
    api
      .get<RouteInfo>(`/geo/route?fromLat=${person.lat}&fromLng=${person.lng}&toLat=${dest.lat}&toLng=${dest.lng}`)
      .then(setRoute)
      .catch(() => setRoute({ found: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dest?.lat, dest?.lng, person?.lat, person?.lng])

  // envio da posição enquanto o rastreamento estiver ligado
  useEffect(() => {
    if (!tracking) return
    const stop = watchPosition(
      (fix) => {
        setMine(fix)
        setProblem('')
        const now = Date.now()
        if (now - lastSent.current < SEND_EVERY_MS) return
        lastSent.current = now
        void api.post(`/installations/${id}/track`, fix).catch(() => undefined)
      },
      (status) => {
        setProblem(status === 'denied' ? 'A localização está bloqueada neste aparelho. Libere nas permissões do navegador para acompanhar a rota.' : 'Sem sinal de GPS no momento. Tentando de novo…')
        if (status === 'denied') setTracking(false)
      },
    )
    return stop
  }, [tracking, id])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }

  const locate = () =>
    run(async () => {
      const updated = await api.post<Installation>(`/installations/${id}/destination`, {})
      setJob(updated)
      routedFrom.current = null
      toast.success('Destino localizado no mapa.')
    })

  const start = () =>
    run(async () => {
      if (job?.status !== 'em_rota') await updateDoc('installations', id, { status: 'em_rota' })
      lastSent.current = 0
      setTracking(true)
      await load()
    })

  const arrive = () =>
    run(async () => {
      setTracking(false)
      await updateDoc('installations', id, { status: 'em_andamento' })
      await load()
      toast.success('Chegada registrada.')
    })

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = []
    if (dest) list.push({ id: 'dest', kind: 'dest', lat: dest.lat, lng: dest.lng, label: job?.destLabel || 'Destino' })
    if (person) {
      const who = tracking ? 'Você' : job?.lastLocation?.userName ?? 'Equipe'
      list.push({ id: 'person', kind: tracking ? 'me' : 'person', lat: person.lat, lng: person.lng, label: who })
    }
    return list
  }, [dest, person, tracking, job?.destLabel, job?.lastLocation?.userName])

  const trail = useMemo(() => (job?.track ?? []).map((p) => [p.lat, p.lng] as [number, number]), [job?.track])

  if (!job) {
    return (
      <Box sx={{ py: 3, textAlign: 'center' }}>
        <CircularProgress size={22} />
      </Box>
    )
  }

  const lastAge = job.lastLocation ? Date.now() - Date.parse(job.lastLocation.at) : null
  const live = lastAge !== null && lastAge < 3 * 60_000

  return (
    <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 2, p: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.75 }}>
        <Typography variant="overline" color="primary">
          Rota e localização
        </Typography>
        {job.status === 'em_rota' ? <Chip size="small" color="primary" label="Em rota" /> : null}
        {job.lastLocation ? (
          <Chip size="small" variant="outlined" color={live ? 'success' : 'default'} label={`${job.lastLocation.userName ?? 'Equipe'} · ${live ? 'ao vivo' : fmtRelative(job.lastLocation.at)}`} />
        ) : null}
        {route?.found && route.distanceM !== undefined ? <Chip size="small" label={`${fmtDistance(route.distanceM)} · ${fmtDuration(route.durationS ?? 0)}`} /> : null}
      </Stack>

      {problem ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {problem}
        </Alert>
      ) : null}

      {dest || person ? (
        <Suspense fallback={<Box sx={{ height: 340, display: 'grid', placeItems: 'center' }}><CircularProgress size={22} /></Box>}>
          <MapView markers={markers} route={route?.found ? route.points : undefined} trail={trail} />
        </Suspense>
      ) : (
        <Alert severity="info">
          Ainda não há destino no mapa. {job.address || job.projectId ? 'Clique em “Localizar endereço” para marcar o destino.' : 'Informe o endereço do agendamento e salve.'}
        </Alert>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
        <Button size="small" variant="outlined" disabled={busy} onClick={locate}>
          {dest ? 'Atualizar destino' : 'Localizar endereço'}
        </Button>
        {canTrack && !tracking ? (
          <Button size="small" variant="contained" disabled={busy || !dest} onClick={start}>
            Iniciar rota e compartilhar localização
          </Button>
        ) : null}
        {tracking ? (
          <>
            <Button size="small" color="success" variant="contained" disabled={busy} onClick={arrive}>
              Cheguei ao local
            </Button>
            <Button size="small" color="inherit" onClick={() => setTracking(false)}>
              Parar rastreamento
            </Button>
          </>
        ) : null}
        {dest ? (
          <>
            <Link href={googleRouteLink(dest.lat, dest.lng)} target="_blank" rel="noreferrer" variant="body2" sx={{ alignSelf: 'center' }}>
              Navegar no Google Maps
            </Link>
            <Link href={wazeLink(dest.lat, dest.lng)} target="_blank" rel="noreferrer" variant="body2" sx={{ alignSelf: 'center' }}>
              Waze
            </Link>
          </>
        ) : null}
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        A posição só é enviada enquanto o rastreamento estiver ligado e esta tela aberta no aparelho do funcionário. Mapa © OpenStreetMap.
      </Typography>
    </Box>
  )
}
