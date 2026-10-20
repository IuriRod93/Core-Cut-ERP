import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { api, tokenStore } from './api'
import type { CollectionMap, CollectionName, CompanySettings, Doc, StageDef, TaskStatusDef } from '../types'

type Status = 'idle' | 'loading' | 'ready' | 'error'

interface State<T> {
  items: T[]
  status: Status
  error?: string
}

type AnyState = State<Doc>

const EMPTY: AnyState = { items: [], status: 'idle' }
const states = new Map<string, AnyState>()
const listeners = new Map<string, Set<() => void>>()
const inflight = new Map<string, Promise<void>>()
const watchers = new Map<string, number>()

const CASCADE_RELOAD: Record<string, string[]> = {
  projects: ['tasks', 'taskLists', 'timeEntries', 'taskComments', 'projectDocs'],
  tasks: ['tasks', 'taskComments', 'timeEntries'],
}

const getState = (name: string): AnyState => states.get(name) ?? EMPTY

function setState(name: string, next: AnyState) {
  states.set(name, next)
  listeners.get(name)?.forEach((fn) => fn())
}

const subscribe = (name: string) => (fn: () => void) => {
  let set = listeners.get(name)
  if (!set) listeners.set(name, (set = new Set()))
  set.add(fn)
  return () => set!.delete(fn)
}

export async function loadCollection(name: string, opts: { force?: boolean; silent?: boolean } = {}) {
  const current = getState(name)
  if (!opts.force && (current.status === 'ready' || current.status === 'loading')) return
  const pending = inflight.get(name)
  if (pending) return pending
  if (!opts.silent && current.status !== 'ready') setState(name, { ...current, status: 'loading' })
  const run = api
    .get<Doc[]>(`/data/${name}`)
    .then((items) => setState(name, { items, status: 'ready' }))
    .catch((error: Error) => {
      const prev = getState(name)
      setState(name, { items: prev.items, status: prev.items.length ? 'ready' : 'error', error: error.message })
    })
    .finally(() => inflight.delete(name))
  inflight.set(name, run)
  return run
}

export const resetStore = () => {
  states.clear()
  inflight.clear()
  listeners.forEach((set) => set.forEach((fn) => fn()))
}

export const getCollectionSnapshot = <N extends CollectionName>(name: N) => getState(name).items as unknown as CollectionMap[N][]

export async function createDoc<N extends CollectionName>(name: N, data: Partial<CollectionMap[N]>): Promise<CollectionMap[N]> {
  const doc = await api.post<CollectionMap[N]>(`/data/${name}`, data)
  const prev = getState(name)
  setState(name, { ...prev, status: 'ready', items: [...prev.items, doc as unknown as Doc] })
  return doc
}

export async function updateDoc<N extends CollectionName>(name: N, id: string, patch: Partial<CollectionMap[N]>): Promise<CollectionMap[N]> {
  const prev = getState(name)
  const before = prev.items.find((d) => d.id === id)
  if (before) {
    setState(name, { ...prev, items: prev.items.map((d) => (d.id === id ? ({ ...d, ...patch } as Doc) : d)) })
  }
  try {
    const doc = await api.put<CollectionMap[N]>(`/data/${name}/${id}`, patch)
    const cur = getState(name)
    setState(name, { ...cur, items: cur.items.map((d) => (d.id === id ? (doc as unknown as Doc) : d)) })
    return doc
  } catch (error) {
    if (before) {
      const cur = getState(name)
      setState(name, { ...cur, items: cur.items.map((d) => (d.id === id ? before : d)) })
    }
    throw error
  }
}

/** Altera só a cópia local (ex.: apontamento guardado sem internet); a próxima leitura do servidor prevalece. */
export function patchLocal<N extends CollectionName>(name: N, id: string, patch: Partial<CollectionMap[N]>) {
  const prev = getState(name)
  setState(name, { ...prev, items: prev.items.map((d) => (d.id === id ? ({ ...d, ...patch } as Doc) : d)) })
}

export async function removeDoc(name: CollectionName, id: string) {
  const prev = getState(name)
  setState(name, { ...prev, items: prev.items.filter((d) => d.id !== id) })
  try {
    await api.del(`/data/${name}/${id}`)
  } catch (error) {
    setState(name, prev)
    throw error
  }
  CASCADE_RELOAD[name]?.forEach((n) => {
    if (getState(n).status === 'ready') void loadCollection(n, { force: true, silent: true })
  })
}

export const refreshCollection = (name: CollectionName) => loadCollection(name, { force: true, silent: true })

// Canal ao vivo: o servidor avisa quais coleções mudaram; só as que estão abertas na tela recarregam.
const LIVE_STALE_MS = 70_000
let liveSeenAt = 0
let liveAbort: AbortController | null = null
const liveAlive = () => Date.now() - liveSeenAt < LIVE_STALE_MS

