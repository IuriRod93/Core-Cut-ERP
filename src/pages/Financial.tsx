import { useMemo, useRef, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import { addDays, addMonths, differenceInCalendarDays, format, isSameMonth, startOfMonth } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { AccountBalanceIcon, AddIcon, CheckCircleIcon, PaidIcon, TrendingDownIcon, TrendingUpIcon, WarningAmberIcon, WhatsAppIcon } from '../components/icons'
import { DataTable, EmptyState, LoadingState, PageHeader, Panel, SearchField, StatCard, StatusChip, type Column } from '../components/ui'
import { FormDialog, type FieldDef } from '../components/forms'
import { CrudPage, type CrudConfig } from '../components/CrudPage'
import { useConfirm, useToast } from '../components/feedback'
import { createDoc, removeDoc, updateDoc, useCollections, useCompany } from '../lib/store'
import { chargeMessage, waPhone, whatsappUrl } from '../domain/collection'
import { EXPENSE_CATEGORIES, FINANCE_STATUS, INCOME_CATEGORIES, PAYMENT_METHODS, optLabel } from '../domain/constants'
import { brl, brlShort, daysUntil, fmtDate, isoDay, matches, todayISO, toDate } from '../lib/format'
import { chartPalette, colors } from '../theme'
import type { FinanceEntry, Payable, Receivable } from '../types'

type Entry = (Receivable | Payable) & { _status: 'pendente' | 'pago' | 'atrasado' | 'cancelado' }

const withStatus = <T extends FinanceEntry>(e: T): T & { _status: Entry['_status'] } => ({
  ...e,
  _status: e.status === 'pendente' && (daysUntil(e.dueDate) ?? 0) < 0 ? 'atrasado' : e.status,
})

export function FinancialPage() {
  const [tab, setTab] = useState(0)
  return (
    <Box>
      <PageHeader title="Financeiro" subtitle="Contas a receber e a pagar, fluxo de caixa, resultado por categoria e contas bancárias — tudo em reais." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2.5, borderBottom: `1px solid ${colors.border}` }}>
        <Tab label="Visão geral" />
        <Tab label="A receber" />
        <Tab label="A pagar" />
        <Tab label="Fluxo de caixa" />
        <Tab label="Resultado (DRE)" />
        <Tab label="Contas bancárias" />
        <Tab label="Produtos e serviços" />
      </Tabs>
      {tab === 0 ? <Overview /> : null}
      {tab === 1 ? <Entries kind="receivables" /> : null}
      {tab === 2 ? <Entries kind="payables" /> : null}
      {tab === 3 ? <CashFlow /> : null}
      {tab === 4 ? <Dre /> : null}
      {tab === 5 ? <Accounts /> : null}
      {tab === 6 ? <Products /> : null}
    </Box>
  )
}

// ---------------------------------------------------------------- helpers
function useFinance() {
  const { data, maps, loading } = useCollections(['receivables', 'payables', 'bankAccounts', 'clients', 'suppliers', 'projects'] as const)
  const recv = useMemo(() => data.receivables.map(withStatus), [data.receivables])
  const pay = useMemo(() => data.payables.map(withStatus), [data.payables])
  const balance = useMemo(
    () =>
      data.bankAccounts.filter((a) => a.active).reduce((s, a) => s + a.openingBalance, 0) +
      recv.filter((r) => r.status === 'pago').reduce((s, r) => s + r.amount, 0) -
      pay.filter((p) => p.status === 'pago').reduce((s, p) => s + p.amount, 0),
    [data.bankAccounts, recv, pay],
  )
  return { data, maps, loading, recv, pay, balance }
}

