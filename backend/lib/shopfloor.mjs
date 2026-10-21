import { HttpError } from './http-error.mjs'
import { PAUSE_REASON_KEYS } from '../../shared/shopfloor.mjs'

/**
 * Apontamento do Chão de fábrica. Cada ação altera UMA etapa a partir da versão gravada da ordem e com o
 * relógio do servidor: dois operadores na mesma ordem não apagam o apontamento um do outro, e um tablet
 * com a hora errada não distorce o tempo (nem o custo real do projeto).
 */

export const SHOPFLOOR_ACTIONS = ['start', 'pause', 'finish']
const ACTIVE_ORDER = ['liberada', 'em_producao']

const totalQuantity = (order) => (order.items ?? []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)

/** Segundos acumulados até `now`, somando o trecho em andamento. */
export const elapsedSeconds = (op, now) => (Number(op.actualSeconds) || 0) + (op.runningSince ? Math.max(0, Math.round((now - Date.parse(op.runningSince)) / 1000)) : 0)

/** Trecho trabalhado por quem estava com a etapa em andamento (base do tempo por operador). */
const closeSegment = (op, stamp, now) =>
  op.runningSince
    ? [...(op.segments ?? []), { operatorId: op.operatorId ?? null, operatorName: op.operatorName ?? '', start: op.runningSince, end: stamp, seconds: Math.max(0, Math.round((now - Date.parse(op.runningSince)) / 1000)) }]
    : (op.segments ?? [])

/** Encerra a pausa aberta (a etapa voltou ao trabalho ou foi concluída). */
const closePause = (op, stamp, now) =>
  (op.pauses ?? []).map((pause) => (pause.end ? pause : { ...pause, end: stamp, seconds: Math.max(0, Math.round((now - Date.parse(pause.start)) / 1000)) }))

/** Etapas anteriores do roteiro ainda não concluídas. */
export const pendingBefore = (order, op) => (order.operations ?? []).filter((other) => other.order < op.order && other.status !== 'concluida')

/**
 * Aplica a ação à etapa e devolve o patch da ordem ({ operations, status? }) e se o roteiro terminou.
 * `running` lista as etapas que o operador já tem em andamento (em qualquer ordem).
 */
export function applyOperationAction(order, opId, action, { user, now = Date.now(), quantity, running = [], reason, note }) {
  if (!SHOPFLOOR_ACTIONS.includes(action)) throw new HttpError(400, 'Ação inválida.')
  if (!ACTIVE_ORDER.includes(order.status)) throw new HttpError(409, 'A ordem precisa estar liberada ou em produção para receber apontamentos.')
  const op = (order.operations ?? []).find((item) => item.id === opId)
  if (!op) throw new HttpError(404, 'Etapa não encontrada nesta ordem.')
  if (op.status === 'concluida') throw new HttpError(409, 'Esta etapa já foi concluída.')
  const stamp = new Date(now).toISOString()
  let patch

  if (action === 'start') {
    if (op.status === 'em_andamento') return { operations: order.operations, finished: false, unchanged: true }
    const waiting = pendingBefore(order, op)
    if (waiting.length) throw new HttpError(409, `Aguardando a etapa anterior do roteiro: ${waiting[0].name || 'etapa'}.`)
    const other = running[0]
    if (other) throw new HttpError(409, `Você já tem uma etapa em andamento (${other.label}). Pause ou conclua antes de iniciar outra.`)
    patch = { status: 'em_andamento', runningSince: stamp, operatorId: user.id, operatorName: user.name, startedAt: op.startedAt ?? stamp, pauses: closePause(op, stamp, now) }
  }

  if (action === 'pause') {
    if (op.status !== 'em_andamento') throw new HttpError(409, 'Esta etapa não está em andamento.')
    if (!PAUSE_REASON_KEYS.includes(reason)) throw new HttpError(400, 'Informe o motivo da pausa.')
    const pause = { start: stamp, end: null, reason, note: String(note ?? '').trim().slice(0, 200), byId: user.id, byName: user.name }
    patch = { status: 'pausada', actualSeconds: elapsedSeconds(op, now), runningSince: null, segments: closeSegment(op, stamp, now), pauses: [...(op.pauses ?? []), pause] }
  }

  if (action === 'finish') {
    if (op.status === 'pendente' || !op.startedAt) throw new HttpError(409, 'Inicie a etapa antes de concluir: o tempo apontado entra no custo real do projeto.')
    const total = totalQuantity(order)
    const done = quantity === undefined || quantity === null || quantity === '' ? total : Number(quantity)
    if (!Number.isInteger(done) || done < 0) throw new HttpError(400, 'Informe a quantidade produzida (número inteiro).')
    if (total > 0 && done > total) throw new HttpError(400, `A quantidade produzida não pode passar do total da ordem (${total}).`)
    patch = { status: 'concluida', actualSeconds: elapsedSeconds(op, now), runningSince: null, finishedAt: stamp, quantityDone: done, segments: closeSegment(op, stamp, now), pauses: closePause(op, stamp, now) }
  }

  const operations = order.operations.map((item) => (item.id === op.id ? { ...item, ...patch } : item))
  return {
    operations,
    status: action === 'start' && order.status === 'liberada' ? 'em_producao' : undefined,
    finished: operations.every((item) => item.status === 'concluida'),
  }
}

