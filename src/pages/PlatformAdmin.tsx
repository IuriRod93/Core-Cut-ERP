import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  MenuItem,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { DataTable, EmptyState, KeyValue, LoadingState, PageHeader, Panel, SearchField, SideDrawer, StatCard, type Column } from '../components/ui'
import { useConfirm, useToast } from '../components/feedback'
import { PixPaymentDialog } from '../components/PixPaymentDialog'
import { api, tokenStore } from '../lib/api'
import { brl, fmtDate, fmtDateTime } from '../lib/format'
import { methodLabel, type PixPayload } from '../lib/billing'
import { colors } from '../theme'
import type { CompanyAccess, PlanLimits } from '../types'

// ------------------------------------------------------------------- tipos
interface CompanyRow {
  id: string
  name: string
  legalName: string
  document: string
  email: string
  phone: string
  planId: string
  planName: string
  planPrice: number
  status: string
  billingMethod: string | null
  paidUntil: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
  lastPaymentAt: string | null
  createdAt: string
  access: CompanyAccess
  usage: Record<string, number>
  limits: PlanLimits
  userCount: number
  lastLoginAt: string | null
  /** pode emitir nota fiscal com o token da plataforma */
  fiscalPlatform?: boolean
}
interface PlatformUser {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  companyId: string | null
  companyName?: string
  lastLoginAt: string | null
  passwordMustChange: boolean
  createdAt: string
}
interface PaymentRow {
  id: string
  kind?: string
  companyId: string
  companyName: string
  planName: string
  method: 'card' | 'pix'
  months: number
  amount: number
  state: 'paid' | 'pending' | 'expired'
  createdAt: string
  paidAt: string | null
}
interface LoginRow {
  at: string
  ok: boolean
  userName: string
  ip: string
  channel?: 'site' | 'app'
  device?: string
  companyName: string
}
interface SessionRow {
  id: string
  userName: string
  email: string
  companyName: string
  ip: string
  agent: string
  createdAt: string
  expiresAt: string
  self: boolean
}
interface Overview {
  companies: number
  trial: number
  trialExpired: number
  paying: number
  manual: number
  pendingPayment: number
  blocked: number
  pastDue: number
  suspended: number
  users: number
  signups7d: number
  signups30d: number
  mrrEstimate: number
  revenue30d: number
  paymentsPaid30d: number
  trialsEndingSoon: { id: string; name: string; hoursLeft: number }[]
  recentSignups: { id: string; name: string; email: string; planName: string; state: string; createdAt: string }[]
}
interface Detail {
  company: CompanyRow
  users: PlatformUser[]
  payments: PaymentRow[]
  logins: { at: string; userName: string; ip: string }[]
  sessions: number
}

const ROLE_OPTIONS = [
  ['admin', 'Administrador'],
  ['gerente', 'Gerência'],
  ['comercial', 'Comercial'],
  ['projetista', 'Projetos e design'],
  ['pcp', 'PCP e produção'],
  ['producao', 'Operação de fábrica'],
  ['suprimentos', 'Suprimentos'],
  ['financeiro', 'Financeiro'],
  ['instalador', 'Entrega e instalação'],
] as const

const STATE: Record<string, { label: string; color: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  trial: { label: 'Em teste', color: 'info' },
  trial_expired: { label: 'Teste encerrado', color: 'warning' },
  active: { label: 'Ativa', color: 'success' },
  expiring: { label: 'Vence em breve', color: 'warning' },
  grace: { label: 'Vencida (carência)', color: 'warning' },
  past_due: { label: 'Cobrança falhou', color: 'warning' },
  pending_payment: { label: 'Aguardando pagamento', color: 'warning' },
  canceled: { label: 'Cancelada', color: 'error' },
  expired: { label: 'Vencida', color: 'error' },
  suspended: { label: 'Suspensa', color: 'error' },
  platform: { label: 'Plataforma', color: 'default' },
}
const stateChip = (state: string) => {
  const entry = STATE[state] ?? { label: state, color: 'default' as const }
  return <Chip size="small" label={entry.label} color={entry.color} variant={entry.color === 'default' ? 'outlined' : 'filled'} />
}
const paymentChip = (state: PaymentRow['state']) => (
  <Chip size="small" label={state === 'paid' ? 'Pago' : state === 'pending' ? 'Aguardando' : 'Expirado'} color={state === 'paid' ? 'success' : state === 'pending' ? 'warning' : 'default'} variant={state === 'expired' ? 'outlined' : 'filled'} />
)

const validityOf = (c: CompanyRow) => {
  if (c.access.state === 'trial' || c.access.state === 'trial_expired') return c.trialEndsAt ? `${fmtDateTime(c.trialEndsAt)}` : '—'
  return c.paidUntil ? fmtDate(c.paidUntil) : '—'
}

// -------------------------------------------------------------- página
export function PlatformAdminPage() {
  const [tab, setTab] = useState(0)
  const [openCompany, setOpenCompany] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((value) => value + 1), [])

  return (
    <Box>
      <PageHeader
        title="Painel Admin"
        subtitle="Empresas, licenças, pagamentos, acessos, credenciais e monitoramento da plataforma Core Cut."
        actions={
          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to="/admin/teste-pagamento" variant="contained">Testar API do Mercado Pago</Button>
            <Button onClick={reload}>Atualizar</Button>
          </Stack>
        }
      />
      <Tabs value={tab} onChange={(_, value) => setTab(value)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2.5, borderBottom: `1px solid ${colors.border}` }}>
        <Tab label="Visão geral" />
        <Tab label="Empresas" />
        <Tab label="Pagamentos" />
        <Tab label="Financeiro" />
        <Tab label="Quem entrou" />
        <Tab label="Usuários" />
        <Tab label="Sessões ativas" />
        <Tab label="Teste de cobrança" />
        <Tab label="Monitoramento" />
        <Tab label="Segurança" />
        <Tab label="Verificação facial" />
        <Tab label="Atividade (site e app)" />
      </Tabs>
      {tab === 0 ? <OverviewTab tick={tick} onOpen={(id) => { setOpenCompany(id) }} /> : null}
      {tab === 1 ? <CompaniesTab tick={tick} onOpen={setOpenCompany} onChanged={reload} /> : null}
      {tab === 2 ? <PaymentsTab tick={tick} onOpen={setOpenCompany} /> : null}
      {tab === 3 ? <FinanceTab tick={tick} onOpen={setOpenCompany} /> : null}
      {tab === 4 ? <LoginsTab tick={tick} /> : null}
      {tab === 5 ? <UsersTab tick={tick} onChanged={reload} /> : null}
      {tab === 6 ? <SessionsTab tick={tick} /> : null}
      {tab === 7 ? <PaymentTestTab onChanged={reload} /> : null}
      {tab === 8 ? <MonitorTab tick={tick} /> : null}
      {tab === 9 ? <SecurityTab tick={tick} /> : null}
      {tab === 10 ? <FacesTab tick={tick} /> : null}
      {tab === 11 ? <ActivityTab tick={tick} /> : null}
      <CompanyDrawer id={openCompany} onClose={() => setOpenCompany(null)} onChanged={reload} tick={tick} />
    </Box>
  )
}

