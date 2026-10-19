/** Localização do aparelho (com a permissão da pessoa) e utilidades de mapa. */

export interface GeoFix {
  lat: number
  lng: number
  accuracy?: number
}

export type GeoResult = { status: 'granted'; fix: GeoFix } | { status: 'denied' | 'unavailable'; fix?: undefined }

export const geoSupported = () => typeof navigator !== 'undefined' && 'geolocation' in navigator

/** Estado da permissão sem abrir o aviso do navegador ('prompt' quando ainda não foi decidido). */
export async function geoPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (!geoSupported()) return 'unsupported'
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return status.state
  } catch {
    return 'prompt'
  }
}

/** Posição atual. Nunca lança: devolve 'denied' (pessoa negou) ou 'unavailable' (sem sinal, tempo esgotado). */
export function getPosition(timeoutMs = 10000): Promise<GeoResult> {
  if (!geoSupported()) return Promise.resolve({ status: 'unavailable' })
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ status: 'granted', fix: { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy } }),
      (e) => resolve({ status: e.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    )
  })
}

/** Observa a posição enquanto a tela estiver aberta. Devolve a função que para a observação. */
export function watchPosition(onFix: (fix: GeoFix) => void, onError?: (status: 'denied' | 'unavailable') => void): () => void {
  if (!geoSupported()) {
    onError?.('unavailable')
    return () => undefined
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
    (e) => onError?.(e.code === 1 ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
  )
  return () => navigator.geolocation.clearWatch(id)
}

export const osmLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`
export const googleRouteLink = (lat: number, lng: number) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`
export const wazeLink = (lat: number, lng: number) => `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`

export const fmtDistance = (meters: number) => (meters >= 1000 ? `${(meters / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(meters)} m`)
export const fmtDuration = (seconds: number) => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${Math.max(minutes, 1)} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}
