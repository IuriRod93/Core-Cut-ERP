import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useCollection } from '../lib/store'
import type { TimeEntry } from '../types'

// Cronômetro de tarefas: um apontamento "aberto" (end = null) por usuário.
export function useTimer() {
  const { user } = useAuth()
  const entries = useCollection('timeEntries')
  const running = entries.items.find((e) => e.userId === user?.id && !e.end) ?? null
  const [, tick] = useState(0)

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])

  const elapsed = running ? Math.max(0, Math.floor((Date.now() - new Date(running.start).getTime()) / 1000)) : 0

  const stop = async (entry: TimeEntry | null = running) => {
    if (!entry) return
    const end = new Date()
    const seconds = Math.max(1, Math.round((end.getTime() - new Date(entry.start).getTime()) / 1000))
    await entries.update(entry.id, { end: end.toISOString(), seconds })
  }

  const start = async (taskId: string, projectId: string) => {
    if (!user) return
    if (running) await stop(running)
    await entries.create({
      taskId,
      projectId,
      userId: user.id,
      userName: user.name,
      start: new Date().toISOString(),
      end: null,
      seconds: 0,
      billable: true,
    })
  }

  return { running, elapsed, start, stop, entries: entries.items }
}
