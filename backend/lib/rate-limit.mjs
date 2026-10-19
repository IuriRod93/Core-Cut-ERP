/**
 * Limitador de requisições em memória (janela fixa por chave).
 * Suficiente para uma instância única atrás do Caddy; protege login, cadastro e a API
 * contra rajadas e força bruta sem depender de serviços externos.
 */
export function createRateLimiter({ now = () => Date.now() } = {}) {
  const buckets = new Map()

  /** Registra uma tentativa; devolve `{ ok, retryAfter }` (segundos) sem lançar erro. */
  function hit(key, max, windowMs) {
    const time = now()
    let bucket = buckets.get(key)
    if (!bucket || bucket.reset <= time) {
      bucket = { count: 0, reset: time + windowMs }
      buckets.set(key, bucket)
    }
    bucket.count += 1
    return { ok: bucket.count <= max, retryAfter: Math.max(1, Math.ceil((bucket.reset - time) / 1000)), count: bucket.count }
  }

  /** Remove janelas vencidas (chamado periodicamente). */
  function sweep() {
    const time = now()
    for (const [key, bucket] of buckets) if (bucket.reset <= time) buckets.delete(key)
  }

  return { hit, sweep, size: () => buckets.size }
}