// ---------------------------------------------------------- visão geral
function Overview() {
  const { recv, pay, balance, loading } = useFinance()
  const today = new Date()
  if (loading) return <LoadingState />

  const in30 = (d: string) => (daysUntil(d) ?? 999) >= 0 && (daysUntil(d) ?? 999) <= 30
  const toReceive = recv.filter((r) => r.status === 'pendente')
  const toPay = pay.filter((p) => p.status === 'pendente')
  const lateRecv = toReceive.filter((r) => r._status === 'atrasado')
  const latePay = toPay.filter((p) => p._status === 'atrasado')

  const months = Array.from({ length: 9 }, (_, i) => {
    const m = startOfMonth(addMonths(today, i - 3))
    const inM = (e: FinanceEntry, field: 'dueDate' | 'paidDate') => {
      const d = toDate(e[field] as string | null)
      return d ? isSameMonth(d, m) : false
    }
    const future = m > startOfMonth(today) || isSameMonth(m, today)
    return {
      mes: format(m, 'MMM/yy', { locale: ptBR }),
      Receitas: recv.filter((r) => (r.status === 'pago' ? inM(r, 'paidDate') : future && r.status === 'pendente' && inM(r, 'dueDate'))).reduce((s, r) => s + r.amount, 0),
      Despesas: pay.filter((p) => (p.status === 'pago' ? inM(p, 'paidDate') : future && p.status === 'pendente' && inM(p, 'dueDate'))).reduce((s, p) => s + p.amount, 0),
    }
  })

  const upcoming = [...toReceive.map((e) => ({ ...e, dir: 'in' as const })), ...toPay.map((e) => ({ ...e, dir: 'out' as const }))]
    .filter((e) => (daysUntil(e.dueDate) ?? 0) <= 14)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8)

  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Saldo em contas" value={brl(balance)} icon={<AccountBalanceIcon />} tone={balance >= 0 ? 'brand' : 'error'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="A receber (30 dias)" value={brl(toReceive.filter((r) => in30(r.dueDate)).reduce((s, r) => s + r.amount, 0))} icon={<TrendingUpIcon />} tone="success" hint={lateRecv.length ? `${lateRecv.length} em atraso · ${brl(lateRecv.reduce((s, r) => s + r.amount, 0))}` : 'Sem atrasos'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="A pagar (30 dias)" value={brl(toPay.filter((p) => in30(p.dueDate)).reduce((s, p) => s + p.amount, 0))} icon={<TrendingDownIcon />} tone="warning" hint={latePay.length ? `${latePay.length} em atraso` : 'Sem atrasos'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard
            label="Projeção 30 dias"
            value={brl(balance + toReceive.filter((r) => in30(r.dueDate)).reduce((s, r) => s + r.amount, 0) - toPay.filter((p) => in30(p.dueDate)).reduce((s, p) => s + p.amount, 0))}
            icon={<PaidIcon />}
            hint="Saldo + a receber − a pagar"
          />
        </Grid>
      </Grid>
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Panel title="Receitas x despesas por mês" subtitle="Realizado (pago) e previsto (pendente)">
            <Box sx={{ height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={months} barGap={4}>
                  <CartesianGrid vertical={false} stroke={colors.border} />
                  <XAxis dataKey="mes" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => brlShort(v as number)} tickLine={false} axisLine={false} width={86} />
                  <RTooltip formatter={(v) => brl(Number(v))} cursor={{ fill: colors.subtle }} />
                  <Legend />
                  <Bar dataKey="Receitas" fill={colors.brand} radius={[6, 6, 0, 0]} maxBarSize={32} />
                  <Bar dataKey="Despesas" fill={colors.oak} radius={[6, 6, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Panel title="Próximos vencimentos (14 dias)" padded={false}>
            {upcoming.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
                Nenhum vencimento próximo.
              </Typography>
            ) : (
              upcoming.map((e) => (
                <Stack key={e.id} direction="row" spacing={1.25} alignItems="center" sx={{ px: 2.5, py: 1.1, borderBottom: `1px solid ${colors.border}` }}>
                  <Box sx={{ color: e.dir === 'in' ? colors.success : colors.error, display: 'grid' }}>{e.dir === 'in' ? <TrendingUpIcon fontSize="small" /> : <TrendingDownIcon fontSize="small" />}</Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {e.description}
                    </Typography>
                    <Typography variant="caption" color={e._status === 'atrasado' ? 'error.main' : 'text.secondary'}>
                      {fmtDate(e.dueDate)}
                      {e._status === 'atrasado' ? ' · atrasado' : ''}
                    </Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {brl(e.amount)}
                  </Typography>
                </Stack>
              ))
            )}
          </Panel>
        </Grid>
      </Grid>
    </Stack>
  )
}

