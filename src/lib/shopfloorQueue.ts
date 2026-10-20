import { ApiError, api } from './api'

/**
 * Apontamentos feitos sem internet ficam guardados no aparelho e são enviados na ordem em que
 * aconteceram. Cada um leva "há quantos ms foi feito" (elapsedMs): o servidor calcula a hora com o
 * relógio dele, então um tablet com a hora errada não distorce o tempo.
 */
const KEY = 'arcoplan.shopfloor.queue'

export interface QueuedAction {
  id: string
  orderId: string
  opId: string
  action: 'start' | 'pause' | 'finish'
  body: Record<string, unknown>
  operatorTicket?: string
  at: number
  label: string
}

const listeners = new Set<() => void>()
export const onQueueChange = (fn: () => void) => {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function readQueue(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedAction[]
  } catch {
    return []
  }
}

function writeQueue(list: QueuedAction[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    /* armazenamento indisponível: o apontamento fica só na memória desta aba */
  }
  memory = list
  listeners.forEach((fn) => fn())
}

let memory: QueuedAction[] = readQueue()
export const queued = () => memory

export function enqueue(item: Omit<QueuedAction, 'id' | 'at'>) {
  writeQueue([...memory, { ...item, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() }])
}

export const actionPath = (orderId: string, opId: string, action: string) => `/production-orders/${orderId}/operations/${encodeURIComponent(opId)}/${action}`

let flushing: Promise<{ sent: number; failed: { label: string; message: string }[] }> | null = null

/** Envia a fila em ordem. Para no primeiro erro de rede; um apontamento recusado é descartado e relatado. */
export function flushQueue() {
  flushing ??= (async () => {
    let sent = 0
    const failed: { label: string; message: string }[] = []
    try {
      for (const item of [...memory]) {
        try {
          await api.post(actionPath(item.orderId, item.opId, item.action), { ...item.body, elapsedMs: Date.now() - item.at }, item.operatorTicket ? { 'X-Operator': item.operatorTicket } : undefined)
          sent += 1
        } catch (error) {
          if (error instanceof ApiError && error.status === 0) break
          failed.push({ label: item.label, message: error instanceof Error ? error.message : 'Recusado pelo servidor.' })
        }
        writeQueue(memory.filter((x) => x.id !== item.id))
      }
    } finally {
      flushing = null
    }
    return { sent, failed }
  })()
  return flushing
}