const pendingRefresh = new Set<string>()
let refreshTimer = 0
const refreshSoon = (names: Iterable<string>) => {
  for (const name of names) if ((watchers.get(name) ?? 0) > 0 && getState(name).status === 'ready') pendingRefresh.add(name)
  if (refreshTimer || !pendingRefresh.size) return
  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0
    pendingRefresh.forEach((name) => void loadCollection(name as CollectionName, { force: true, silent: true }))
    pendingRefresh.clear()
  }, 150)
}

/**
 * Mantém o canal aberto enquanto houver sessão e a aba estiver visível (reconecta sozinho). Abas em
 * segundo plano fecham o canal: em HTTP/1.1 o navegador só abre 6 conexões por servidor.
 * Devolve a função que encerra.
 */
export function startLiveUpdates(): () => void {
  let stopped = false
  let retry = 2_000
  let wake: (() => void) | null = null
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const id = window.setTimeout(done, ms)
      function done() {
        window.clearTimeout(id)
        wake = null
        resolve()
      }
      wake = done
    })
  const onVisibility = () => {
    if (document.visibilityState === 'visible') wake?.()
    else liveAbort?.abort()
  }
  const onLeave = () => liveAbort?.abort()
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', onLeave)
  const run = async () => {
    await wait(1_500) // deixa a tela carregar primeiro
    while (!stopped) {
      const token = tokenStore.get()
      if (token && document.visibilityState === 'visible') {
        liveAbort = new AbortController()
        try {
          const res = await fetch('/api/events', { headers: { Authorization: `Bearer ${token}` }, signal: liveAbort.signal })
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          liveSeenAt = Date.now()
          retry = 2_000
          refreshSoon(watchers.keys()) // ao (re)conectar, recupera o que mudou enquanto estava fora
          let buffer = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            liveSeenAt = Date.now()
            buffer += value
            let cut: number
            while ((cut = buffer.indexOf('\n\n')) >= 0) {
              const chunk = buffer.slice(0, cut)
              buffer = buffer.slice(cut + 2)
              for (const line of chunk.split('\n')) {
                if (!line.startsWith('data: ')) continue
                try {
                  const msg = JSON.parse(line.slice(6)) as { changed?: string[] }
                  if (Array.isArray(msg.changed)) refreshSoon(msg.changed)
                } catch {
                  /* aviso malformado: ignora */
                }
              }
            }
          }
        } catch {
          /* sem conexão: tenta de novo */
        } finally {
          liveSeenAt = 0
          liveAbort = null
        }
      }
      if (stopped) break
      await wait(document.visibilityState === 'visible' ? retry : 60 * 60_000)
      retry = Math.min(retry * 2, 60_000)
    }
  }
  void run()
  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', onVisibility)
    window.removeEventListener('pagehide', onLeave)
    liveAbort?.abort()
    wake?.()
  }
}

// Atualização periódica silenciosa das coleções em uso: reserva para quando o canal ao vivo cai.
if (typeof window !== 'undefined') {
  const tick = () => {
    if (document.visibilityState !== 'visible') return
    if (liveAlive()) return
    liveAbort?.abort() // canal mudo (rede trocou, proxy derrubou): força a reconexão
    watchers.forEach((count, name) => {
      if (count > 0 && getState(name).status === 'ready') void loadCollection(name, { force: true, silent: true })
    })
  }
  window.setInterval(tick, 30_000)
  document.addEventListener('visibilitychange', tick)
}

export function useCollection<N extends CollectionName>(name: N) {
  const state = useSyncExternalStore(subscribe(name), () => getState(name), () => EMPTY) as unknown as State<CollectionMap[N]>

  useEffect(() => {
    watchers.set(name, (watchers.get(name) ?? 0) + 1)
    void loadCollection(name)
    return () => {
      watchers.set(name, Math.max((watchers.get(name) ?? 1) - 1, 0))
    }
  }, [name])

  const items = state.items
  const byId = useMemo(() => new Map(items.map((d) => [d.id, d] as const)), [items])
  const create = useCallback((data: Partial<CollectionMap[N]>) => createDoc(name, data), [name])
  const update = useCallback((id: string, patch: Partial<CollectionMap[N]>) => updateDoc(name, id, patch), [name])
  const remove = useCallback((id: string) => removeDoc(name, id), [name])
  const reload = useCallback(() => loadCollection(name, { force: true, silent: true }), [name])

  return {
    items,
    byId,
    loading: state.status === 'idle' || state.status === 'loading',
    error: state.status === 'error' ? state.error : undefined,
    create,
    update,
    remove,
    reload,
  }
}

/**
 * Observa várias coleções de uma vez (lookups em tabelas, busca global, painéis).
 * Seguro para listas de nomes que mudam entre renderizações.
 */