// ---------------------------------------------------------- visão geral
function OverviewTab({ tick, onOpen }: { tick: number; onOpen: (id: string) => void }) {
  const [data, setData] = useState<Overview | null>(null)
  useEffect(() => {
    api.get<Overview>('/platform/overview').then(setData).catch(() => undefined)
  }, [tick])
  if (!data) return <LoadingState />
  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Empresas" value={data.companies} hint={`${data.signups7d} nos últimos 7 dias`} tone="brand" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Em teste (48 h)" value={data.trial} hint={`${data.trialExpired} com teste encerrado`} tone="info" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Pagantes ativos" value={data.paying} hint={`${data.manual} com licença manual`} tone="success" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Aguardando pagamento" value={data.pendingPayment} hint={`${data.blocked} bloqueadas no total`} tone="warning" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Receita mensal estimada" value={brl(data.mrrEstimate)} hint="soma dos planos pagos ativos" tone="success" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Recebido em 30 dias" value={brl(data.revenue30d)} hint={`${data.paymentsPaid30d} pagamentos registrados`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Cobrança com problema" value={data.pastDue} hint="atraso ou carência" tone={data.pastDue ? 'warning' : 'default'} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Usuários cadastrados" value={data.users} hint={`${data.suspended} empresa(s) suspensa(s)`} /></Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Panel title="Cadastros recentes" subtitle="Clique para ver os detalhes da empresa">
            {data.recentSignups.length === 0 ? (
              <EmptyState title="Nenhuma empresa cadastrada" description="Os cadastros feitos em /cadastro aparecem aqui." />
            ) : (
              <Stack spacing={1}>
                {data.recentSignups.map((entry) => (
                  <Box key={entry.id} onClick={() => onOpen(entry.id)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, borderRadius: 2, border: `1px solid ${colors.border}`, cursor: 'pointer', '&:hover': { borderColor: colors.brand } }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography sx={{ fontWeight: 600 }} noWrap>{entry.name}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>{entry.email} · {entry.planName} · {fmtDateTime(entry.createdAt)}</Typography>
                    </Box>
                    {stateChip(entry.state)}
                  </Box>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Panel title="Testes terminando" subtitle="Menos de 12 horas — bom momento para contatar">
            {data.trialsEndingSoon.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Nenhum teste terminando nas próximas horas.</Typography>
            ) : (
              <Stack spacing={1}>
                {data.trialsEndingSoon.map((entry) => (
                  <Box key={entry.id} onClick={() => onOpen(entry.id)} sx={{ display: 'flex', justifyContent: 'space-between', p: 1.25, borderRadius: 2, border: `1px solid ${colors.border}`, cursor: 'pointer' }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>{entry.name}</Typography>
                    <Chip size="small" color="warning" label={`${entry.hoursLeft} h`} />
                  </Box>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>
      </Grid>
      <Alert severity="info">
        A receita estimada considera os planos pagos ativos. Renovações automáticas do cartão são cobradas pelo Mercado Pago e podem não aparecer em “Recebido em 30 dias”, que soma os pagamentos registrados por este sistema (assinaturas novas e PIX).
      </Alert>
    </Stack>
  )
}

// -------------------------------------------------------------- empresas
function CompaniesTab({ tick, onOpen, onChanged }: { tick: number; onOpen: (id: string) => void; onChanged: () => void }) {
  const [rows, setRows] = useState<CompanyRow[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  useEffect(() => {
    api.get<{ items: CompanyRow[] }>('/platform/companies').then((r) => setRows(r.items)).catch(() => setRows([]))
  }, [tick])
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase()
    return (rows ?? []).filter((row) => {
      if (filter === 'trial' && row.access.state !== 'trial') return false
      if (filter === 'paying' && !(row.status === 'active' && row.access.allowed && row.billingMethod !== 'trial')) return false
      if (filter === 'blocked' && row.access.allowed) return false
      if (!term) return true
      return [row.name, row.legalName, row.email, row.document, row.phone].some((value) => String(value).toLowerCase().includes(term))
    })
  }, [rows, query, filter])
  if (!rows) return <LoadingState />
  const columns: Column<CompanyRow>[] = [
    { key: 'name', header: 'Empresa', sort: (c) => c.name, render: (c) => (<Box><Typography sx={{ fontWeight: 600 }}>{c.name}</Typography><Typography variant="caption" color="text.secondary">{c.email}</Typography></Box>) },
    { key: 'plan', header: 'Plano', sort: (c) => c.planName, render: (c) => `${c.planName} · ${brl(c.planPrice)}` },
    { key: 'state', header: 'Situação', sort: (c) => c.access.state, render: (c) => stateChip(c.access.state) },
    { key: 'method', header: 'Pagamento', hideBelow: 'md', render: (c) => methodLabel(c.billingMethod) },
    { key: 'until', header: 'Teste / validade', hideBelow: 'md', render: validityOf },
    { key: 'users', header: 'Usuários', align: 'right', hideBelow: 'md', sort: (c) => c.userCount, render: (c) => c.userCount },
    { key: 'last', header: 'Último acesso', hideBelow: 'lg', sort: (c) => c.lastLoginAt ?? '', render: (c) => (c.lastLoginAt ? fmtDateTime(c.lastLoginAt) : '—') },
    { key: 'created', header: 'Cadastro', hideBelow: 'lg', sort: (c) => c.createdAt, render: (c) => fmtDate(c.createdAt) },
  ]
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" alignItems="center">
        <SearchField value={query} onChange={setQuery} placeholder="Buscar por nome, e-mail, CNPJ, telefone…" width={360} />
        <TextField select size="small" value={filter} onChange={(e) => setFilter(e.target.value)} sx={{ minWidth: 190 }}>
          <MenuItem value="all">Todas</MenuItem>
          <MenuItem value="trial">Em teste</MenuItem>
          <MenuItem value="paying">Pagantes ativas</MenuItem>
          <MenuItem value="blocked">Bloqueadas</MenuItem>
        </TextField>
        <Typography variant="body2" color="text.secondary">{filtered.length} empresa(s)</Typography>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" onClick={() => setCreating(true)}>Novo cliente</Button>
      </Stack>
      {filtered.length === 0 ? (
        <EmptyState title="Nenhuma empresa encontrada" description="Ajuste a busca ou o filtro, ou cadastre um novo cliente." />
      ) : (
        <DataTable rows={filtered} columns={columns} rowKey={(c) => c.id} onRowClick={(c) => onOpen(c.id)} />
      )}
      <NewClientDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          onChanged()
          onOpen(id)
        }}
      />
    </Stack>
  )
}

/**
 * Cadastra um cliente novo: cria a empresa e o administrador (titular). É ele quem entra em /login,
 * cria as unidades (empresas) e a equipe dentro do próprio ambiente.
 */
function NewClientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (companyId: string) => void }) {
  const toast = useToast()
  const [plans, setPlans] = useState<Array<{ id: string; name: string; price: number }>>([])
  const [form, setForm] = useState({ companyName: '', ownerName: '', email: '', phone: '', document: '', planId: 'profissional', access: 'license', days: 30, password: '' })
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ companyId: string; companyName: string; email: string; password: string | null; loginUrl: string } | null>(null)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    if (!open) return
    setResult(null)
    setForm({ companyName: '', ownerName: '', email: '', phone: '', document: '', planId: 'profissional', access: 'license', days: 30, password: '' })
    api.get<{ plans: Array<{ id: string; name: string; price: number }> }>('/billing/plans').then((r) => setPlans(r.plans)).catch(() => setPlans([]))
  }, [open])

  const submit = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ company: { id: string; name: string }; owner: { email: string }; loginUrl: string; temporaryPassword?: string }>('/platform/companies', {
        ...form,
        days: Number(form.days) || 30,
        password: form.password || undefined,
      })
      setResult({ companyId: r.company.id, companyName: r.company.name, email: r.owner.email, password: r.temporaryPassword ?? null, loginUrl: r.loginUrl })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível cadastrar o cliente.')
    } finally {
      setBusy(false)
    }
  }

  const message = result ? `Acesso ao Core Cut ERP\nEmpresa: ${result.companyName}\nEndereço: ${result.loginUrl}\nUsuário: ${result.email}${result.password ? `\nSenha provisória: ${result.password}\n(troque a senha no primeiro acesso)` : ''}` : ''

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{result ? 'Cliente cadastrado' : 'Novo cliente'}</DialogTitle>
      <DialogContent>
        {result ? (
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Alert severity="success">
              {result.companyName} foi criada. O administrador entra em <strong>{result.loginUrl}</strong> e monta as unidades e a equipe dele em <em>Equipe</em>.
            </Alert>
            <Box sx={{ p: 1.5, borderRadius: 2, border: `1px solid ${colors.border}`, fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 13 }}>{message}</Box>
            {result.password ? <Typography variant="caption" color="text.secondary">A senha provisória só aparece agora. Envie ao cliente; ele será obrigado a trocá-la no primeiro acesso.</Typography> : null}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField label="Nome da empresa" value={form.companyName} onChange={(e) => set('companyName', e.target.value)} autoFocus required />
            <Stack direction="row" spacing={2}>
              <TextField label="Administrador (nome)" value={form.ownerName} onChange={(e) => set('ownerName', e.target.value)} required fullWidth />
              <TextField label="E-mail de acesso" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required fullWidth helperText="Será o usuário em /login" />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Telefone / WhatsApp" value={form.phone} onChange={(e) => set('phone', e.target.value)} fullWidth />
              <TextField label="CPF / CNPJ" value={form.document} onChange={(e) => set('document', e.target.value)} fullWidth />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField select label="Plano" value={form.planId} onChange={(e) => set('planId', e.target.value)} fullWidth>
                {plans.map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    {p.name} · {brl(p.price)}/mês
                  </MenuItem>
                ))}
              </TextField>
              <TextField select label="Acesso inicial" value={form.access} onChange={(e) => set('access', e.target.value)} fullWidth>
                <MenuItem value="license">Licença manual (já pago/combinado)</MenuItem>
                <MenuItem value="trial">Teste gratuito de 48 horas</MenuItem>
                <MenuItem value="pending">Aguardando pagamento</MenuItem>
              </TextField>
            </Stack>
            {form.access === 'license' ? <TextField label="Dias de licença" type="number" value={form.days} onChange={(e) => set('days', Number(e.target.value))} sx={{ maxWidth: 220 }} slotProps={{ htmlInput: { min: 1, max: 3650 } }} /> : null}
            <TextField label="Senha inicial (opcional)" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} helperText="Em branco = gera uma senha provisória. O cliente troca no primeiro acesso." />
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {result ? (
          <>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(message)
                  toast.success('Acesso copiado: é só colar no WhatsApp.')
                } catch {
                  toast.error('Não foi possível copiar.')
                }
              }}
            >
              Copiar acesso
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                onClose()
                onCreated(result.companyId)
              }}
            >
              Abrir a empresa
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancelar</Button>
            <Button variant="contained" disabled={busy || form.companyName.trim().length < 2 || form.ownerName.trim().length < 2 || !form.email.includes('@')} onClick={() => void submit()}>
              Cadastrar cliente
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}

// ------------------------------------------------------------ pagamentos
function PaymentsTab({ tick, onOpen }: { tick: number; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<PaymentRow[] | null>(null)
  useEffect(() => {
    api.get<{ items: PaymentRow[] }>('/platform/payments').then((r) => setRows(r.items)).catch(() => setRows([]))
  }, [tick])
  if (!rows) return <LoadingState />
  const paid = rows.filter((row) => row.state === 'paid')
  const total = paid.reduce((sum, row) => sum + row.amount, 0)
  const columns: Column<PaymentRow>[] = [
    { key: 'date', header: 'Data', sort: (p) => p.createdAt, render: (p) => fmtDateTime(p.paidAt ?? p.createdAt) },
    { key: 'company', header: 'Empresa', sort: (p) => p.companyName, render: (p) => <strong>{p.companyName}</strong> },
    { key: 'plan', header: 'Plano', render: (p) => p.planName },
    { key: 'method', header: 'Forma', render: (p) => (p.kind === 'platform-test' ? `Teste · ${p.method === 'pix' ? 'PIX' : 'cartão'}` : p.method === 'pix' ? `PIX · ${p.months} ${p.months === 1 ? 'mês' : 'meses'}` : 'Cartão · mensal') },
    { key: 'amount', header: 'Valor', align: 'right', sort: (p) => p.amount, render: (p) => brl(p.amount) },
    { key: 'state', header: 'Situação', render: (p) => paymentChip(p.state) },
  ]
  return (
    <Stack spacing={2}>
      <Alert severity="info">
        {paid.length} pagamento(s) confirmado(s) · {brl(total)} registrados por este sistema. Renovações automáticas do cartão aparecem no painel do Mercado Pago.
      </Alert>
      {rows.length === 0 ? (
        <EmptyState title="Nenhum pagamento ainda" description="Os pagamentos por PIX e cartão iniciados pelos clientes aparecem aqui." />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} onRowClick={(p) => p.companyId && onOpen(p.companyId)} />
      )}
    </Stack>
  )
}