// ----------------------------------------------------- receber / pagar
function Entries({ kind }: { kind: 'receivables' | 'payables' }) {
  const toast = useToast()
  const company = useCompany()
  const confirm = useConfirm()
  const isRecv = kind === 'receivables'
  const { data, maps, loading, recv, pay } = useFinance()
  const rows = (isRecv ? recv : pay) as Entry[]
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Entry | 'new' | null>(null)
  const [paying, setPaying] = useState<Entry | null>(null)
  const autoAmount = useRef<number | null>(null)

  const visible = rows.filter((r) => (!status || r._status === status) && matches([r.description, r.category, r.documentNumber, maps.clients.get((r as Receivable).clientId ?? '')?.name, maps.suppliers.get((r as Payable).supplierId ?? '')?.name, maps.projects.get(r.projectId ?? '')?.name], query))
  const pending = rows.filter((r) => r.status === 'pendente')
  const late = rows.filter((r) => r._status === 'atrasado')

  const fields: FieldDef[] = [
    { name: 'description', label: 'Descrição', type: 'text', required: true, span: 8 },
    { name: 'amount', label: 'Valor (R$)', type: 'money', required: true, span: 4 },
    isRecv
      ? { name: 'clientId', label: 'Cliente', type: 'relation', collection: 'clients', span: 6 }
      : { name: 'supplierId', label: 'Fornecedor', type: 'relation', collection: 'suppliers', span: 6 },
    { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', span: 6 },
    { name: 'category', label: 'Categoria', type: 'select', options: (isRecv ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => ({ value: c, label: c })), required: true, span: 6 },
    { name: 'accountId', label: 'Conta', type: 'relation', collection: 'bankAccounts', span: 6 },
    { name: 'dueDate', label: 'Vencimento', type: 'date', required: true, span: 4 },
    { name: 'method', label: 'Forma de pagamento', type: 'select', options: PAYMENT_METHODS, span: 4 },
    { name: 'documentNumber', label: 'Documento / NF', type: 'text', span: 4 },
    { name: '_installments', label: 'Parcelar em (vezes)', type: 'number', span: 4, min: 1, max: 60, show: (v) => !v.id, helper: 'Gera uma parcela por mês' },
    { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
  ]

  const columns: Column<Entry>[] = [
    {
      key: 'desc',
      header: 'Descrição',
      sort: (r) => r.description,
      render: (r) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
            {r.description}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {isRecv ? maps.clients.get((r as Receivable).clientId ?? '')?.name : maps.suppliers.get((r as Payable).supplierId ?? '')?.name}
            {r.projectId ? ` · ${maps.projects.get(r.projectId)?.name ?? ''}` : ''}
          </Typography>
        </Box>
      ),
    },
    { key: 'category', header: 'Categoria', hideBelow: 'lg', sort: (r) => r.category, render: (r) => r.category },
    { key: 'due', header: 'Vencimento', sort: (r) => r.dueDate, render: (r) => <Box sx={{ color: r._status === 'atrasado' ? 'error.main' : 'text.primary', fontWeight: r._status === 'atrasado' ? 700 : 400 }}>{fmtDate(r.dueDate)}</Box> },
    { key: 'paid', header: 'Pago em', hideBelow: 'md', sort: (r) => r.paidDate, render: (r) => fmtDate(r.paidDate) },
    { key: 'amount', header: 'Valor', align: 'right', sort: (r) => r.amount, render: (r) => <strong>{brl(r.amount)}</strong> },
    { key: 'status', header: 'Situação', sort: (r) => r._status, render: (r) => <StatusChip options={FINANCE_STATUS} value={r._status} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 96,
      render: (r) => {
        if (r.status !== 'pendente') return null
        // cobrança pelo WhatsApp do cliente, com a mensagem pronta
        const client = isRecv ? maps.clients.get((r as Receivable).clientId ?? '') : undefined
        const phone = waPhone(client?.phone)
        return (
          <Stack direction="row" spacing={0.25} justifyContent="flex-end">
            {isRecv && phone ? (
              <Tooltip title={`Cobrar ${client?.name ?? 'cliente'} pelo WhatsApp`}>
                <IconButton
                  size="small"
                  component="a"
                  href={whatsappUrl(phone, chargeMessage({ contactName: client?.contactName || client?.name, description: r.description, amount: r.amount, dueDate: r.dueDate, overdue: r._status === 'atrasado', companyName: company.name }))}
                  target="_blank"
                  rel="noopener"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  sx={{ color: '#25a244' }}
                  aria-label="Cobrar pelo WhatsApp"
                >
                  <WhatsAppIcon />
                </IconButton>
              </Tooltip>
            ) : null}
            <Tooltip title={isRecv ? 'Registrar recebimento' : 'Registrar pagamento'}>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); setPaying(r) }} sx={{ color: colors.success }} aria-label="Baixar">
                <CheckCircleIcon />
              </IconButton>
            </Tooltip>
          </Stack>
        )
      },
    },
  ]

  if (loading) return <LoadingState />

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label={isRecv ? 'A receber' : 'A pagar'} value={brl(pending.reduce((s, r) => s + r.amount, 0))} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em atraso" value={brl(late.reduce((s, r) => s + r.amount, 0))} tone={late.length ? 'error' : 'success'} icon={<WarningAmberIcon />} hint={`${late.length} lançamentos`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Vence em 7 dias" value={brl(pending.filter((r) => (daysUntil(r.dueDate) ?? 99) >= 0 && (daysUntil(r.dueDate) ?? 99) <= 7).reduce((s, r) => s + r.amount, 0))} tone="warning" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label={isRecv ? 'Recebido no mês' : 'Pago no mês'} value={brl(rows.filter((r) => r.status === 'pago' && r.paidDate && isSameMonth(toDate(r.paidDate)!, new Date())).reduce((s, r) => s + r.amount, 0))} tone="success" />
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <SearchField value={query} onChange={setQuery} placeholder="Buscar lançamentos…" />
          <TextField select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }}>
            <MenuItem value="">Todas</MenuItem>
            {FINANCE_STATUS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
            {isRecv ? 'Nova receita' : 'Nova despesa'}
          </Button>
        </Stack>
        {visible.length === 0 ? (
          <EmptyState icon={<PaidIcon />} title="Nenhum lançamento" description={isRecv ? 'Receitas de contratos, parcelas e serviços aparecem aqui.' : 'Despesas de compras, folha e custos fixos aparecem aqui.'} />
        ) : (
          <DataTable rows={visible} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => setEditing(r)} initialSort={{ key: 'due', dir: 'asc' }} />
        )}
      </Paper>

      {editing ? (
        <FormDialog
          open
          title={editing === 'new' ? (isRecv ? 'Nova receita' : 'Nova despesa') : 'Editar lançamento'}
          fields={fields}
          initial={editing === 'new' ? { status: 'pendente', dueDate: todayISO(), category: (isRecv ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0], accountId: data.bankAccounts[0]?.id, _installments: 1 } : { ...editing }}
          onFieldChange={(name, value, values) => {
            if (!isRecv) return
            if (name === 'amount') {
              autoAmount.current = null
              return
            }
            if (name !== 'projectId') return
            const project = value ? maps.projects.get(String(value)) : undefined
            const amount = Number(project?.contractValue ?? 0)
            const currentAmount = values.amount
            const canSuggest = currentAmount === undefined || currentAmount === null || currentAmount === '' || (autoAmount.current !== null && Number(currentAmount) === autoAmount.current)
            if (amount > 0 && canSuggest) {
              autoAmount.current = amount
              return { amount }
            }
            autoAmount.current = null
          }}
          onClose={() => setEditing(null)}
          extraActions={
            editing !== 'new' ? (
              <Button
                color="error"
                onClick={async () => {
                  if (await confirm({ title: 'Excluir lançamento?', message: editing.description, confirmLabel: 'Excluir', danger: true })) {
                    await removeDoc(kind, editing.id)
                    setEditing(null)
                  }
                }}
              >
                Excluir
              </Button>
            ) : undefined
          }
          onSave={async (values) => {
            const { id, createdAt, updatedAt, _status, _installments, ...rest } = values
            void createdAt
            void updatedAt
            void _status
            if (id) {
              await updateDoc(kind, id, rest)
              toast.success('Lançamento atualizado.')
              return
            }
            const n = Math.min(Math.max(Math.round(_installments ?? 1), 1), 60)
            const each = Math.round((rest.amount / n) * 100) / 100
            for (let i = 0; i < n; i++) {
              const due = toDate(rest.dueDate) ?? new Date()
              const d = isoDay(addMonths(due, i))
              await createDoc(kind, { ...rest, amount: i === n - 1 ? Math.round((rest.amount - each * (n - 1)) * 100) / 100 : each, dueDate: d, description: n > 1 ? `${rest.description} (${i + 1}/${n})` : rest.description, installmentLabel: n > 1 ? `${i + 1}/${n}` : undefined } as never)
            }
            toast.success(n > 1 ? `${n} parcelas lançadas.` : 'Lançamento criado.')
          }}
        />
      ) : null}

      {paying ? (
        <PayDialog
          entry={paying}
          isRecv={isRecv}
          accounts={data.bankAccounts.filter((a) => a.active)}
          onClose={() => setPaying(null)}
          onConfirm={async (paidDate, accountId, method) => {
            await updateDoc(kind, paying.id, { status: 'pago', paidDate, accountId, method } as never)
            toast.success(isRecv ? 'Recebimento registrado.' : 'Pagamento registrado.')
            setPaying(null)
          }}
        />
      ) : null}
    </Box>
  )
}

