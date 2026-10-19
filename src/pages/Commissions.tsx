import { useState } from 'react'
import { Box, Button, TextField, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { CrudPage, type CrudConfig, type CrudContext } from '../components/CrudPage'
import { CheckCircleIcon, PaidIcon } from '../components/icons'
import { StatusChip } from '../components/ui'
import { useToast } from '../components/feedback'
import { createDoc, refreshCollection, updateDoc, useCollections } from '../lib/store'
import { budgetTotals } from '../domain/budget'
import { brl, fmtDate, round2, todayISO } from '../lib/format'
import type { Budget, Commission, Receivable } from '../types'

const STATUS = [
  { value: 'prevista', label: 'Prevista', color: '#b9852e' },
  { value: 'liberada', label: 'Liberada para pagar', color: '#2f6f9f' },
  { value: 'paga', label: 'Paga', color: '#2e7d4f' },
  { value: 'cancelada', label: 'Cancelada', color: '#7d838c' },
]
const ROLE = [
  { value: 'vendedor', label: 'Vendedor' },
  { value: 'projetista', label: 'Projetista' },
  { value: 'montador', label: 'Montador / instalador' },
  { value: 'outro', label: 'Outro' },
]

/** Quanto do valor do projeto o cliente já pagou (0 a 1): é o que libera a comissão aos poucos. */
const receivedShare = (projectId: string | undefined, budget: Budget | undefined, receivables: Receivable[]) => {
  if (!projectId || !budget) return 0
  const total = budgetTotals(budget).total
  if (total <= 0) return 0
  const paid = receivables.filter((r) => r.projectId === projectId && r.status === 'pago').reduce((s, r) => s + r.amount, 0)
  return Math.min(paid / total, 1)
}

/** Cria as comissões dos orçamentos aprovados que ainda não têm comissão. */
function GenerateButton() {
  const toast = useToast()
  const { data } = useCollections(['budgets', 'commissions', 'users'] as const)
  const [percent, setPercent] = useState('3')
  const [busy, setBusy] = useState(false)
  const pending = data.budgets.filter((b) => b.status === 'aprovado' && b.responsibleId && !data.commissions.some((c) => c.budgetId === b.id && c.status !== 'cancelada'))

  const generate = async () => {
    const pct = Number(percent.replace(',', '.'))
    if (!(pct > 0 && pct <= 50)) return toast.error('Informe um percentual entre 0,1 e 50.')
    setBusy(true)
    try {
      for (const b of pending) {
        const totals = budgetTotals(b)
        const base = round2(totals.total - totals.taxes)
        await createDoc('commissions', {
          budgetId: b.id,
          projectId: b.projectId,
          personId: b.responsibleId as string,
          role: 'vendedor',
          baseAmount: base,
          percent: pct,
          amount: round2((base * pct) / 100),
          status: 'prevista',
        } as never)
      }
      await refreshCollection('commissions')
      toast.success(`${pending.length} comissão(ões) criada(s).`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar as comissões.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <TextField size="small" label="% padrão" value={percent} onChange={(e) => setPercent(e.target.value)} sx={{ width: 96 }} />
      <Button variant="outlined" disabled={busy || pending.length === 0} onClick={generate}>
        {pending.length ? `Gerar ${pending.length} dos orçamentos aprovados` : 'Nenhum orçamento aprovado sem comissão'}
      </Button>
    </Stack>
  )
}

export function CommissionsPage() {
  const toast = useToast()
  const config: CrudConfig = {
    collection: 'commissions',
    module: 'financial',
    title: 'Comissões',
    subtitle: 'Vendedores, projetistas e montadores: valor sobre a receita do orçamento, liberado conforme o cliente paga.',
    singular: 'comissão',
    icon: <PaidIcon />,
    lookups: ['users', 'budgets', 'projects', 'receivables'],
    initialSort: { key: 'created', dir: 'desc' },
    createLabel: 'Nova comissão',
    defaults: () => ({ role: 'vendedor', status: 'prevista', percent: 3 }),
    searchText: (r, ctx) => [r.code, ctx.maps.users?.get(r.personId)?.name, ctx.maps.projects?.get(r.projectId)?.name],
    filters: [
      { name: 'status', label: 'Situação', options: STATUS, get: (r) => r.status },
      { name: 'role', label: 'Função', options: ROLE, get: (r) => r.role },
    ],
    stats: (rows, ctx) => {
      const open = rows.filter((r) => r.status === 'prevista' || r.status === 'liberada')
      const releasable = open.reduce((s, r) => {
        const share = receivedShare(r.projectId, ctx.maps.budgets?.get(r.budgetId), (ctx.data.receivables ?? []) as Receivable[])
        return s + r.amount * share
      }, 0)
      return [
        { label: 'A pagar (previstas)', value: brl(open.reduce((s, r) => s + r.amount, 0)), tone: 'warning' },
        { label: 'Já liberável', value: brl(releasable), tone: 'brand' },
        { label: 'Pagas', value: brl(rows.filter((r) => r.status === 'paga').reduce((s, r) => s + r.amount, 0)), tone: 'success' },
        { label: 'Comissões', value: rows.length },
      ]
    },
    headerActions: () => <GenerateButton />,
    beforeSave: (v) => {
      const base = Number(v.baseAmount) || 0
      const percent = Number(v.percent) || 0
      return { ...v, amount: round2((base * percent) / 100), ...(v.status === 'paga' && !v.paidAt ? { paidAt: todayISO() } : {}) }
    },
    columns: (ctx: CrudContext) => [
      {
        key: 'person',
        header: 'Pessoa',
        sort: (r) => ctx.maps.users?.get(r.personId)?.name ?? '',
        render: (r) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {ctx.maps.users?.get(r.personId)?.name ?? '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {[r.code, ROLE.find((x) => x.value === r.role)?.label].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ),
      },
      { key: 'project', header: 'Projeto', hideBelow: 'md', render: (r) => ctx.maps.projects?.get(r.projectId)?.name ?? '—' },
      { key: 'base', header: 'Base', align: 'right', hideBelow: 'md', sort: (r) => r.baseAmount, render: (r) => brl(r.baseAmount) },
      { key: 'percent', header: '%', align: 'right', render: (r) => `${String(r.percent).replace('.', ',')}%` },
      { key: 'amount', header: 'Comissão', align: 'right', sort: (r) => r.amount, render: (r) => <b>{brl(r.amount)}</b> },
      {
        key: 'share',
        header: 'Liberável',
        align: 'right',
        hideBelow: 'sm',
        render: (r) => {
          if (r.status === 'paga') return '—'
          const share = receivedShare(r.projectId, ctx.maps.budgets?.get(r.budgetId), (ctx.data.receivables ?? []) as Receivable[])
          return `${brl(r.amount * share)} (${Math.round(share * 100)}%)`
        },
      },
      { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={STATUS} value={r.status} /> },
      { key: 'created', header: 'Criada', hideBelow: 'lg', sort: (r) => r.createdAt ?? '', render: (r) => (r.createdAt ? fmtDate(r.createdAt) : '—') },
    ],
    fields: [
      { name: 'personId', label: 'Pessoa', type: 'relation', collection: 'users', required: true, span: 6 },
      { name: 'role', label: 'Função', type: 'select', options: ROLE, required: true, span: 3 },
      { name: 'status', label: 'Situação', type: 'select', options: STATUS, required: true, span: 3 },
      { name: 'budgetId', label: 'Orçamento', type: 'relation', collection: 'budgets', span: 6 },
      { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', span: 6 },
      { name: 'baseAmount', label: 'Base de cálculo (R$)', type: 'money', required: true, span: 4, helper: 'Receita do orçamento sem impostos.' },
      { name: 'percent', label: 'Percentual', type: 'percent', required: true, span: 4 },
      { name: 'paidAt', label: 'Pago em', type: 'date', span: 4 },
      { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
    rowActions: (row) => [
      {
        label: 'Marcar como paga',
        icon: <CheckCircleIcon fontSize="small" />,
        hidden: row.status === 'paga' || row.status === 'cancelada',
        onClick: async () => {
          await updateDoc('commissions', row.id, { status: 'paga', paidAt: todayISO() } as Partial<Commission>)
          toast.success('Comissão marcada como paga.')
        },
      },
    ],
  }
  return <CrudPage config={config} />
}
