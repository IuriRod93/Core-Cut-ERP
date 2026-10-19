/**
 * Mapas e rotas com serviços gratuitos do OpenStreetMap, chamados pelo servidor (nunca pelo navegador):
 *  - Nominatim: endereço → coordenadas e coordenadas → endereço;
 *  - OSRM: rota por ruas entre dois pontos.
 * O servidor identifica o ERP no User-Agent (exigência do Nominatim), espaça as chamadas em 1 por segundo
 * e guarda as respostas em memória para não repetir consultas. Quando o provedor falha, devolve null.
 *
 * Endereços configuráveis: GEO_NOMINATIM_URL e GEO_OSRM_URL (útil em testes ou com servidor próprio).
 */
export const isLat = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90
export const isLng = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function createGeo({
  nominatimUrl = process.env.GEO_NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  osrmUrl = process.env.GEO_OSRM_URL || 'https://router.project-osrm.org',
  userAgent = process.env.GEO_USER_AGENT || 'CoreCutERP/1.0 (https://www.cutcore.com.br)',
  fetchImpl = fetch,
  timeoutMs = 8000,
  minGapMs = 1100,
  ttlMs = 7 * 24 * 3_600_000,
  maxEntries = 800,
} = {}) {
  const cache = new Map()
  let lastCall = 0
  let chain = Promise.resolve()
  const stats = { calls: 0, hits: 0, failures: 0 }

  const remember = (key, value) => {
    cache.set(key, { value, at: Date.now() })
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value)
  }
  const recall = (key) => {
    const hit = cache.get(key)
    if (!hit) return undefined
    if (Date.now() - hit.at > ttlMs) {
      cache.delete(key)
      return undefined
    }
    stats.hits += 1
    return hit.value
  }

  /** Executa as chamadas em fila, no máximo uma por `minGapMs` (política de uso do Nominatim). */
  const throttled = (task) => {
    const run = chain.then(async () => {
      const wait = lastCall + minGapMs - Date.now()
      if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      lastCall = Date.now()
      return task()
    })
    chain = run.catch(() => undefined)
    return run
  }

  const getJson = async (url) => {
    stats.calls += 1
    const response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return response.json()
  }

  async function geocode(query) {
    const q = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, 240)
    if (q.length < 4) return null
    const key = `g:${q.toLowerCase()}`
    const cached = recall(key)
    if (cached !== undefined) return cached
    try {
      const list = await throttled(() => getJson(`${nominatimUrl}/search?format=jsonv2&limit=1&addressdetails=0&countrycodes=br&q=${encodeURIComponent(q)}`))
      const first = Array.isArray(list) ? list[0] : null
      const result = first && isLat(Number(first.lat)) && isLng(Number(first.lon)) ? { lat: Number(first.lat), lng: Number(first.lon), label: String(first.display_name ?? q).slice(0, 240) } : null
      remember(key, result)
      return result
    } catch {
      stats.failures += 1
      return null
    }
  }

  async function reverse(lat, lng) {
    if (!isLat(lat) || !isLng(lng)) return null
    // ~11 m de resolução: pontos vizinhos reaproveitam a mesma consulta
    const key = `r:${lat.toFixed(4)},${lng.toFixed(4)}`
    const cached = recall(key)
    if (cached !== undefined) return cached
    try {
      const data = await throttled(() => getJson(`${nominatimUrl}/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`))
      const a = data?.address ?? {}
      const street = [a.road, a.house_number].filter(Boolean).join(', ')
      const place = [street, a.suburb ?? a.neighbourhood, a.city ?? a.town ?? a.village ?? a.municipality, a.state].filter(Boolean).join(' · ')
      const result = { label: String(place || data?.display_name || '').slice(0, 240) || null }
      remember(key, result)
      return result
    } catch {
      stats.failures += 1
      return null
    }
  }

  async function route(from, to) {
    if (![from?.lat, to?.lat].every(isLat) || ![from?.lng, to?.lng].every(isLng)) return null
    const key = `o:${from.lat.toFixed(4)},${from.lng.toFixed(4)}>${to.lat.toFixed(4)},${to.lng.toFixed(4)}`
    const cached = recall(key)
    if (cached !== undefined) return cached
    try {
      // OSRM não tem a regra de 1 chamada por segundo do Nominatim
      const data = await getJson(`${osrmUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=false`)
      const r = data?.routes?.[0]
      if (!r?.geometry?.coordinates?.length) return null
      let points = r.geometry.coordinates.map(([lng, lat]) => [lat, lng])
      if (points.length > 600) {
        const step = Math.ceil(points.length / 600)
        points = points.filter((_, i) => i % step === 0 || i === points.length - 1)
      }
      const result = { distanceM: Math.round(r.distance), durationS: Math.round(r.duration), points }
      remember(key, result)
      return result
    } catch {
      stats.failures += 1
      return null
    }
  }

  return { geocode, reverse, route, stats: () => ({ ...stats, cached: cache.size }) }
}