// ------------------------------------------------------------ quem entrou
function LoginsTab({ tick }: { tick: number }) {
  const [rows, setRows] = useState<LoginRow[] | null>(null)
  useEffect(() => {
    api.get<{ items: LoginRow[] }>('/platform/logins?limit=300').then((r) => setRows(r.items)).catch(() => setRows([]))
  }, [tick])
  if (!rows) return <LoadingState />
  const failed = rows.filter((row) => !row.ok).length
  const columns: Column<LoginRow>[] = [
    { key: 'at', header: 'Quando', sort: (l) => l.at, render: (l) => fmtDateTime(l.at) },
    { key: 'user', header: 'Usuário', render: (l) => <strong>{l.userName || '—'}</strong> },
    { key: 'company', header: 'Empresa', render: (l) => l.companyName },
    { key: 'channel', header: 'Canal', render: (l) => <ChannelChip channel={l.channel === 'app' ? 'app' : 'site'} /> },
    { key: 'device', header: 'Aparelho', hideBelow: 'lg', render: (l) => l.device || '—' },
    { key: 'ip', header: 'IP', hideBelow: 'md', render: (l) => l.ip || '—' },
    { key: 'ok', header: 'Resultado', render: (l) => <Chip size="small" label={l.ok ? 'Entrou' : 'Falhou'} color={l.ok ? 'success' : 'error'} variant={l.ok ? 'filled' : 'outlined'} /> },
  ]
  return (
    <Stack spacing={2}>
      <Alert severity={failed ? 'warning' : 'info'}>
        Últimos {rows.length} acessos · {failed} tentativa(s) com falha. Muitas falhas seguidas do mesmo IP indicam tentativa de invasão: o sistema já bloqueia o login por 10 minutos após 6 erros.
      </Alert>
      {rows.length === 0 ? <EmptyState title="Nenhum acesso registrado" /> : <DataTable rows={rows} columns={columns} rowKey={(l) => `${l.at}-${l.userName}-${l.ip}`} initialSort={{ key: 'at', dir: 'desc' }} />}
    </Stack>
  )
}

// ------------------------------------------------- atividade: site e aplicativo
interface ActivityItem {
  at: string
  userName: string
  companyName: string
  action: string
  label: string
  kind: string
  channel: 'site' | 'app'
  device: string
  ip: string
  detail: string
}
interface ActivityUser {
  userId: string
  userName: string
  companyName: string
  site: number
  app: number
  lastAt: string
  lastChannel: 'site' | 'app'
  lastAction: string
}
interface ActivityData {
  summary: { appLogins24h: number; siteLogins24h: number; failures24h: number; faceRefused24h: number; resetRequests24h: number; appUsers7d: number; siteUsers7d: number }
  users: ActivityUser[]
  items: ActivityItem[]
}

const KIND_CHIP: Record<string, { label: string; color: 'default' | 'error' | 'warning' | 'info' | 'success' }> = {
  acesso: { label: 'Acesso', color: 'success' },
  rosto: { label: 'Rosto', color: 'info' },
  senha: { label: 'Senha', color: 'warning' },
  seguranca: { label: 'Segurança', color: 'info' },
  alerta: { label: 'Alerta', color: 'error' },
  dados: { label: 'Dados', color: 'default' },
  plataforma: { label: 'Plataforma', color: 'default' },
}

function ChannelChip({ channel }: { channel: 'site' | 'app' }) {
  return <Chip size="small" label={channel === 'app' ? 'Aplicativo' : 'Site'} color={channel === 'app' ? 'primary' : 'default'} variant={channel === 'app' ? 'filled' : 'outlined'} />
}

function ActivityTab({ tick }: { tick: number }) {
  const [data, setData] = useState<ActivityData | null>(null)
  const [channel, setChannel] = useState<'' | 'site' | 'app'>('')
  const [kind, setKind] = useState('')
  const [q, setQ] = useState('')
  useEffect(() => {
    const params = new URLSearchParams({ limit: '400' })
    if (channel) params.set('channel', channel)
    if (kind) params.set('kind', kind)
    if (q.trim()) params.set('q', q.trim())
    const timer = setTimeout(() => {
      api.get<ActivityData>(`/platform/activity?${params}`).then(setData).catch(() => setData({ summary: { appLogins24h: 0, siteLogins24h: 0, failures24h: 0, faceRefused24h: 0, resetRequests24h: 0, appUsers7d: 0, siteUsers7d: 0 }, users: [], items: [] }))
    }, q ? 300 : 0)
    return () => clearTimeout(timer)
  }, [tick, channel, kind, q])
  if (!data) return <LoadingState />
  const s = data.summary

  const userColumns: Column<ActivityUser>[] = [
    { key: 'user', header: 'Usuário', sort: (u) => u.userName, render: (u) => (<Box><strong>{u.userName || '—'}</strong><Typography variant="caption" color="text.secondary" component="div">{u.companyName}</Typography></Box>) },
    { key: 'app', header: 'No aplicativo', align: 'right', sort: (u) => u.app, render: (u) => u.app },
    { key: 'site', header: 'No site', align: 'right', sort: (u) => u.site, render: (u) => u.site },
    { key: 'last', header: 'Última ação', sort: (u) => u.lastAt, render: (u) => (<Box><Stack direction="row" spacing={1} alignItems="center"><ChannelChip channel={u.lastChannel} /><span>{u.lastAction}</span></Stack><Typography variant="caption" color="text.secondary">{fmtDateTime(u.lastAt)}</Typography></Box>) },
  ]
  const itemColumns: Column<ActivityItem>[] = [
    { key: 'at', header: 'Quando', sort: (i) => i.at, render: (i) => fmtDateTime(i.at) },
    { key: 'user', header: 'Usuário', render: (i) => (<Box><strong>{i.userName || '—'}</strong><Typography variant="caption" color="text.secondary" component="div">{i.companyName}</Typography></Box>) },
    { key: 'channel', header: 'Canal', render: (i) => <ChannelChip channel={i.channel} /> },
    {
      key: 'what',
      header: 'O que fez',
      render: (i) => (
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
            <Chip size="small" label={KIND_CHIP[i.kind]?.label ?? i.kind} color={KIND_CHIP[i.kind]?.color ?? 'default'} variant="outlined" />
            <span>{i.label}</span>
          </Stack>
          {i.detail ? <Typography variant="caption" color="text.secondary">{i.detail}</Typography> : null}
        </Box>
      ),
    },
    { key: 'device', header: 'Aparelho', hideBelow: 'lg', render: (i) => i.device || '—' },
    { key: 'ip', header: 'IP', hideBelow: 'lg', render: (i) => i.ip || '—' },
  ]

  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 2 }}><StatCard label="Entradas no app (24 h)" value={s.appLogins24h} tone="brand" hint={`${s.appUsers7d} pessoa(s) em 7 dias`} /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard label="Entradas no site (24 h)" value={s.siteLogins24h} hint={`${s.siteUsers7d} pessoa(s) em 7 dias`} /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard label="Falhas de login (24 h)" value={s.failures24h} tone={s.failures24h ? 'warning' : 'default'} /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard label="Rostos recusados (24 h)" value={s.faceRefused24h} tone={s.faceRefused24h ? 'error' : 'default'} /></Grid>
        <Grid size={{ xs: 6, md: 2 }}><StatCard label="Pedidos de nova senha (24 h)" value={s.resetRequests24h} tone={s.resetRequests24h ? 'warning' : 'default'} /></Grid>
      </Grid>

      <Panel title="Quem está usando (7 dias)" subtitle="Quantas ações cada pessoa fez no aplicativo e no site" padded={false}>
        {data.users.length === 0 ? <EmptyState title="Nenhuma atividade nos últimos 7 dias" /> : <DataTable rows={data.users} columns={userColumns} rowKey={(u) => u.userId} initialSort={{ key: 'last', dir: 'desc' }} />}
      </Panel>

      <Panel
        title="Tudo o que aconteceu"
        subtitle="Acessos, rosto, pedidos de nova senha, segurança e alterações de dados, no site e no aplicativo"
        actions={
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <ToggleButtonGroup size="small" exclusive value={channel} onChange={(_, v) => setChannel((v ?? '') as '' | 'site' | 'app')}>
              <ToggleButton value="">Tudo</ToggleButton>
              <ToggleButton value="app">Aplicativo</ToggleButton>
              <ToggleButton value="site">Site</ToggleButton>
            </ToggleButtonGroup>
            <TextField select size="small" value={kind} onChange={(e) => setKind(e.target.value)} sx={{ minWidth: 150 }} label="Tipo">
              <MenuItem value="">Todos</MenuItem>
              <MenuItem value="acesso">Acessos</MenuItem>
              <MenuItem value="alerta">Alertas</MenuItem>
              <MenuItem value="rosto">Rosto</MenuItem>
              <MenuItem value="senha">Senha</MenuItem>
              <MenuItem value="seguranca">Segurança</MenuItem>
              <MenuItem value="dados">Dados</MenuItem>
              <MenuItem value="plataforma">Plataforma</MenuItem>
            </TextField>
            <SearchField value={q} onChange={setQ} placeholder="Buscar pessoa, empresa, IP…" />
          </Stack>
        }
        padded={false}
      >
        {data.items.length === 0 ? <EmptyState title="Nada encontrado" description="Ajuste os filtros." /> : <DataTable rows={data.items} columns={itemColumns} rowKey={(i) => `${i.at}-${i.userName}-${i.action}-${i.ip}`} initialSort={{ key: 'at', dir: 'desc' }} />}
      </Panel>
    </Stack>
  )
}

// ------------------------------------------------- verificação facial do aplicativo
interface FaceProfileRow {
  id: string
  userId: string
  userName: string
  email: string
  companyName: string
  enrolledAt: string
  device: string
  consentAt: string
  consentVersion: string
}
interface FaceCheckRow {
  id: string
  userId: string
  userName: string
  companyName: string
  result: string
  kind: string
  distance: number | null
  at: string
  ip: string
  device: string
  hasPhoto: boolean
}

const FACE_RESULT: Record<string, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
  aprovado: { label: 'Reconhecido', color: 'success' },
  cadastrado: { label: 'Rosto cadastrado', color: 'default' },
  recusado: { label: 'Não era a pessoa', color: 'error' },
  sem_rosto: { label: 'Sem rosto na foto', color: 'warning' },
  varios_rostos: { label: 'Mais de um rosto', color: 'warning' },
  rosto_pequeno: { label: 'Rosto pequeno', color: 'warning' },
  imagem_invalida: { label: 'Imagem inválida', color: 'warning' },
}

/** Foto protegida: o navegador só consegue pedir com a sessão, então baixamos como arquivo e mostramos. */
function AuthPhoto({ path, size = 64, onOpen }: { path: string; size?: number; onOpen?: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    let created: string | null = null
    const token = tokenStore.get()
    fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error('foto'))))
      .then((blob) => {
        created = URL.createObjectURL(blob)
        if (alive) setUrl(created)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
      if (created) URL.revokeObjectURL(created)
    }
  }, [path])
  const box = { width: size, height: size, borderRadius: 2, border: `1px solid ${colors.border}`, bgcolor: colors.subtle, objectFit: 'cover' as const, display: 'block' }
  if (failed) return <Box sx={{ ...box, display: 'grid', placeItems: 'center', fontSize: 11, color: 'text.secondary' }}>sem foto</Box>
  if (!url) return <Box sx={box} />
  return <Box component="img" src={url} alt="Rosto" sx={{ ...box, cursor: onOpen ? 'zoom-in' : 'default' }} onClick={() => onOpen?.(url)} />
}

