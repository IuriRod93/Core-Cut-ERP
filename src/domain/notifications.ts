import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'

export interface AppNotification {
  id: string
  kind: 'due' | 'overdue' | 'mention' | 'comment' | 'assigned' | 'automation' | 'quality' | 'shopfloor'
  title: string
  body: string
  path: string
  taskId?: string
  projectId?: string
  createdAt: string
  readAt: string | null
}

/** Notificações do usuário (prazos, menções, atribuições, automações). Atualiza a cada minuto e ao voltar para a aba. */
export function useNotifications() {
  const { user } = useAuth()
  const [state, setState] = useState<{ items: AppNotification[]; unread: number }>({ items: [], unread: 0 })

  const load = useCallback(async () => {
    try {
      setState(await api.get<{ items: AppNotification[]; unread: number }>('/notifications'))
    } catch {
      /* sem conexão: mantém o estado anterior */
    }
  }, [])

  useEffect(() => {
    if (!user) return
    void load()
    const id = window.setInterval(() => void load(), 60_000)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [user, load])

  const markRead = useCallback(
    async (ids: string[] | 'all') => {
      setState((s) => ({
        items: s.items.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)),
        unread: ids === 'all' ? 0 : Math.max(s.unread - s.items.filter((n) => !n.readAt && ids.includes(n.id)).length, 0),
      }))
      try {
        await api.post('/notifications/read', ids === 'all' ? { all: true } : { ids })
      } catch {
        void load()
      }
    },
    [load],
  )

  return { ...state, markRead, reload: load }
}
