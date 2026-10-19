import { format, formatDistanceToNowStrict, isValid, parseISO, differenceInCalendarDays, addDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

const brlFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const numberFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max)
export const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export const brl = (value: number | null | undefined) => brlFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0)
export const brlShort = (value: number | null | undefined) => brlCompact.format(Number(value) || 0)
export const fmtNumber = (value: number | null | undefined, digits = 2) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number(value) || 0)
export const fmtNum = (value: number | null | undefined) => numberFormatter.format(Number(value) || 0)
export const pct = (value: number | null | undefined, digits = 0) =>
  `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Number(value) || 0)}%`

export const toDate = (value?: string | Date | null): Date | null => {
  if (!value) return null
  if (value instanceof Date) return isValid(value) ? value : null
  // datas "YYYY-MM-DD" são tratadas como locais para evitar deslocamento de fuso
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? parseISO(`${value}T12:00:00`) : parseISO(value)
  return isValid(d) ? d : null
}

export const fmtDate = (value?: string | Date | null, pattern = 'dd/MM/yyyy') => {
  const d = toDate(value)
  return d ? format(d, pattern, { locale: ptBR }) : '—'
}
export const fmtDateShort = (value?: string | Date | null) => fmtDate(value, 'dd MMM')
export const fmtDateTime = (value?: string | Date | null) => fmtDate(value, "dd/MM/yyyy 'às' HH:mm")
export const fmtTime = (value?: string | Date | null) => fmtDate(value, 'HH:mm')
export const fmtRelative = (value?: string | Date | null) => {
  const d = toDate(value)
  return d ? formatDistanceToNowStrict(d, { locale: ptBR, addSuffix: true }) : '—'
}

export const isoDay = (d: Date = new Date()) => format(d, 'yyyy-MM-dd')
export const todayISO = () => isoDay(new Date())
export const addDaysISO = (iso: string, days: number) => isoDay(addDays(toDate(iso) ?? new Date(), days))
export const daysUntil = (value?: string | Date | null) => {
  const d = toDate(value)
  return d ? differenceInCalendarDays(d, new Date()) : null
}

export const fmtDuration = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`
  if (m > 0) return `${m}min ${String(sec).padStart(2, '0')}s`
  return `${sec}s`
}
export const fmtClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
export const fmtHours = (hours: number) => {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`
}

export const initials = (name?: string) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '?'

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export const normalize = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export const matches = (haystack: unknown[], query: string) => {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  const text = normalize(haystack.filter((v) => v !== null && v !== undefined).join(' '))
  return tokens.every((t) => text.includes(t))
}

export const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export const maskDocument = (v: string) => {
  const d = v.replace(/\D/g, '').slice(0, 14)
  if (d.length <= 11) return d.replace(/^(\d{3})(\d{0,3})(\d{0,3})(\d{0,2}).*/, (_, a, b, c, e) => a + (b ? `.${b}` : '') + (c ? `.${c}` : '') + (e ? `-${e}` : ''))
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, '$1.$2.$3/$4-$5')
}

export const groupBy = <T, K extends string | number>(list: T[], key: (item: T) => K): Record<K, T[]> => {
  const out = {} as Record<K, T[]>
  for (const item of list) (out[key(item)] ??= []).push(item)
  return out
}

export const sum = <T,>(list: T[], pick: (item: T) => number) => list.reduce((acc, item) => acc + (Number(pick(item)) || 0), 0)

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const toCsv = (rows: (string | number | null | undefined)[][]) =>
  '﻿' +
  rows
    .map((r) =>
      r
        .map((cell) => {
          const v = cell === null || cell === undefined ? '' : String(cell)
          return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
        })
        .join(';'),
    )
    .join('\r\n')