function FacesTab({ tick }: { tick: number }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [data, setData] = useState<{ profiles: FaceProfileRow[]; checks: FaceCheckRow[]; retentionDays: number; engine?: { ok: boolean; reason: string | null; name: string | null } } | null>(null)
  const [zoom, setZoom] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    api
      .get<{ profiles: FaceProfileRow[]; checks: FaceCheckRow[]; retentionDays: number; engine?: { ok: boolean; reason: string | null; name: string | null } }>('/platform/faces')
      .then(setData)
      .catch(() => setData({ profiles: [], checks: [], retentionDays: 30 }))
  }, [tick, refresh])
  if (!data) return <LoadingState />

  const refused = data.checks.filter((c) => c.result === 'recusado').length
  const profileColumns: Column<FaceProfileRow>[] = [
    { key: 'photo', header: 'Rosto', render: (p) => <AuthPhoto path={`/platform/faces/profile/${p.id}/photo`} onOpen={setZoom} /> },
    { key: 'user', header: 'Usuário', sort: (p) => p.userName, render: (p) => (<Box><strong>{p.userName}</strong><Typography variant="caption" color="text.secondary" component="div">{p.email}</Typography></Box>) },
    { key: 'company', header: 'Empresa', hideBelow: 'md', render: (p) => p.companyName },
    { key: 'device', header: 'Aparelho', hideBelow: 'lg', render: (p) => p.device || '—' },
    { key: 'at', header: 'Cadastrado', sort: (p) => p.enrolledAt, render: (p) => fmtDateTime(p.enrolledAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (p) => (
        <Button
          size="small"
          color="error"
          onClick={async () => {
            if (!(await confirm({ title: 'Redefinir o rosto?', message: `${p.userName} precisará cadastrar o rosto de novo no próximo acesso pelo aplicativo.`, confirmLabel: 'Redefinir', danger: true }))) return
            try {
              await api.post(`/platform/faces/profile/${p.id}/revoke`, {})
              toast.success('Cadastro facial removido.')
              setRefresh((n) => n + 1)
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Não foi possível redefinir.')
            }
          }}
        >
          Redefinir
        </Button>
      ),
    },
  ]
  const checkColumns: Column<FaceCheckRow>[] = [
    { key: 'photo', header: 'Foto', render: (c) => (c.hasPhoto ? <AuthPhoto path={`/platform/faces/check/${c.id}/photo`} size={48} onOpen={setZoom} /> : '—') },
    { key: 'at', header: 'Quando', sort: (c) => c.at, render: (c) => fmtDateTime(c.at) },
    { key: 'user', header: 'Usuário', render: (c) => (<Box><strong>{c.userName}</strong><Typography variant="caption" color="text.secondary" component="div">{c.companyName}</Typography></Box>) },
    { key: 'result', header: 'Resultado', render: (c) => <Chip size="small" label={FACE_RESULT[c.result]?.label ?? c.result} color={FACE_RESULT[c.result]?.color ?? 'default'} variant={c.result === 'aprovado' ? 'filled' : 'outlined'} /> },
    { key: 'kind', header: 'Etapa', hideBelow: 'md', render: (c) => (c.kind === 'enroll' ? 'Cadastro' : c.kind === 'recheck' ? 'Reabertura do app' : 'Entrada') },
    { key: 'distance', header: 'Diferença', hideBelow: 'lg', align: 'right', render: (c) => (c.distance === null ? '—' : c.distance.toFixed(2).replace('.', ',')) },
    { key: 'ip', header: 'IP', hideBelow: 'lg', render: (c) => c.ip || '—' },
  ]

  return (
    <Stack spacing={2.5}>
      {data.engine && !data.engine.ok ? (
        <Alert severity="error">
          O reconhecimento facial não está funcionando no servidor{data.engine.reason ? `: ${data.engine.reason}` : ''}. Enquanto isso o aplicativo não consegue entrar. Atualize o servidor (publicar.sh --build) e confira os registros.
        </Alert>
      ) : data.engine ? (
        <Alert severity="success">Reconhecimento facial ativo no servidor.</Alert>
      ) : null}
      <Alert severity={refused ? 'warning' : 'info'}>
        No aplicativo, depois da senha, a pessoa confirma o rosto. Aqui você vê quem cadastrou o rosto e cada tentativa, com a foto. {refused} tentativa(s) recusada(s) nas últimas {data.checks.length}.
        As fotos das tentativas são apagadas depois de {data.retentionDays} dias. Quem esquecer o aparelho ou trocar de rosto (ex.: cirurgia) pode ser redefinido aqui.
      </Alert>
      <Panel title={`Rostos cadastrados (${data.profiles.length})`} subtitle="Cadastro feito pelo próprio usuário no aplicativo, com consentimento" padded={false}>
        {data.profiles.length === 0 ? <EmptyState title="Nenhum rosto cadastrado ainda" description="O cadastro acontece no primeiro acesso pelo aplicativo Android." /> : <DataTable rows={data.profiles} columns={profileColumns} rowKey={(p) => p.id} initialSort={{ key: 'at', dir: 'desc' }} />}
      </Panel>
      <Panel title="Verificações recentes" subtitle="Foto, resultado e a diferença para o rosto cadastrado (quanto menor, mais parecido)" padded={false}>
        {data.checks.length === 0 ? <EmptyState title="Nenhuma verificação registrada" /> : <DataTable rows={data.checks} columns={checkColumns} rowKey={(c) => c.id} initialSort={{ key: 'at', dir: 'desc' }} />}
      </Panel>
      <Dialog open={Boolean(zoom)} onClose={() => setZoom(null)} maxWidth="sm">
        <DialogContent sx={{ p: 1 }}>{zoom ? <Box component="img" src={zoom} alt="Rosto" sx={{ width: '100%', display: 'block', borderRadius: 1 }} /> : null}</DialogContent>
      </Dialog>
    </Stack>
  )
}

// -------------------------------------------------------------- usuários
interface UserPayment {
  status: 'paid' | 'manual' | 'trial' | 'unpaid' | 'expired' | 'suspended' | 'platform'
  label: string
  companyName?: string
  planName?: string
  planPrice?: number
  method?: string | null
  paidUntil?: string | null
  trialEndsAt?: string | null
  lastPaymentAt?: string | null
}

type UserRow = PlatformUser & { payment?: UserPayment; position?: string }

const PAYMENT_CHIP: Record<UserPayment['status'], { color: 'success' | 'info' | 'warning' | 'error' | 'default'; filled: boolean }> = {
  paid: { color: 'success', filled: true },
  manual: { color: 'info', filled: true },
  trial: { color: 'warning', filled: true },
  unpaid: { color: 'error', filled: false },
  expired: { color: 'warning', filled: false },
  suspended: { color: 'error', filled: true },
  platform: { color: 'default', filled: false },
}

const paymentDetail = (payment?: UserPayment) => {
  if (!payment) return ''
  if (payment.status === 'trial') return payment.trialEndsAt ? `teste até ${fmtDateTime(payment.trialEndsAt)}` : 'teste de 48 h'
  if (payment.status === 'paid' || payment.status === 'manual') {
    const method = payment.method === 'pix' ? 'PIX' : payment.method === 'card' ? 'cartão' : 'cortesia'
    return `${payment.planName ?? ''} · ${method}${payment.paidUntil ? ` · até ${fmtDate(payment.paidUntil)}` : ''}`
  }
  if (payment.status === 'expired') return `${payment.planName ?? ''}${payment.paidUntil ? ` · venceu em ${fmtDate(payment.paidUntil)}` : ''}`
  return payment.planName ?? ''
}

const PLATFORM_CHOICE = '__platform__'

type UserFilter = 'all' | 'paid' | 'manual' | 'trial' | 'unpaid' | 'expired' | 'blocked'

