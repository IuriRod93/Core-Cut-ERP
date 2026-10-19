import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Alert, Box } from '@mui/material'
import { colors } from '../theme'

export interface MapMarker {
  id: string
  lat: number
  lng: number
  /** destino · pessoa da equipe · você */
  kind: 'dest' | 'person' | 'me' | 'punch'
  label?: string
}

const STYLE: Record<MapMarker['kind'], { bg: string; glyph: string }> = {
  dest: { bg: '#c0392b', glyph: '⚑' },
  person: { bg: colors.brand, glyph: '●' },
  me: { bg: '#2e7d4f', glyph: '◉' },
  punch: { bg: colors.brand, glyph: '●' },
}

const iconFor = (kind: MapMarker['kind']) =>
  L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:50%;background:${STYLE[kind].bg};color:#fff;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:grid;place-items:center;font-size:15px;font-weight:700">${STYLE[kind].glyph}</div>`,
  })

/**
 * Mapa do OpenStreetMap (Leaflet): marcadores, rota planejada e rastro percorrido.
 * Os blocos do mapa vêm de tile.openstreetmap.org, gratuito e sem chave de API.
 */
export default function MapView({
  markers,
  route,
  trail,
  height = 340,
  fit = true,
}: {
  markers: MapMarker[]
  /** rota por ruas, pontos [lat, lng] */
  route?: [number, number][]
  /** caminho já percorrido */
  trail?: [number, number][]
  height?: number
  fit?: boolean
}) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (!host.current || map.current) return
    const instance = L.map(host.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView([-22.9068, -43.1729], 12)
    // O OpenStreetMap só serve os blocos a quem se identifica pelo Referer. A política do sistema
    // (Referrer-Policy: same-origin) não o envia para outros sites, então só os blocos usam esta exceção.
    const tiles = L.tileLayer(import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      referrerPolicy: 'strict-origin-when-cross-origin',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    }).addTo(instance)
    let failures = 0
    tiles.on('tileerror', () => {
      failures += 1
      if (failures >= 4) setBlocked(true)
    })
    tiles.on('tileload', () => {
      failures = 0
      setBlocked(false)
    })
    layer.current = L.layerGroup().addTo(instance)
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
      layer.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    const group = layer.current
    if (!instance || !group) return
    group.clearLayers()
    const bounds: L.LatLngExpression[] = []
    if (route?.length) {
      L.polyline(route, { color: colors.brand, weight: 6, opacity: 0.85 }).addTo(group)
      bounds.push(...route)
    }
    if (trail && trail.length > 1) {
      L.polyline(trail, { color: '#2e7d4f', weight: 4, opacity: 0.9, dashArray: '2 8' }).addTo(group)
    }
    for (const m of markers) {
      const marker = L.marker([m.lat, m.lng], { icon: iconFor(m.kind), title: m.label }).addTo(group)
      if (m.label) marker.bindPopup(m.label)
      bounds.push([m.lat, m.lng])
    }
    if (fit && bounds.length) {
      if (bounds.length === 1) instance.setView(bounds[0], 16)
      else instance.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 17 })
    }
    // o contêiner pode ter mudado de tamanho (aba, diálogo)
    window.setTimeout(() => instance.invalidateSize(), 50)
  }, [markers, route, trail, fit])

  return (
    <Box>
      {blocked ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          O fornecedor do mapa não entregou as imagens agora (limite de uso ou sem internet). Os marcadores e a rota continuam valendo; use o Google Maps ou o Waze para navegar.
        </Alert>
      ) : null}
      <Box ref={host} role="region" aria-label="Mapa" sx={{ height, width: '100%', borderRadius: 2, overflow: 'hidden', border: `1px solid ${colors.border}`, zIndex: 0 }} />
    </Box>
  )
}