function PayDialog({ entry, isRecv, accounts, onClose, onConfirm }: { entry: Entry; isRecv: boolean; accounts: { id: string; name: string }[]; onClose: () => void; onConfirm: (date: string, account: string, method: string) => void }) {
  const [date, setDate] = useState(todayISO())
  const [account, setAccount] = useState(entry.accountId ?? accounts[0]?.id ?? '')
  const [method, setMethod] = useState(entry.method ?? 'pix')
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{isRecv ? 'Registrar recebimento' : 'Registrar pagamento'}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {entry.description}
        </Typography>
        <Typography variant="h4" sx={{ color: colors.brand, mb: 2 }}>
          {brl(entry.amount)}
        </Typography>
        <Stack spacing={2}>
          <TextField type="date" label="Data" value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField select label="Conta" value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Forma" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => (
              <MenuItem key={m.value} value={m.value}>
                {m.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" color="success" onClick={() => onConfirm(date, account, method)}>
          Confirmar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ----------------------------------------------------------- fluxo de caixa
function CashFlow() {
  const { recv, pay, balance, loading } = useFinance()
  const [horizon, setHorizon] = useState(60)
  if (loading) return <LoadingState />

  const today = new Date()
  let running = balance
  const lateIn = recv.filter((r) => r.status === 'pendente' && (daysUntil(r.dueDate) ?? 0) < 0).reduce((s, r) => s + r.amount, 0)
  const lateOut = pay.filter((p) => p.status === 'pendente' && (daysUntil(p.dueDate) ?? 0) < 0).reduce((s, p) => s + p.amount, 0)
  running += lateIn - lateOut
  const series = Array.from({ length: horizon + 1 }, (_, i) => {
    const day = addDays(today, i)
    const key = isoDay(day)
    const inn = recv.filter((r) => r.status === 'pendente' && r.dueDate === key).reduce((s, r) => s + r.amount, 0)
    const out = pay.filter((p) => p.status === 'pendente' && p.dueDate === key).reduce((s, p) => s + p.amount, 0)
    running += inn - out
    return { dia: format(day, 'dd/MM'), Saldo: Math.round(running * 100) / 100, Entradas: inn, Saídas: out }
  })
  const min = Math.min(...series.map((s) => s.Saldo))
  const firstNeg = series.find((s) => s.Saldo < 0)

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center">
        <TextField select label="Horizonte" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }}>
          {[30, 60, 90, 180].map((d) => (
            <MenuItem key={d} value={d}>
              {d} dias
            </MenuItem>
          ))}
        </TextField>
        <Typography variant="body2" color="text.secondary">
          Parte do saldo atual de {brl(balance)} e inclui atrasados ({brl(lateIn - lateOut)}).
        </Typography>
      </Stack>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Saldo final projetado" value={brl(series.at(-1)?.Saldo ?? 0)} tone={(series.at(-1)?.Saldo ?? 0) >= 0 ? 'brand' : 'error'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Menor saldo no período" value={brl(min)} tone={min < 0 ? 'error' : 'default'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Entradas previstas" value={brl(series.reduce((s, d) => s + d.Entradas, 0))} tone="success" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Saídas previstas" value={brl(series.reduce((s, d) => s + d.Saídas, 0))} tone="warning" hint={firstNeg ? `Saldo negativo em ${firstNeg.dia}` : undefined} />
        </Grid>
      </Grid>
      <Panel title="Saldo projetado dia a dia">
        <Box sx={{ height: 340 }}>
          <ResponsiveContainer>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="saldo" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.brand} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={colors.brand} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={colors.border} />
              <XAxis dataKey="dia" tickLine={false} axisLine={false} interval={Math.ceil(series.length / 10)} />
              <YAxis tickFormatter={(v) => brlShort(v as number)} tickLine={false} axisLine={false} width={86} />
              <RTooltip formatter={(v) => brl(Number(v))} />
              <ReferenceLine y={0} stroke={colors.error} strokeDasharray="4 4" />
              <Area type="monotone" dataKey="Saldo" stroke={colors.brand} strokeWidth={2.2} fill="url(#saldo)" />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      </Panel>
    </Stack>
  )
}

