import { monitorEventLoopDelay } from 'node:perf_hooks'

/**
 * Métricas leves em memória para o monitoramento do Painel Admin:
 * requisições por classe de status, latência, rotas mais lentas, erros recentes e bloqueios.
 * Zeram ao reiniciar o servidor (o Painel mostra há quanto tempo está no ar).
 */
export function createMetrics({ now = () => Date.now(), keep = 8000, keepErrors = 60, keepClientErrors = 40 } = {}) {
  const startedAt = now()
  const samples = []
  const errors = []
  const clientErrors = []
  const counters = { blocked: 0, loginFailures: 0, loginSuccess: 0, started: startedAt }
  const loop = monitorEventLoopDelay({ resolution: 20 })
  loop.enable()

  const normalize = (method, path) =>
    `${method} ${String(path)
      .split('?')[0]
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
      .replace(/\/[0-9a-f]{24,}/gi, '/:id')
      .replace(/\/cs_[A-Za-z0-9_]+/g, '/:id')}`

  /** Registra uma requisição concluída. */
  function record({ method, path, status, ms }) {
    samples.push({ t: now(), status, ms, route: normalize(method, path) })
    if (samples.length > keep) samples.splice(0, samples.length - keep)
  }

  /** Registra um erro interno (HTTP 500). */
  function recordError({ method, path, message }) {
    errors.push({ at: new Date(now()).toISOString(), route: normalize(method, path), message: String(message).slice(0, 240) })
    if (errors.length > keepErrors) errors.splice(0, errors.length - keepErrors)
  }

  /**
   * Erro ocorrido no navegador de um usuário (tela que quebrou, exceção de script).
   * Mensagens iguais na mesma tela são agrupadas com um contador, para um laço de erro não encher a lista.
   */
  function recordClientError({ page, message, where, stack, user }) {
    const cleanMessage = String(message ?? '').replace(/[\r\n]+/g, ' ').slice(0, 300)
    const cleanPage = String(page ?? '').split('?')[0].slice(0, 120)
    const found = clientErrors.find((entry) => entry.message === cleanMessage && entry.page === cleanPage)
    if (found) {
      found.count += 1
      found.lastAt = new Date(now()).toISOString()
      return
    }
    clientErrors.push({
      at: new Date(now()).toISOString(),
      lastAt: new Date(now()).toISOString(),
      count: 1,
      page: cleanPage,
      where: String(where ?? '').slice(0, 40),
      message: cleanMessage,
      stack: String(stack ?? '').slice(0, 900),
      user: String(user ?? '').slice(0, 120),
    })
    if (clientErrors.length > keepClientErrors) clientErrors.splice(0, clientErrors.length - keepClientErrors)
  }

  const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0)

  function windowStats(ms) {
    const from = now() - ms
    const list = samples.filter((sample) => sample.t >= from)
    const byClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 }
    for (const sample of list) {
      const key = `${Math.floor(sample.status / 100)}xx`
      if (key in byClass) byClass[key] += 1
    }
    const latencies = list.map((sample) => sample.ms).sort((a, b) => a - b)
    return {
      requests: list.length,
      perMinute: Math.round((list.length / (ms / 60_000)) * 10) / 10,
      byClass,
      errorRate: list.length ? Math.round((byClass['5xx'] / list.length) * 1000) / 10 : 0,
      p50: Math.round(percentile(latencies, 0.5)),
      p95: Math.round(percentile(latencies, 0.95)),
      max: Math.round(latencies.at(-1) ?? 0),
      list,
    }
  }

  function snapshot() {
    const five = windowStats(5 * 60_000)
    const hour = windowStats(60 * 60_000)
    const routes = new Map()
    for (const sample of hour.list) {
      const entry = routes.get(sample.route) ?? { route: sample.route, count: 0, total: 0, max: 0, errors: 0 }
      entry.count += 1
      entry.total += sample.ms
      entry.max = Math.max(entry.max, sample.ms)
      if (sample.status >= 500) entry.errors += 1
      routes.set(sample.route, entry)
    }
    const rows = [...routes.values()].map((entry) => ({ route: entry.route, count: entry.count, avgMs: Math.round(entry.total / entry.count), maxMs: Math.round(entry.max), errors: entry.errors }))
    const strip = ({ list: _list, ...rest }) => rest
    return {
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      last5min: strip(five),
      lastHour: strip(hour),
      slowestRoutes: [...rows].sort((a, b) => b.avgMs - a.avgMs).slice(0, 6),
      busiestRoutes: [...rows].sort((a, b) => b.count - a.count).slice(0, 6),
      recentErrors: [...errors].reverse().slice(0, 20),
      recentClientErrors: [...clientErrors].reverse().slice(0, 20),
      blockedByRateLimit: counters.blocked,
      loginFailures: counters.loginFailures,
      loginSuccess: counters.loginSuccess,
      eventLoopDelayMs: eventLoopP99(),
    }
  }

  /** p99 do atraso do event loop desde a última consulta (o histograma é zerado a cada leitura). */
  function eventLoopP99() {
    const value = Math.round((loop.percentile(99) / 1e6) * 10) / 10
    loop.reset()
    return Number.isFinite(value) ? value : 0
  }

  return {
    record,
    recordError,
    recordClientError,
    snapshot,
    blocked: () => (counters.blocked += 1),
    loginFailed: () => (counters.loginFailures += 1),
    loginOk: () => (counters.loginSuccess += 1),
  }
}