function UsersTab({ tick, onChanged }: { tick: number; onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<UserRow[] | null>(null)
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<UserFilter>('all')
  const [secret, setSecret] = useState<{ title: string; password: string; email?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    const handle = window.setTimeout(() => {
      api
        .get<{ items: UserRow[]; summary: Record<string, number> }>(`/platform/users?q=${encodeURIComponent(query)}&status=${filter}`)
        .then((r) => {
          setRows(r.items)
          setSummary(r.summary ?? {})
        })
        .catch(() => setRows([]))
    }, 250)
    return () => window.clearTimeout(handle)
  }, [tick, query, filter])
  if (!rows) return <LoadingState />

  const reset = async (row: UserRow) => {
    if (!(await confirm({ title: 'Redefinir a senha?', message: `${row.name} (${row.email}) será desconectado e receberá uma senha provisória.`, confirmLabel: 'Redefinir' }))) return
    try {
      const result = await api.post<{ temporaryPassword: string }>(`/platform/users/${row.id}/reset-password`)
      setSecret({ title: 'Senha provisória gerada', password: result.temporaryPassword, email: row.email })
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível redefinir.')
    }
  }
  const toggle = async (row: UserRow) => {
    if (row.active && !(await confirm({ title: 'Bloquear o acesso?', message: `${row.name} será desconectado agora e não conseguirá entrar em /login até você desbloquear.`, confirmLabel: 'Bloquear', danger: true }))) return
    try {
      await api.post(`/platform/users/${row.id}/active`, { active: !row.active })
      toast.success(row.active ? 'Acesso bloqueado.' : 'Acesso liberado.')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível alterar.')
    }
  }
  const remove = async (row: UserRow) => {
    if (!(await confirm({ title: 'Excluir este usuário?', message: `${row.name} (${row.email}) será removido definitivamente e perderá o acesso. Os dados da empresa não são apagados.`, confirmLabel: 'Excluir', danger: true }))) return
    try {
      await api.post(`/platform/users/${row.id}/delete`)
      toast.success('Usuário excluído.')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.')
    }
  }

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Usuário', sort: (u) => u.name, render: (u) => (<Box><Typography sx={{ fontWeight: 600 }}>{u.name}</Typography><Typography variant="caption" color="text.secondary">{u.email}</Typography></Box>) },
    { key: 'company', header: 'Empresa', hideBelow: 'md', sort: (u) => u.companyName ?? '', render: (u) => (<Box><Typography variant="body2">{u.companyName}</Typography><Typography variant="caption" color="text.secondary">{ROLE_OPTIONS.find(([key]) => key === u.role)?.[1] ?? u.role}</Typography></Box>) },
    {
      key: 'payment',
      header: 'Pagamento',
      sort: (u) => u.payment?.status ?? '',
      render: (u) => (
        <Box>
          <Chip size="small" label={u.payment?.label ?? '—'} color={PAYMENT_CHIP[u.payment?.status ?? 'platform'].color} variant={PAYMENT_CHIP[u.payment?.status ?? 'platform'].filled ? 'filled' : 'outlined'} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>{paymentDetail(u.payment)}</Typography>
        </Box>
      ),
    },
    { key: 'active', header: 'Acesso', render: (u) => <Chip size="small" label={u.active ? 'Liberado' : 'Bloqueado'} color={u.active ? 'success' : 'error'} variant={u.active ? 'outlined' : 'filled'} /> },
    { key: 'last', header: 'Último acesso', hideBelow: 'lg', sort: (u) => u.lastLoginAt ?? '', render: (u) => (u.lastLoginAt ? fmtDateTime(u.lastLoginAt) : 'nunca') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (u) => (
        <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
          <Button size="small" onClick={() => void reset(u)}>Redefinir senha</Button>
          <Button size="small" color={u.active ? 'warning' : 'primary'} onClick={() => void toggle(u)}>{u.active ? 'Bloquear' : 'Desbloquear'}</Button>
          <Button size="small" color="error" onClick={() => void remove(u)}>Excluir</Button>
        </Stack>
      ),
    },
  ]

  const quick: Array<{ id: UserFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todos', count: Object.entries(summary).filter(([key]) => key !== 'blocked').reduce((sum, [, value]) => sum + value, 0) },
    { id: 'paid', label: 'Pagaram', count: summary.paid ?? 0 },
    { id: 'manual', label: 'Licença manual', count: summary.manual ?? 0 },
    { id: 'trial', label: 'Em teste', count: summary.trial ?? 0 },
    { id: 'unpaid', label: 'Não pagaram', count: summary.unpaid ?? 0 },
    { id: 'expired', label: 'Vencidos', count: summary.expired ?? 0 },
    { id: 'blocked', label: 'Bloqueados', count: summary.blocked ?? 0 },
  ]
  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
        {quick.map((item) => (
          <Chip
            key={item.id}
            clickable
            onClick={() => setFilter(item.id)}
            color={filter === item.id ? 'primary' : 'default'}
            variant={filter === item.id ? 'filled' : 'outlined'}
            label={`${item.label} (${item.count})`}
          />
        ))}
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar por nome, e-mail ou empresa…" width={360} />
        <Button variant="contained" onClick={() => setCreating(true)}>Novo usuário</Button>
        <Typography variant="body2" color="text.secondary">{rows.length} usuário(s) exibido(s)</Typography>
      </Stack>
      {rows.length === 0 ? <EmptyState title="Nenhum usuário encontrado" description="Ajuste a busca ou o filtro, ou crie um novo usuário." /> : <DataTable rows={rows} columns={columns} rowKey={(u) => u.id} />}
      <NewUserDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(password, email) => {
          setCreating(false)
          onChanged()
          if (password) setSecret({ title: 'Acesso criado', password, email })
          else toast.success('Usuário criado.')
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </Stack>
  )
}

/** Cria um acesso para entrar em /login: numa empresa ou na base da plataforma. */
function NewUserDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (password: string | null, email: string) => void }) {
  const toast = useToast()
  const [companiesList, setCompaniesList] = useState<Array<{ id: string; name: string; planName: string; userCount: number; limits: PlanLimits }>>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('comercial')
  const [companyId, setCompanyId] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setName('')
    setEmail('')
    setRole('comercial')
    setCompanyId('')
    setPassword('')
    api.get<{ items: typeof companiesList }>('/platform/companies').then((r) => setCompaniesList(r.items)).catch(() => setCompaniesList([]))
  }, [open])
  const submit = async () => {
    setBusy(true)
    try {
      const result = await api.post<{ temporaryPassword?: string }>('/platform/users', { name, email, role, companyId: companyId === PLATFORM_CHOICE ? null : companyId, ...(password ? { password } : {}) })
      onCreated(result.temporaryPassword ?? null, email)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar o usuário.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Novo usuário</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <TextField label="E-mail de acesso" type="email" value={email} onChange={(e) => setEmail(e.target.value)} helperText="É o usuário usado em /login" />
          <TextField
            select
            required
            label="Empresa"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            helperText={companyId === PLATFORM_CHOICE ? 'Atenção: este acesso enxerga a base original da plataforma (dados próprios da Core Cut).' : 'Escolha a empresa à qual este usuário pertence.'}
            error={companyId === PLATFORM_CHOICE}
          >
            <MenuItem value={PLATFORM_CHOICE}>— Plataforma (base original da Core Cut) —</MenuItem>
            {companiesList.map((company) => (
              <MenuItem key={company.id} value={company.id}>
                {company.name} · {company.planName} · {company.userCount} usuário(s)
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Perfil" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map(([key, label]) => (
              <MenuItem key={key} value={key}>{label}</MenuItem>
            ))}
          </TextField>
          <TextField label="Senha (opcional)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} helperText="Em branco = gera uma senha provisória. O usuário troca no primeiro acesso." />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || name.trim().length < 2 || !email.includes('@') || !companyId}>Criar acesso</Button>
      </DialogActions>
    </Dialog>
  )
}

// --------------------------------------------------------------- sessões
function SessionsTab({ tick }: { tick: number }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  const [local, setLocal] = useState(0)
  useEffect(() => {
    api.get<{ items: SessionRow[] }>('/platform/sessions').then((r) => setRows(r.items)).catch(() => setRows([]))
  }, [tick, local])
  if (!rows) return <LoadingState />
  const revoke = async (row: SessionRow) => {
    if (!(await confirm({ title: 'Encerrar esta sessão?', message: `${row.userName} será desconectado.`, confirmLabel: 'Encerrar', danger: true }))) return
    try {
      await api.post(`/platform/sessions/${row.id}/revoke`)
      toast.success('Sessão encerrada.')
      setLocal((value) => value + 1)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível encerrar.')
    }
  }
  const columns: Column<SessionRow>[] = [
    { key: 'user', header: 'Usuário', render: (s) => (<Box><Typography sx={{ fontWeight: 600 }}>{s.userName}{s.self ? ' (você)' : ''}</Typography><Typography variant="caption" color="text.secondary">{s.email}</Typography></Box>) },
    { key: 'company', header: 'Empresa', hideBelow: 'md', render: (s) => s.companyName },
    { key: 'ip', header: 'IP', hideBelow: 'md', render: (s) => s.ip || '—' },
    { key: 'agent', header: 'Navegador', hideBelow: 'lg', render: (s) => <Typography variant="caption" color="text.secondary">{s.agent.slice(0, 60) || '—'}</Typography> },
    { key: 'since', header: 'Entrou em', sort: (s) => s.createdAt, render: (s) => fmtDateTime(s.createdAt) },
    { key: 'actions', header: '', align: 'right', render: (s) => (s.self ? null : <Button size="small" color="error" onClick={() => void revoke(s)}>Encerrar</Button>) },
  ]
  return (
    <Stack spacing={2}>
      <Alert severity="info">{rows.length} sessão(ões) ativa(s) agora. As sessões expiram após 12 horas sem uso.</Alert>
      {rows.length === 0 ? <EmptyState title="Nenhuma sessão ativa" /> : <DataTable rows={rows} columns={columns} rowKey={(s) => s.id} />}
    </Stack>
  )
}

// ------------------------------------------------------------ financeiro
interface Finance {
  mrr: number
  arr: number
  payingCustomers: number
  arpu: number
  manualLicenses: number
  trialsOpen: number
  trialsLost: number
  signups: number
  conversionRate: number
  churned30d: number
  churnRate: number
  revenueByMonth: { month: string; amount: number; payments: number }[]
  byPlan: { planId: string; planName: string; customers: number; mrr: number }[]
  upcomingRenewals: { companyId: string; companyName: string; planName?: string; paidUntil: string; amount: number }[]
  churnedCompanies: { companyId: string; companyName: string; planName?: string; paidUntil: string }[]
}