// ------------------------------------------------------------------- DRE
function Dre() {
  const { recv, pay, loading } = useFinance()
  const [from, setFrom] = useState(isoDay(startOfMonth(addMonths(new Date(), -2))))
  const [to, setTo] = useState(todayISO())
  if (loading) return <LoadingState />

  const inRange = (e: FinanceEntry) => e.status === 'pago' && e.paidDate && e.paidDate >= from && e.paidDate <= to
  const income = recv.filter(inRange)
  const expense = pay.filter(inRange)
  const group = (list: FinanceEntry[]) => {
    const m = new Map<string, number>()
    list.forEach((e) => m.set(e.category, (m.get(e.category) ?? 0) + e.amount))
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  }
  const inc = group(income)
  const exp = group(expense)
  const totalIn = income.reduce((s, e) => s + e.amount, 0)
  const totalOut = expense.reduce((s, e) => s + e.amount, 0)
  const result = totalIn - totalOut
  const days = Math.max(differenceInCalendarDays(toDate(to) ?? new Date(), toDate(from) ?? new Date()), 1)

  const Block = ({ title, rows, total, color }: { title: string; rows: { name: string; value: number }[]; total: number; color: string }) => (
    <Panel title={title} padded={false}>
      {rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
          Sem lançamentos pagos no período.
        </Typography>
      ) : (
        rows.map((r) => (
          <Box key={r.name} sx={{ px: 2.5, py: 1.1, borderBottom: `1px solid ${colors.border}` }}>
            <Stack direction="row" justifyContent="space-between">
              <Typography variant="body2">{r.name}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {brl(r.value)}
              </Typography>
            </Stack>
            <Box sx={{ height: 4, borderRadius: 2, bgcolor: colors.border, mt: 0.75 }}>
              <Box sx={{ height: 4, borderRadius: 2, bgcolor: color, width: `${(r.value / Math.max(total, 1)) * 100}%` }} />
            </Box>
          </Box>
        ))
      )}
      <Stack direction="row" justifyContent="space-between" sx={{ px: 2.5, py: 1.5, bgcolor: colors.subtle }}>
        <Typography variant="subtitle2">Total</Typography>
        <Typography variant="subtitle1">{brl(total)}</Typography>
      </Stack>
    </Panel>
  )

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <TextField type="date" label="De" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }} />
        <TextField type="date" label="Até" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }} />
        <Typography variant="caption" color="text.secondary">
          Regime de caixa — considera apenas lançamentos pagos no período ({days} dias).
        </Typography>
      </Stack>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Receitas" value={brl(totalIn)} tone="success" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Despesas" value={brl(totalOut)} tone="warning" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Resultado" value={brl(result)} tone={result >= 0 ? 'brand' : 'error'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Margem" value={`${totalIn ? Math.round((result / totalIn) * 1000) / 10 : 0}%`} />
        </Grid>
      </Grid>
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Block title="Receitas por categoria" rows={inc} total={totalIn} color={colors.success} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Block title="Despesas por categoria" rows={exp} total={totalOut} color={colors.oak} />
        </Grid>
      </Grid>
      {exp.length ? (
        <Panel title="Composição das despesas">
          <Box sx={{ height: 280 }}>
            <ResponsiveContainer>
              <BarChart data={exp} layout="vertical" margin={{ left: 30, right: 20 }}>
                <XAxis type="number" tickFormatter={(v) => brlShort(v as number)} hide />
                <YAxis type="category" dataKey="name" width={170} tickLine={false} axisLine={false} />
                <RTooltip formatter={(v) => brl(Number(v))} cursor={{ fill: colors.subtle }} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={18}>
                  {exp.map((_, i) => (
                    <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Box>
        </Panel>
      ) : null}
    </Stack>
  )
}

// ------------------------------------------------------- contas / produtos
function Accounts() {
  const { recv, pay } = useFinance()
  const config: CrudConfig = {
    collection: 'bankAccounts',
    module: 'financial',
    title: 'Contas bancárias',
    subtitle: 'Caixas, contas correntes e cartões usados nas baixas.',
    singular: 'conta',
    icon: <AccountBalanceIcon />,
    initialSort: { key: 'name', dir: 'asc' },
    defaults: () => ({ kind: 'corrente', openingBalance: 0, active: true }),
    columns: () => [
      { key: 'name', header: 'Conta', sort: (r) => r.name, render: (r) => <strong>{r.name}</strong> },
      { key: 'bank', header: 'Banco', render: (r) => r.bank || '—' },
      { key: 'kind', header: 'Tipo', render: (r) => optLabel([{ value: 'caixa', label: 'Caixa' }, { value: 'corrente', label: 'Conta corrente' }, { value: 'poupanca', label: 'Poupança' }, { value: 'cartao', label: 'Cartão' }], r.kind) },
      {
        key: 'balance',
        header: 'Saldo atual',
        align: 'right',
        sort: (r) => r.openingBalance + recv.filter((x) => x.accountId === r.id && x.status === 'pago').reduce((s, x) => s + x.amount, 0) - pay.filter((x) => x.accountId === r.id && x.status === 'pago').reduce((s, x) => s + x.amount, 0),
        render: (r) => <strong>{brl(r.openingBalance + recv.filter((x) => x.accountId === r.id && x.status === 'pago').reduce((s, x) => s + x.amount, 0) - pay.filter((x) => x.accountId === r.id && x.status === 'pago').reduce((s, x) => s + x.amount, 0))}</strong>,
      },
      { key: 'active', header: 'Situação', render: (r) => (r.active ? 'Ativa' : 'Inativa') },
    ],
    fields: [
      { name: 'name', label: 'Nome da conta', type: 'text', required: true, span: 8 },
      { name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'caixa', label: 'Caixa' }, { value: 'corrente', label: 'Conta corrente' }, { value: 'poupanca', label: 'Poupança' }, { value: 'cartao', label: 'Cartão' }], required: true, span: 4 },
      { name: 'bank', label: 'Banco / instituição', type: 'text', span: 6 },
      { name: 'openingBalance', label: 'Saldo inicial (R$)', type: 'money', span: 6 },
      { name: 'active', label: 'Conta ativa', type: 'switch' },
    ],
  }
  return <CrudPage config={config} />
}

