import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, onUnauthorized, tokenStore } from '../lib/api'
import { resetStore } from '../lib/store'
import { clearOfflineCache } from '../lib/offlineCache'
import type { ModuleKey, Subscriber, User } from '../types'

interface AuthValue {
  user: User | null
  modules: ModuleKey[]
  /** Assinatura da empresa do usuário; `null` na base original da plataforma. */
  company: Subscriber | null
  loading: boolean
  login: (login: string, password: string) => Promise<User>
  logout: () => Promise<void>
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>
  can: (module: ModuleKey) => boolean
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [modules, setModules] = useState<ModuleKey[]>([])
  const [company, setCompany] = useState<Subscriber | null>(null)
  const [loading, setLoading] = useState(Boolean(tokenStore.get()))

  const clear = useCallback(() => {
    tokenStore.set(null)
    setUser(null)
    setModules([])
    setCompany(null)
    resetStore()
    void clearOfflineCache()
  }, [])

  const refresh = useCallback(async () => {
    const data = await api.get<{ user: User; modules: ModuleKey[]; company: Subscriber | null }>('/auth/me')
    setUser(data.user)
    setModules(data.modules)
    setCompany(data.company ?? null)
  }, [])

  useEffect(() => {
    if (!tokenStore.get()) return
    // sem internet (e sem cópia guardada) a sessão continua: só uma recusa do servidor desconecta
    refresh()
      .catch((error) => {
        if (!(error instanceof ApiError && error.status === 0)) clear()
      })
      .finally(() => setLoading(false))
  }, [refresh, clear])

  useEffect(() => {
    const off = onUnauthorized(clear)
    return () => {
      off()
    }
  }, [clear])

  const value = useMemo<AuthValue>(
    () => ({
      user,
      modules,
      company,
      loading,
      login: async (login, password) => {
        const data = await api.post<{ token: string; user: User; modules: ModuleKey[]; company: Subscriber | null }>('/auth/login', { login, password })
        await clearOfflineCache() // nada do usuário anterior deste aparelho
        tokenStore.set(data.token)
        resetStore()
        setUser(data.user)
        setModules(data.modules)
        setCompany(data.company ?? null)
        return data.user
      },
      logout: async () => {
        try {
          await api.post('/auth/logout')
        } catch {
          /* sessão já expirada */
        }
        clear()
      },
      changePassword: async (currentPassword, newPassword) => {
        const data = await api.post<{ user: User; modules: ModuleKey[] }>('/auth/change-password', { currentPassword, newPassword })
        setUser(data.user)
        setModules(data.modules)
      },
      can: (module) => modules.includes(module),
      refresh,
    }),
    [user, modules, company, loading, clear, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