function FinanceTab({ tick, onOpen }: { tick: number; onOpen: (id: string) => void }) {
  const [data, setData] = useState<Finance | null>(null)
  useEffect(() => {
    api.get<Finance>('/platform/finance').then(setData).catch(() => setData(null))
  }, [tick])
  if (!data) return <LoadingState />
  const maxRevenue = Math.max(1, ...data.revenueByMonth.map((m) => m.amount))
  const monthLabel = (m: string) => `${m.slice(5)}/${m.slice(2, 4)}`
  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Receita recorrente (MRR)" value={brl(data.mrr)} hint={`ARR ${brl(data.arr)}`} tone="success" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Clientes pagantes" value={data.payingCustomers} hint={`ticket médio ${brl(data.arpu)}${data.manualLicenses ? ` · ${data.manualLicenses} licença(s) manual(is)` : ''}`} tone="brand" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Conversão do teste" value={`${data.conversionRate}%`} hint={`${data.signups} cadastros · ${data.trialsOpen} em teste · ${data.trialsLost} não converteram`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Churn (30 dias)" value={`${data.churnRate}%`} hint={`${data.churned30d} cliente(s) perdido(s)`} tone={data.churned30d ? 'warning' : 'success'} /></Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Panel title="Receita recebida por mês" subtitle="Pagamentos aprovados (sem cobranças de teste)">
            <Stack direction="row" spacing={1.5} alignItems="flex-end" sx={{ height: 190, pt: 1 }}>
              {data.revenueByMonth.map((m) => (
                <Box key={m.month} sx={{ flex: 1, textAlign: 'center' }}>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>{m.amount ? brl(m.amount) : '—'}</Typography>
                  <Box sx={{ height: Math.max(4, Math.round((m.amount / maxRevenue) * 130)), bgcolor: colors.brand, borderRadius: 1, mt: 0.5 }} />
                  <Typography variant="caption" color="text.secondary">{monthLabel(m.month)}</Typography>
                </Box>
              ))}
            </Stack>
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Panel title="Receita por plano" subtitle="Clientes pagantes agora">
            {data.byPlan.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Nenhum cliente pagante ainda.</Typography>
            ) : (
              <Stack spacing={1}>
                {data.byPlan.map((p) => (
                  <Stack key={p.planId} direction="row" justifyContent="space-between">
                    <Typography variant="body2">{p.planName} · {p.customers} cliente(s)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{brl(p.mrr)}/mês</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel title="Renovações nos próximos 7 dias" subtitle="PIX: o cliente precisa pagar de novo">
            {data.upcomingRenewals.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Nenhuma renovação por PIX nesta semana.</Typography>
            ) : (
              <Stack spacing={1}>
                {data.upcomingRenewals.map((r) => (
                  <Stack key={r.companyId} direction="row" justifyContent="space-between" onClick={() => onOpen(r.companyId)} sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2">{r.companyName}{r.planName ? ` · ${r.planName}` : ''}</Typography>
                    <Typography variant="body2" color="text.secondary">{fmtDate(r.paidUntil)} · {brl(r.amount)}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel title="Clientes perdidos (30 dias)" subtitle="Já pagaram e ficaram sem acesso">
            {data.churnedCompanies.length === 0 ? (
              <Alert severity="success">Nenhum cliente pagante foi perdido nos últimos 30 dias.</Alert>
            ) : (
              <Stack spacing={1}>
                {data.churnedCompanies.map((r) => (
                  <Stack key={r.companyId} direction="row" justifyContent="space-between" onClick={() => onOpen(r.companyId)} sx={{ cursor: 'pointer' }}>
                    <Typography variant="body2">{r.companyName}{r.planName ? ` · ${r.planName}` : ''}</Typography>
                    <Typography variant="body2" color="text.secondary">venceu em {fmtDate(r.paidUntil)}</Typography>
                  </Stack>
                ))}
              </Stack>
            )}
          </Panel>
        </Grid>
      </Grid>
    </Stack>
  )
}

// ------------------------------------------------------ monitoramento
interface Monitor {
  startedAt: string
  uptimeSeconds: number
  node: string
  environment: string
  time: string
  last5min: { requests: number; perMinute: number; byClass: Record<string, number>; errorRate: number; p50: number; p95: number; max: number }
  lastHour: { requests: number; perMinute: number; byClass: Record<string, number>; errorRate: number; p50: number; p95: number; max: number }
  slowestRoutes: { route: string; count: number; avgMs: number; maxMs: number; errors: number }[]
  busiestRoutes: { route: string; count: number; avgMs: number; maxMs: number; errors: number }[]
  recentErrors: { at: string; route: string; message: string }[]
  email?: { enabled: boolean; host: string | null; from: string | null; ok: number; failed: number; lastError: string | null } | null
  recentClientErrors?: { at: string; lastAt: string; count: number; page: string; where: string; message: string; stack: string; user: string }[]
  blockedByRateLimit: number
  loginFailures: number
  loginSuccess: number
  eventLoopDelayMs: number
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number; systemFreeBytes: number; systemTotalBytes: number }
  load: number[]
  cpus: number
  database: { engine: string; ok: boolean; latencyMs: number | null; schema: string | null; error?: string }
  disk: { freeBytes: number; totalBytes: number } | null
  totals: { companies: number; users: number; sessionsActive: number; auditEntries: number; failedLogins24h: number }
}

/** Situação do envio de e-mails (recuperação de senha e avisos de cobrança) e botão de teste. */
function EmailPanel({ email }: { email: Monitor['email'] }) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ ok: boolean; reason?: string; to: string }>('/platform/email-test', to.trim() ? { to: to.trim() } : {})
      if (r.ok) toast.success(`E-mail de teste enviado para ${r.to}.`)
      else toast.error(r.reason === 'smtp-desligado' ? 'SMTP não configurado no servidor (SMTP_HOST).' : `Falha no envio: ${r.reason}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Panel title="E-mail (SMTP)" subtitle="Recuperação de senha, aviso de teste acabando, pagamento confirmado e vencimento">
      {!email?.enabled ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Envio desligado: defina <strong>SMTP_HOST, SMTP_USER, SMTP_PASS e MAIL_FROM</strong> no .env do servidor e reinicie o app. Enquanto isso, “Esqueci minha senha” não entrega e-mails.
        </Alert>
      ) : (
        <KeyValue
          columns={2}
          items={[
            { label: 'Servidor', value: email.host ?? '—' },
            { label: 'Remetente', value: email.from ?? '—' },
            { label: 'Enviados / falhas', value: `${email.ok} / ${email.failed}` },
            { label: 'Último erro', value: email.lastError ?? 'nenhum' },
          ]}
        />
      )}
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2, flexWrap: 'wrap', rowGap: 1 }}>
        <TextField size="small" label="Enviar teste para" placeholder="(seu e-mail de login)" value={to} onChange={(e) => setTo(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 300 } }} />
        <Button variant="outlined" onClick={() => void send()} disabled={busy || !email?.enabled}>
          {busy ? 'Enviando…' : 'Enviar e-mail de teste'}
        </Button>
      </Stack>
    </Panel>
  )
}

const fmtBytes = (value: number) => (value >= 1e9 ? `${(value / 1e9).toFixed(1)} GB` : `${Math.round(value / 1e6)} MB`)
const fmtUptime = (seconds: number) => {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`
}

function MonitorTab({ tick }: { tick: number }) {
  const [data, setData] = useState<Monitor | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const load = () =>
      api
        .get<Monitor>('/platform/monitor')
        .then((value) => {
          if (active) {
            setData(value)
            setError('')
          }
        })
        .catch((e) => active && setError(e instanceof Error ? e.message : 'Falha ao consultar o monitoramento.'))
    void load()
    const timer = window.setInterval(load, 15_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [tick])
  if (error && !data) return <Alert severity="error">{error}</Alert>
  if (!data) return <LoadingState />
  const healthy = data.database.ok && data.last5min.errorRate < 5
  const memoryPct = Math.round((data.memory.rssBytes / data.memory.systemTotalBytes) * 100)
  const diskPct = data.disk ? Math.round(((data.disk.totalBytes - data.disk.freeBytes) / data.disk.totalBytes) * 100) : null
  const routeColumns: Column<Monitor['slowestRoutes'][number]>[] = [
    { key: 'route', header: 'Rota', render: (r) => <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{r.route}</Typography> },
    { key: 'count', header: 'Chamadas', align: 'right', sort: (r) => r.count, render: (r) => r.count },
    { key: 'avg', header: 'Média', align: 'right', sort: (r) => r.avgMs, render: (r) => `${r.avgMs} ms` },
    { key: 'max', header: 'Máx.', align: 'right', sort: (r) => r.maxMs, render: (r) => `${r.maxMs} ms` },
    { key: 'err', header: 'Erros 5xx', align: 'right', render: (r) => (r.errors ? <Chip size="small" color="error" label={r.errors} /> : '0') },
  ]
  return (
    <Stack spacing={2.5}>
      <Alert severity={healthy ? 'success' : 'warning'} icon={false}>
        <strong>{healthy ? 'Sistema saudável' : 'Atenção: verifique os indicadores abaixo'}</strong> · no ar há {fmtUptime(data.uptimeSeconds)} (desde {fmtDateTime(data.startedAt)}) · Node {data.node} · ambiente {data.environment} · atualiza a cada 15 s
      </Alert>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Requisições / min" value={data.last5min.perMinute} hint={`${data.last5min.requests} nos últimos 5 min`} tone="brand" /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Erros do servidor (5xx)" value={`${data.last5min.errorRate}%`} hint={`${data.last5min.byClass['5xx']} erro(s) em 5 min`} tone={data.last5min.errorRate > 0 ? 'error' : 'success'} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Latência p95" value={`${data.last5min.p95} ms`} hint={`mediana ${data.last5min.p50} ms · máx. ${data.last5min.max} ms`} tone={data.last5min.p95 > 1500 ? 'warning' : 'default'} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Banco de dados" value={data.database.ok ? (data.database.latencyMs !== null ? `${data.database.latencyMs} ms` : 'Online') : 'Fora do ar'} hint={`${data.database.engine}${data.database.schema ? ` · ${data.database.schema}` : ''}`} tone={data.database.ok ? 'success' : 'error'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Memória do processo" value={fmtBytes(data.memory.rssBytes)} hint={`heap ${fmtBytes(data.memory.heapUsedBytes)} · sistema ${memoryPct}% usado`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Disco de dados" value={data.disk ? fmtBytes(data.disk.freeBytes) : '—'} hint={data.disk ? `livre · ${diskPct}% usado` : 'indisponível'} tone={diskPct !== null && diskPct > 85 ? 'warning' : 'default'} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Sessões ativas" value={data.totals.sessionsActive} hint={`${data.totals.companies} empresas · ${data.totals.users} usuários`} /></Grid>
        <Grid size={{ xs: 6, md: 3 }}><StatCard label="Atraso do event loop" value={`${data.eventLoopDelayMs} ms`} hint={`carga ${data.load.map((value) => value.toFixed(2)).join(' / ')} · ${data.cpus} CPU`} tone={data.eventLoopDelayMs > 100 ? 'warning' : 'default'} /></Grid>
      </Grid>

      <EmailPanel email={data.email ?? null} />

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel title="Segurança em tempo real" subtitle="Desde a última reinicialização">
            <KeyValue
              columns={2}
              items={[
                { label: 'Logins com sucesso', value: String(data.loginSuccess) },
                { label: 'Logins com falha', value: String(data.loginFailures) },
                { label: 'Falhas nas últimas 24 h', value: String(data.totals.failedLogins24h) },
                { label: 'Bloqueios por excesso de requisições', value: String(data.blockedByRateLimit) },
              ]}
            />
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel title="Última hora" subtitle="Resumo de todas as chamadas à API">
            <KeyValue
              columns={2}
              items={[
                { label: 'Requisições', value: String(data.lastHour.requests) },
                { label: 'Respostas 2xx / 3xx', value: `${data.lastHour.byClass['2xx']} / ${data.lastHour.byClass['3xx']}` },
                { label: 'Erros do cliente (4xx)', value: String(data.lastHour.byClass['4xx']) },
                { label: 'Erros do servidor (5xx)', value: String(data.lastHour.byClass['5xx']) },
              ]}
            />
          </Panel>
        </Grid>
      </Grid>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel title="Rotas mais lentas (1 h)" padded={false}>
            {data.slowestRoutes.length ? <DataTable rows={data.slowestRoutes} columns={routeColumns} rowKey={(r) => r.route} paginate={false} dense /> : <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Sem tráfego registrado ainda.</Typography></Box>}
          </Panel>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Panel title="Rotas mais usadas (1 h)" padded={false}>
            {data.busiestRoutes.length ? <DataTable rows={data.busiestRoutes} columns={routeColumns} rowKey={(r) => r.route} paginate={false} dense /> : <Box sx={{ p: 2 }}><Typography variant="body2" color="text.secondary">Sem tráfego registrado ainda.</Typography></Box>}
          </Panel>
        </Grid>
      </Grid>

      <Panel title="Erros do navegador" subtitle="Telas que quebraram para algum usuário (desde a última reinicialização)">
        {!data.recentClientErrors?.length ? (
          <Alert severity="success">Nenhuma tela quebrou para os usuários.</Alert>
        ) : (
          <Stack spacing={1}>
            {data.recentClientErrors.map((entry, index) => (
              <Box key={`${entry.at}-${index}`} sx={{ p: 1.25, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {fmtDateTime(entry.lastAt)} · <span style={{ fontFamily: 'monospace' }}>{entry.page || '/'}</span>
                  {entry.count > 1 ? ` · ${entry.count}×` : ''}
                </Typography>
                <Typography variant="caption" color="error" sx={{ display: 'block' }}>{entry.message}</Typography>
                <Typography variant="caption" color="text.secondary">{entry.user}</Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Panel>

      <Panel title="Erros recentes do servidor" subtitle="HTTP 500 desde a última reinicialização">
        {data.recentErrors.length === 0 ? (
          <Alert severity="success">Nenhum erro interno registrado.</Alert>
        ) : (
          <Stack spacing={1}>
            {data.recentErrors.map((entry, index) => (
              <Box key={`${entry.at}-${index}`} sx={{ p: 1.25, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{fmtDateTime(entry.at)} · <span style={{ fontFamily: 'monospace' }}>{entry.route}</span></Typography>
                <Typography variant="caption" color="text.secondary">{entry.message}</Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Panel>
    </Stack>
  )
}

// ----------------------------------------------------------- segurança
interface SecurityCheck {
  id: string
  severity: 'high' | 'medium' | 'low'
  ok: boolean
  title: string
  detail: string
}

function SecurityTab({ tick }: { tick: number }) {
  const [data, setData] = useState<{ checks: SecurityCheck[]; score: number } | null>(null)
  useEffect(() => {
    api.get<{ checks: SecurityCheck[]; score: number }>('/platform/security').then(setData).catch(() => undefined)
  }, [tick])
  if (!data) return <LoadingState />
  const failing = data.checks.filter((check) => !check.ok)
  const tone = data.score >= 90 ? 'success' : data.score >= 70 ? 'warning' : 'error'
  const severityLabel = { high: 'Crítico', medium: 'Importante', low: 'Baixo' } as const
  return (
    <Stack spacing={2.5}>
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}><StatCard label="Nota da configuração" value={`${data.score}/100`} hint={`${failing.length} ponto(s) a corrigir`} tone={tone} /></Grid>
        <Grid size={{ xs: 12, md: 8 }}>
          <Alert severity={failing.length ? 'warning' : 'success'} sx={{ height: '100%', alignItems: 'center' }}>
            {failing.length ? `Corrija: ${failing.map((check) => check.title).join('; ')}.` : 'Configuração de segurança em ordem.'}
          </Alert>
        </Grid>
      </Grid>

      <Panel title="Verificação da configuração do servidor" subtitle="Lida diretamente das variáveis e do estado atual do sistema">
        <Stack spacing={1}>
          {data.checks.map((check) => (
            <Box key={check.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
              <Chip size="small" color={check.ok ? 'success' : check.severity === 'high' ? 'error' : 'warning'} label={check.ok ? 'OK' : severityLabel[check.severity]} sx={{ minWidth: 86 }} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>{check.title}</Typography>
                <Typography variant="caption" color="text.secondary">{check.detail}</Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      </Panel>

      <Panel title="Varredura externa do site" subtitle="Testa o endereço publicado como um atacante faria (somente leitura)">
        <Stack spacing={1.5}>
          <Typography variant="body2">
            No seu computador, na pasta do projeto, execute o comando abaixo. Ele confere HTTPS/TLS, cabeçalhos, arquivos expostos, rotas protegidas, CORS e portas abertas:
          </Typography>
          <Box component="code" sx={{ display: 'block', p: 1.5, bgcolor: '#13232b', color: '#cfe9f0', borderRadius: 2, fontFamily: 'monospace', fontSize: '0.9rem' }}>
            npm run security:scan -- https://www.cutcore.com.br
          </Box>
          <Typography variant="caption" color="text.secondary">
            Rode depois de cada publicação. Falhas aparecem em vermelho e fazem o comando terminar com erro.
          </Typography>
        </Stack>
      </Panel>
    </Stack>
  )
}

// ------------------------------------------------- teste de cobrança
type TestState = 'pending' | 'paid' | 'expired'

function PaymentTestTab({ onChanged }: { onChanged: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [method, setMethod] = useState<'pix' | 'card'>('pix')
  const [amount, setAmount] = useState(1)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [pix, setPix] = useState<{ ref: string; pix: PixPayload } | null>(null)
  const [paidAmount, setPaidAmount] = useState<number | null>(null)
  const [card, setCard] = useState<{ ref: string; amount: number; checkoutUrl: string; state: TestState; cancelled: boolean } | null>(null)

  // acompanha a autorização do cartão em segundo plano
  useEffect(() => {
    if (!card || card.state !== 'pending') return
    const timer = window.setInterval(async () => {
      try {
        const status = await api.get<{ state: TestState }>(`/billing/checkout-status?ref=${encodeURIComponent(card.ref)}`)
        if (status.state !== 'pending') setCard((current) => (current ? { ...current, state: status.state } : current))
      } catch {
        /* tenta no próximo ciclo */
      }
    }, 4000)
    return () => window.clearInterval(timer)
  }, [card])

  const start = async () => {
    setBusy(true)
    setPaidAmount(null)
    try {
      const result = await api.post<{ ref: string; amount: number; pix?: PixPayload; checkoutUrl?: string }>('/platform/payment-test', {
        method,
        amount,
        ...(email.trim() ? { payerEmail: email.trim() } : {}),
      })
      if (result.pix) setPix({ ref: result.ref, pix: result.pix })
      else if (result.checkoutUrl) {
        setCard({ ref: result.ref, amount: result.amount, checkoutUrl: result.checkoutUrl, state: 'pending', cancelled: false })
        window.open(result.checkoutUrl, '_blank', 'noopener')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar o teste.')
    } finally {
      setBusy(false)
    }
  }

  const cancelCard = async () => {
    if (!card) return
    if (!(await confirm({ title: 'Cancelar a assinatura de teste?', message: 'Isso encerra as cobranças futuras. Faça isso depois que a primeira cobrança aparecer no Mercado Pago.', confirmLabel: 'Cancelar assinatura' }))) return
    try {
      await api.post(`/platform/payment-test/${card.ref}/cancel`)
      setCard({ ...card, cancelled: true })
      toast.success('Assinatura de teste cancelada.')
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível cancelar.')
    }
  }

  return (
    <Stack spacing={2.5}>
      <Alert severity="warning">
        Este teste faz uma <strong>cobrança real</strong> na sua conta do Mercado Pago, sem alterar nenhuma empresa e sem contar na receita do painel. Valores de R$ 1,00 a R$ 50,00. Depois, confira em <strong>Mercado Pago → Seu negócio → Atividade</strong> e estorne por lá se quiser.
      </Alert>

      <Panel title="Gerar cobrança de teste" subtitle="Confirma que o pagamento chega na conta configurada no servidor">
        <Stack spacing={2.5} sx={{ maxWidth: 560 }}>
          <Stack direction="row" spacing={1}>
            <Button variant={method === 'pix' ? 'contained' : 'outlined'} onClick={() => setMethod('pix')}>PIX (pagamento único)</Button>
            <Button variant={method === 'card' ? 'contained' : 'outlined'} onClick={() => setMethod('card')}>Cartão (assinatura)</Button>
          </Stack>
          <TextField select size="small" label="Valor" value={amount} onChange={(e) => setAmount(Number(e.target.value))} sx={{ maxWidth: 200 }}>
            {[1, 2, 5, 10].map((value) => (
              <MenuItem key={value} value={value}>{brl(value)}</MenuItem>
            ))}
          </TextField>
          {method === 'card' ? (
            <>
              <TextField label="E-mail da conta Mercado Pago de quem vai pagar" type="email" value={email} onChange={(e) => setEmail(e.target.value)} helperText="Precisa ser outra conta, diferente da sua conta de vendedor: o Mercado Pago não permite pagar para si mesmo." />
              <Alert severity="info">
                No cartão o teste cria uma <strong>assinatura mensal</strong> do valor escolhido. A primeira cobrança acontece em até cerca de 1 hora; <strong>cancele logo depois</strong> para não cobrar de novo no mês seguinte.
              </Alert>
            </>
          ) : (
            <TextField label="E-mail do pagador (opcional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} helperText="Pode ficar em branco. O PIX é pago pelo aplicativo do seu banco." />
          )}
          <Box>
            <Button variant="contained" size="large" disabled={busy || (method === 'card' && !email.includes('@'))} onClick={() => void start()}>
              {method === 'pix' ? `Gerar PIX de ${brl(amount)}` : `Abrir pagamento de ${brl(amount)} no cartão`}
            </Button>
          </Box>
        </Stack>
      </Panel>

      {paidAmount !== null ? (
        <Alert severity="success">
          PIX de {brl(paidAmount)} confirmado pelo Mercado Pago. Confira o valor em Mercado Pago → Atividade. Esta cobrança de teste aparece na aba Pagamentos.
        </Alert>
      ) : null}

      {card ? (
        <Panel title={`Assinatura de teste de ${brl(card.amount)}`} subtitle="Aguarda a autorização do cartão na página do Mercado Pago">
          <Stack spacing={1.5}>
            {card.cancelled ? (
              <Alert severity="success">Assinatura de teste cancelada. Nenhuma nova cobrança será feita.</Alert>
            ) : card.state === 'paid' ? (
              <Alert severity="success">Cartão autorizado pelo Mercado Pago. A primeira cobrança ocorre em até cerca de 1 hora. Quando aparecer em Atividade, cancele a assinatura de teste abaixo.</Alert>
            ) : card.state === 'expired' ? (
              <Alert severity="warning">A autorização não foi concluída ou foi cancelada.</Alert>
            ) : (
              <Alert severity="info">Conclua o pagamento na aba que abriu. Se ela não abriu, <a href={card.checkoutUrl} target="_blank" rel="noreferrer">clique aqui</a>. Esta tela atualiza sozinha.</Alert>
            )}
            {!card.cancelled && card.state !== 'expired' ? (
              <Box>
                <Button color="error" variant="outlined" onClick={() => void cancelCard()}>Cancelar assinatura de teste</Button>
              </Box>
            ) : null}
          </Stack>
        </Panel>
      ) : null}

      {pix ? (
        <PixPaymentDialog
          checkoutRef={pix.ref}
          pix={pix.pix}
          title={`PIX de teste de ${brl(pix.pix.amount)}`}
          onClose={() => setPix(null)}
          onPaid={() => {
            setPaidAmount(pix.pix.amount)
            setPix(null)
            toast.success('PIX de teste confirmado!')
            onChanged()
          }}
        />
      ) : null}
    </Stack>
  )
}

// -------------------------------------------------- gaveta da empresa
function CompanyDrawer({ id, onClose, onChanged, tick }: { id: string | null; onClose: () => void; onChanged: () => void; tick: number }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [detail, setDetail] = useState<Detail | null>(null)
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<{ title: string; password: string; email?: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!id) {
      setDetail(null)
      return
    }
    api.get<Detail>(`/platform/companies/${id}`).then(setDetail).catch(() => {
      toast.error('Não foi possível carregar a empresa.')
      onClose()
    })
  }, [id, tick, version]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (path: string, body: unknown, success: string) => {
    if (!id) return
    setBusy(true)
    try {
      await api.post(`/platform/companies/${id}/${path}`, body)
      toast.success(success)
      setVersion((value) => value + 1)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }

  const company = detail?.company
  const remove = async () => {
    if (!company) return
    const typed = window.prompt(`Excluir a empresa e TODOS os dados dela (irreversível).\nDigite o nome exato para confirmar:\n\n${company.name}`)
    if (typed === null) return
    try {
      await api.post(`/platform/companies/${company.id}/delete`, { confirmName: typed })
      toast.success('Empresa excluída.')
      onChanged()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.')
    }
  }

  return (
    <SideDrawer open={Boolean(id)} onClose={onClose} title={company?.name ?? 'Empresa'} subtitle={company ? `${company.planName} · cadastro em ${fmtDate(company.createdAt)}` : undefined} width={640}>
      {!company || !detail ? (
        <LoadingState />
      ) : (
        <Stack spacing={3}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            {stateChip(company.access.state)}
            <Typography variant="body2" color="text.secondary">{company.access.message ?? company.access.warning ?? 'Acesso liberado.'}</Typography>
          </Stack>

          <KeyValue
            columns={2}
            items={[
              { label: 'E-mail', value: company.email },
              { label: 'Telefone', value: company.phone || '—' },
              { label: 'CNPJ / CPF', value: company.document || '—' },
              { label: 'Razão social', value: company.legalName || '—' },
              { label: 'Forma de pagamento', value: methodLabel(company.billingMethod) },
              { label: company.access.state.startsWith('trial') ? 'Teste termina em' : 'Válido até', value: validityOf(company) },
              { label: 'Último pagamento', value: company.lastPaymentAt ? fmtDateTime(company.lastPaymentAt) : '—' },
              { label: 'Último acesso', value: company.lastLoginAt ? fmtDateTime(company.lastLoginAt) : 'nunca' },
              { label: 'Sessões ativas', value: detail.sessions },
              { label: 'Usuários / projetos', value: `${company.usage.users ?? 0} / ${company.usage.projects ?? 0}` },
            ]}
          />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Ações</Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Button size="small" variant="outlined" disabled={busy} onClick={() => void run('trial', { hours: 48 }, 'Teste estendido em 48 horas.')}>+48 h de teste</Button>
              <Button size="small" variant="outlined" disabled={busy} onClick={() => void run('grant', { days: 30 }, 'Licença manual de 30 dias liberada.')}>Liberar 30 dias</Button>
              <Button size="small" variant="outlined" disabled={busy} onClick={() => void run('grant', { days: 365 }, 'Licença manual de 365 dias liberada.')}>Liberar 1 ano</Button>
              <Button size="small" variant="outlined" disabled={busy} onClick={() => setCreating(true)}>Criar credencial</Button>
              <Button size="small" variant={company.fiscalPlatform ? 'contained' : 'outlined'} disabled={busy} onClick={() => void run('fiscal', { enabled: !company.fiscalPlatform }, company.fiscalPlatform ? 'Emissão de nota fiscal bloqueada.' : 'Emissão de nota fiscal liberada com o token da plataforma.')}>
                {company.fiscalPlatform ? 'Nota fiscal: liberada' : 'Liberar nota fiscal'}
              </Button>
              {company.status === 'suspended' ? (
                <Button size="small" variant="contained" disabled={busy} onClick={() => void run('reactivate', {}, 'Empresa reativada.')}>Reativar</Button>
              ) : (
                <Button
                  size="small"
                  color="error"
                  variant="outlined"
                  disabled={busy}
                  onClick={async () => {
                    if (await confirm({ title: 'Suspender a empresa?', message: 'Todos os usuários serão desconectados e perderão o acesso.', confirmLabel: 'Suspender', danger: true })) await run('suspend', {}, 'Empresa suspensa.')
                  }}
                >
                  Suspender
                </Button>
              )}
              <Button size="small" color="error" disabled={busy} onClick={() => void remove()}>Excluir empresa</Button>
            </Stack>
            <TextField
              select
              size="small"
              label="Alterar plano"
              value={company.planId}
              onChange={(e) => void run('plan', { planId: e.target.value }, 'Plano alterado.')}
              sx={{ mt: 2, minWidth: 220 }}
            >
              <MenuItem value="essencial">Essencial — R$ 99</MenuItem>
              <MenuItem value="profissional">Profissional — R$ 199</MenuItem>
              <MenuItem value="industrial">Industrial — R$ 399</MenuItem>
            </TextField>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Usuários ({detail.users.length})</Typography>
            <Stack spacing={1}>
              {detail.users.map((member) => (
                <Box key={member.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, p: 1.25, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>{member.name}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>{member.email} · {ROLE_OPTIONS.find(([key]) => key === member.role)?.[1] ?? member.role}</Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>{member.lastLoginAt ? fmtDateTime(member.lastLoginAt) : 'nunca entrou'}</Typography>
                </Box>
              ))}
            </Stack>
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Pagamentos ({detail.payments.length})</Typography>
            {detail.payments.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Nenhum pagamento iniciado.</Typography>
            ) : (
              <Stack spacing={1}>
                {detail.payments.map((payment) => (
                  <Box key={payment.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, p: 1.25, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
                    <Box>
                      <Typography sx={{ fontWeight: 600 }}>{brl(payment.amount)} · {payment.planName}</Typography>
                      <Typography variant="caption" color="text.secondary">{payment.method === 'pix' ? `PIX · ${payment.months} mês(es)` : 'Cartão · mensal'} · {fmtDateTime(payment.paidAt ?? payment.createdAt)}</Typography>
                    </Box>
                    {paymentChip(payment.state)}
                  </Box>
                ))}
              </Stack>
            )}
          </Box>

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Últimos acessos</Typography>
            {detail.logins.length === 0 ? (
              <Typography variant="body2" color="text.secondary">Ninguém desta empresa entrou ainda.</Typography>
            ) : (
              <Stack spacing={0.5}>
                {detail.logins.slice(0, 10).map((login, index) => (
                  <Typography key={`${login.at}-${index}`} variant="body2" color="text.secondary">
                    {fmtDateTime(login.at)} — {login.userName} {login.ip ? `(${login.ip})` : ''}
                  </Typography>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      )}

      <CreateUserDialog
        open={creating}
        companyId={id}
        onClose={() => setCreating(false)}
        onCreated={(password, email) => {
          setCreating(false)
          setVersion((value) => value + 1)
          onChanged()
          if (password) setSecret({ title: 'Credencial criada', password, email })
          else toast.success('Usuário criado.')
        }}
      />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </SideDrawer>
  )
}

// ----------------------------------------------------------- diálogos
function CreateUserDialog({ open, companyId, onClose, onCreated }: { open: boolean; companyId: string | null; onClose: () => void; onCreated: (password: string | null, email: string) => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('comercial')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) {
      setName('')
      setEmail('')
      setRole('comercial')
      setPassword('')
    }
  }, [open])
  const submit = async () => {
    if (!companyId) return
    setBusy(true)
    try {
      const result = await api.post<{ temporaryPassword?: string }>(`/platform/companies/${companyId}/users`, { name, email, role, ...(password ? { password } : {}) })
      onCreated(result.temporaryPassword ?? null, email)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar o usuário.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Criar credencial na empresa</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <TextField label="E-mail de acesso" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField select label="Perfil" value={role} onChange={(e) => setRole(e.target.value)}>
            {ROLE_OPTIONS.map(([key, label]) => (
              <MenuItem key={key} value={key}>{label}</MenuItem>
            ))}
          </TextField>
          <TextField label="Senha (opcional)" type="password" value={password} onChange={(e) => setPassword(e.target.value)} helperText="Deixe em branco para gerar uma senha provisória." />
          <Typography variant="caption" color="text.secondary">O usuário precisa trocar a senha no primeiro acesso.</Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || name.trim().length < 2 || !email.includes('@')}>Criar</Button>
      </DialogActions>
    </Dialog>
  )
}

function SecretDialog({ secret, onClose }: { secret: { title: string; password: string; email?: string } | null; onClose: () => void }) {
  const toast = useToast()
  const loginUrl = `${window.location.origin}/login`
  const message = secret?.email
    ? `Acesso ao Core Cut ERP\nEndereço: ${loginUrl}\nUsuário: ${secret.email}\nSenha provisória: ${secret.password}\n(a senha deve ser trocada no primeiro acesso)`
    : secret?.password ?? ''
  return (
    <Dialog open={Boolean(secret)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{secret?.title}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>Anote ou copie agora: esta senha não será exibida novamente.</Alert>
        {secret?.email ? <Typography variant="body2" sx={{ mb: 0.5 }}>Endereço: <strong>{loginUrl}</strong></Typography> : null}
        {secret?.email ? <Typography variant="body2" sx={{ mb: 1 }}>Usuário: <strong>{secret.email}</strong></Typography> : null}
        <TextField value={secret?.password ?? ''} fullWidth slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: '1.1rem' } } }} onFocus={(e) => e.target.select()} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret?.password ?? '')
              toast.success('Senha copiada.')
            } catch {
              toast.error('Não foi possível copiar.')
            }
          }}
        >
          Copiar senha
        </Button>
        {secret?.email ? (
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message)
                toast.success('Acesso completo copiado: é só colar no WhatsApp.')
              } catch {
                toast.error('Não foi possível copiar.')
              }
            }}
          >
            Copiar acesso completo
          </Button>
        ) : null}
        <Button variant="contained" onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}
