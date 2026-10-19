import { useMemo } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useCollections } from '../lib/store'
import { daysUntil, brl } from '../lib/format'
import type { CollectionName } from '../types'

export interface AlertItem {
  id: string
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  path: string
}

/** Alertas operacionais derivados dos dados (prazos, estoque, financeiro, manutenção). */
export function useAlerts(): AlertItem[] {
  const { user, can } = useAuth()
  const names = useMemo(() => {
    const list: CollectionName[] = ['tasks', 'projects']
    if (can('inventory') || can('purchases')) list.push('materials')
    if (can('financial')) list.push('receivables', 'payables')
    if (can('production') || can('shopfloor')) list.push('productionOrders')
    if (can('maintenance')) list.push('maintenance', 'workCenters')
    if (can('purchases')) list.push('purchases')
    return list
  }, [can])
  const { data } = useCollections(names)

  return useMemo(() => {
    const out: AlertItem[] = []
    const projects = new Map((data.projects ?? []).map((p) => [p.id, p]))

    const mine = (data.tasks ?? []).filter((t) => t.assigneeIds?.includes(user?.id ?? '') && !t.completedAt)
    const overdue = mine.filter((t) => t.dueDate && (daysUntil(t.dueDate) ?? 0) < 0)
    if (overdue.length)
      out.push({
        id: 'tasks-overdue',
        severity: 'error',
        title: `${overdue.length} ${overdue.length === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}`,
        detail: overdue
          .slice(0, 2)
          .map((t) => t.title)
          .join(' · '),
        path: '/tarefas',
      })
    const today = mine.filter((t) => t.dueDate && daysUntil(t.dueDate) === 0)
    if (today.length)
      out.push({
        id: 'tasks-today',
        severity: 'warning',
        title: `${today.length} ${today.length === 1 ? 'tarefa vence hoje' : 'tarefas vencem hoje'}`,
        detail: today
          .slice(0, 2)
          .map((t) => `${t.title}${projects.get(t.projectId) ? ` — ${projects.get(t.projectId)!.name}` : ''}`)
          .join(' · '),
        path: '/tarefas',
      })

    const low = (data.materials ?? []).filter((m) => m.active !== false && m.minStock > 0 && m.stock <= m.minStock)
    if (low.length)
      out.push({
        id: 'stock-low',
        severity: 'warning',
        title: `${low.length} ${low.length === 1 ? 'item abaixo' : 'itens abaixo'} do estoque mínimo`,
        detail: low
          .slice(0, 2)
          .map((m) => m.name)
          .join(' · '),
        path: '/estoque',
      })

    const lateRecv = (data.receivables ?? []).filter((r) => r.status === 'pendente' && (daysUntil(r.dueDate) ?? 0) < 0)
    if (lateRecv.length)
      out.push({
        id: 'recv-late',
        severity: 'error',
        title: `${lateRecv.length} ${lateRecv.length === 1 ? 'recebimento atrasado' : 'recebimentos atrasados'}`,
        detail: `Total em atraso: ${brl(lateRecv.reduce((s, r) => s + r.amount, 0))}`,
        path: '/financeiro',
      })
    const duePay = (data.payables ?? []).filter((p) => p.status === 'pendente' && (daysUntil(p.dueDate) ?? 0) <= 2)
    if (duePay.length)
      out.push({
        id: 'pay-due',
        severity: 'warning',
        title: `${duePay.length} ${duePay.length === 1 ? 'conta a pagar vence' : 'contas a pagar vencem'} em até 2 dias`,
        detail: `Total: ${brl(duePay.reduce((s, p) => s + p.amount, 0))}`,
        path: '/financeiro',
      })

    const lateOps = (data.productionOrders ?? []).filter(
      (o) => !['concluida', 'cancelada'].includes(o.status) && o.dueDate && (daysUntil(o.dueDate) ?? 0) < 0,
    )
    if (lateOps.length)
      out.push({
        id: 'op-late',
        severity: 'error',
        title: `${lateOps.length} ${lateOps.length === 1 ? 'ordem de produção atrasada' : 'ordens de produção atrasadas'}`,
        detail: lateOps
          .slice(0, 2)
          .map((o) => o.code)
          .join(' · '),
        path: '/producao',
      })

    const maint = (data.maintenance ?? []).filter((m) => m.status === 'agendada' && (daysUntil(m.scheduledDate) ?? 0) <= 3)
    if (maint.length)
      out.push({
        id: 'maint-due',
        severity: 'warning',
        title: `${maint.length} ${maint.length === 1 ? 'manutenção programada' : 'manutenções programadas'} nos próximos dias`,
        detail: maint
          .slice(0, 2)
          .map((m) => m.title)
          .join(' · '),
        path: '/manutencao',
      })

    const latePurch = (data.purchases ?? []).filter(
      (p) => ['pedido', 'parcial'].includes(p.status) && p.expectedDate && (daysUntil(p.expectedDate) ?? 0) < 0,
    )
    if (latePurch.length)
      out.push({
        id: 'purch-late',
        severity: 'warning',
        title: `${latePurch.length} ${latePurch.length === 1 ? 'pedido de compra atrasado' : 'pedidos de compra atrasados'}`,
        detail: latePurch
          .slice(0, 2)
          .map((p) => p.code)
          .join(' · '),
        path: '/compras',
      })

    return out
  }, [data, user?.id])
}