function Products() {
  const config: CrudConfig = {
    collection: 'productsServices',
    module: 'financial',
    title: 'Produtos e serviços',
    subtitle: 'Tabela de preços de venda: serviços de montagem, projeto, frete e produtos avulsos.',
    singular: 'item',
    icon: <PaidIcon />,
    initialSort: { key: 'name', dir: 'asc' },
    defaults: () => ({ kind: 'servico', unit: 'un', active: true }),
    searchText: (r) => [r.name, r.category, r.description],
    columns: () => [
      { key: 'name', header: 'Item', sort: (r) => r.name, render: (r) => <strong>{r.name}</strong> },
      { key: 'kind', header: 'Tipo', render: (r) => (r.kind === 'produto' ? 'Produto' : 'Serviço') },
      { key: 'category', header: 'Categoria', hideBelow: 'md', render: (r) => r.category || '—' },
      { key: 'unit', header: 'Unid.', render: (r) => r.unit },
      { key: 'cost', header: 'Custo', align: 'right', hideBelow: 'md', sort: (r) => r.cost, render: (r) => (r.cost ? brl(r.cost) : '—') },
      { key: 'price', header: 'Preço', align: 'right', sort: (r) => r.price, render: (r) => <strong>{brl(r.price)}</strong> },
    ],
    fields: [
      { name: 'name', label: 'Nome', type: 'text', required: true, span: 8 },
      { name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'produto', label: 'Produto' }, { value: 'servico', label: 'Serviço' }], required: true, span: 4 },
      { name: 'category', label: 'Categoria', type: 'text', span: 4 },
      { name: 'unit', label: 'Unidade', type: 'text', span: 2 },
      { name: 'cost', label: 'Custo (R$)', type: 'money', span: 3 },
      { name: 'price', label: 'Preço de venda (R$)', type: 'money', required: true, span: 3 },
      { name: 'description', label: 'Descrição', type: 'textarea', rows: 2 },
      { name: 'active', label: 'Ativo', type: 'switch' },
    ],
  }
  return <CrudPage config={config} />
}