/** Etapas que o usuário tem em andamento nas ordens ativas. */
export function runningOperationsOf(orders, userId) {
  const out = []
  for (const order of orders) {
    if (!ACTIVE_ORDER.includes(order.status)) continue
    for (const op of order.operations ?? [])
      if (op.status === 'em_andamento' && op.operatorId === userId) out.push({ orderId: order.id, opId: op.id, label: `${order.code ?? 'OP'} · ${op.name || 'etapa'}` })
  }
  return out
}

/** Diferença (ms) entre o horário de parede no fuso e o UTC naquele instante. */
function zoneOffset(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - Math.floor(ms / 1000) * 1000
}

/** Primeiro "HH:MM" no fuso depois de `fromMs`. */
export function nextWallTime(fromMs, hhmm, timeZone) {
  const [h, m] = String(hhmm).split(':').map(Number)
  const local = new Date(fromMs + zoneOffset(fromMs, timeZone))
  for (let add = 0; add < 3; add++) {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add, h, m)
    const at = wall - zoneOffset(wall, timeZone)
    if (at > fromMs) return at
  }
  return null
}

/**
 * Etapas esquecidas rodando: passaram do fim do expediente ou do limite de horas seguidas.
 * A pausa é registrada no horário do corte (não na hora em que o agendador rodou), para o tempo
 * apontado não contar a noite inteira.
 */
export function forgottenTimers(orders, { shiftEnd, maxRunHours, timeZone = 'America/Sao_Paulo' }, now = Date.now()) {
  const out = []
  const validShift = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(shiftEnd ?? ''))
  const maxMs = Number(maxRunHours) > 0 ? Number(maxRunHours) * 3_600_000 : 0
  for (const order of orders) {
    if (!ACTIVE_ORDER.includes(order.status)) continue
    for (const op of order.operations ?? []) {
      if (op.status !== 'em_andamento' || !op.runningSince) continue
      const since = Date.parse(op.runningSince)
      const shiftAt = validShift ? nextWallTime(since, shiftEnd, timeZone) : null
      const limitAt = maxMs ? since + maxMs : null
      const candidates = [shiftAt && { at: shiftAt, reason: 'fim_turno' }, limitAt && { at: limitAt, reason: 'outro' }].filter(Boolean).sort((a, b) => a.at - b.at)
      const cut = candidates[0]
      if (cut && cut.at <= now) out.push({ order, op, ...cut })
    }
  }
  return out
}

/** Chave de uma etiqueta (uma por unidade de peça): plano, peça e número da unidade. */
export const unitKey = (planId, pieceId, n) => `${planId}:${pieceId}:${n}`

/**
 * Marca (ou desmarca) etiquetas como feitas numa etapa: o roteiro avança aos poucos, peça por peça.
 * `units` é o mapa chave → true das etiquetas válidas dos planos da ordem.
 */
export function markPieces(order, opId, { keys, done = true, units, now = Date.now() }) {
  if (!ACTIVE_ORDER.includes(order.status)) throw new HttpError(409, 'A ordem precisa estar liberada ou em produção para receber apontamentos.')
  const op = (order.operations ?? []).find((item) => item.id === opId)
  if (!op) throw new HttpError(404, 'Etapa não encontrada nesta ordem.')
  if (op.status === 'concluida') throw new HttpError(409, 'Esta etapa já foi concluída.')
  if (!op.startedAt) throw new HttpError(409, 'Inicie a etapa antes de marcar as peças.')
  if (!Array.isArray(keys) || keys.length === 0 || keys.length > 5000) throw new HttpError(400, 'Informe as etiquetas (até 5000 por vez).')
  const invalid = keys.find((key) => typeof key !== 'string' || !units.has(key))
  if (invalid !== undefined) throw new HttpError(400, 'Etiqueta não pertence aos planos de corte desta ordem.')
  const set = new Set(op.piecesDone ?? [])
  for (const key of keys) done ? set.add(key) : set.delete(key)
  const operations = order.operations.map((item) => (item.id === op.id ? { ...item, piecesDone: [...set], piecesAt: new Date(now).toISOString() } : item))
  return { operations, done: set.size, total: units.size }
}