export function useCollections<N extends CollectionName>(names: readonly N[]) {
  const key = names.join('|')
  const cache = useRef<{ key: string; arrays: unknown[]; snapshot: Record<string, unknown[]> } | null>(null)

  const subscribeAll = useCallback(
    (fn: () => void) => {
      const offs = key
        .split('|')
        .filter(Boolean)
        .map((n) => subscribe(n)(fn))
      return () => offs.forEach((off) => off())
    },
    [key],
  )

  const getSnapshot = () => {
    const list = key.split('|').filter(Boolean)
    const arrays = list.map((n) => getState(n).items)
    const prev = cache.current
    if (prev && prev.key === key && arrays.every((a, i) => a === prev.arrays[i])) return prev.snapshot
    const snapshot: Record<string, unknown[]> = {}
    list.forEach((n, i) => (snapshot[n] = arrays[i]))
    cache.current = { key, arrays, snapshot }
    return snapshot
  }

  const snapshot = useSyncExternalStore(subscribeAll, getSnapshot, () => ({}) as Record<string, unknown[]>)

  useEffect(() => {
    const list = key.split('|').filter(Boolean)
    list.forEach((n) => {
      watchers.set(n, (watchers.get(n) ?? 0) + 1)
      void loadCollection(n)
    })
    return () => list.forEach((n) => watchers.set(n, Math.max((watchers.get(n) ?? 1) - 1, 0)))
  }, [key])

  const maps = useMemo(() => {
    const out: Record<string, Map<string, unknown>> = {}
    for (const n of key.split('|').filter(Boolean)) {
      out[n] = new Map((snapshot[n] as Doc[] | undefined)?.map((d) => [d.id, d] as const) ?? [])
    }
    return out
  }, [snapshot, key])

  const loading = key
    .split('|')
    .filter(Boolean)
    .some((n) => {
      const st = getState(n).status
      return st === 'idle' || st === 'loading'
    })

  return {
    data: snapshot as { [K in N]: CollectionMap[K][] },
    maps: maps as { [K in N]: Map<string, CollectionMap[K]> },
    loading,
  }
}

// ----------------------------------------------------------------- settings
type SettingsDoc = Doc & Record<string, unknown>

const settingsState = (name = 'settings') => getState(name) as unknown as State<SettingsDoc>

export function useSettings() {
  const state = useSyncExternalStore(subscribe('settings'), () => settingsState(), () => EMPTY) as unknown as State<SettingsDoc>
  useEffect(() => {
    void loadCollection('settings')
  }, [])
  const get = useCallback(<T,>(id: string, fallback: T): T => (state.items.find((d) => d.id === id) as unknown as T) ?? fallback, [state.items])
  const save = useCallback(async (id: string, data: Record<string, unknown>) => {
    const existing = getState('settings').items.find((d) => d.id === id)
    if (existing) {
      const doc = await api.put<Doc>(`/data/settings/${id}`, data)
      const cur = getState('settings')
      setState('settings', { ...cur, items: cur.items.map((d) => (d.id === id ? doc : d)) })
    } else {
      const doc = await api.post<Doc>('/data/settings', { id, ...data })
      const cur = getState('settings')
      setState('settings', { ...cur, items: [...cur.items, doc], status: 'ready' })
    }
  }, [])
  return { items: state.items, loading: state.status !== 'ready', get, save }
}

export const DEFAULT_STAGES: StageDef[] = [
  { id: 'briefing', label: 'Briefing', color: '#8b8f98' },
  { id: 'medicao', label: 'Medição', color: '#4f7ea8' },
  { id: 'projeto', label: 'Projeto 3D', color: '#6b5fa8' },
  { id: 'aprovacao', label: 'Aprovação', color: '#b9852e' },
  { id: 'planejamento', label: 'Planejamento PCP', color: '#2f8f8a' },
  { id: 'producao', label: 'Produção', color: '#700618' },
  { id: 'expedicao', label: 'Expedição', color: '#a8582f' },
  { id: 'instalacao', label: 'Instalação', color: '#3f7a4f' },
  { id: 'entregue', label: 'Entregue', color: '#4c5a67' },
  { id: 'garantia', label: 'Garantia', color: '#7a6f64' },
]

export const DEFAULT_TASK_STATUSES: TaskStatusDef[] = [
  { id: 'todo', label: 'A fazer', color: '#8b8f98', type: 'open' },
  { id: 'doing', label: 'Em andamento', color: '#4f7ea8', type: 'active' },
  { id: 'review', label: 'Em revisão', color: '#b9852e', type: 'active' },
  { id: 'done', label: 'Concluído', color: '#3f7a4f', type: 'done' },
]

export function useCompany(): CompanySettings {
  const { get } = useSettings()
  const company = get<CompanySettings>('company', {
    id: 'company',
    name: 'Core Cut ERP',
    legalName: 'Core Cut Sistemas',
    cnpj: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    website: '',
    defaultMargin: 35,
    defaultTax: 6,
    quoteValidityDays: 15,
    workdayHours: 8,
    paymentTerms: '',
    createdAt: '',
    updatedAt: '',
  })
  return company.name === 'Arcoplan' ? { ...company, name: 'Core Cut ERP' } : company
}

export function useProjectStages(): StageDef[] {
  const { get } = useSettings()
  return get<{ stages: StageDef[] }>('projectStages', { stages: DEFAULT_STAGES }).stages
}

export function useDefaultTaskStatuses(): TaskStatusDef[] {
  const { get } = useSettings()
  return get<{ statuses: TaskStatusDef[] }>('taskStatuses', { statuses: DEFAULT_TASK_STATUSES }).statuses
}
