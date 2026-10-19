import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, DeleteIcon, DownloadIcon, PictureAsPdfIcon } from '../components/icons'
import { DataTable, EmptyState, LoadingState, PageHeader, StatCard, StatusChip, type Column } from '../components/ui'
import { NumberField } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { refreshCollection, useCollections, useCompany } from '../lib/store'
import { budgetTotals } from '../domain/budget'
import { projectCost } from '../domain/projectCost'
import { buildDanfePdf } from '../domain/danfe'
import { invoiceDraftFromBudget, invoiceDraftFromProject, itemDefaults, type InvoiceDraft } from '../domain/invoice'
import { logoBlackWhite } from '../lib/logoBw'
import { brl, downloadBlob, fmtDate, uid } from '../lib/format'
import { colors } from '../theme'
import type { CollectionName, Invoice, InvoiceItem, InvoiceStatus } from '../types'

const STATUS: { value: InvoiceStatus; label: string; color: string }[] = [
  { value: 'rascunho', label: 'Rascunho', color: '#7d838c' },
  { value: 'processando', label: 'Em processamento', color: '#b9852e' },
  { value: 'autorizada', label: 'Autorizada', color: '#2e7d4f' },
  { value: 'rejeitada', label: 'Rejeitada', color: '#b3261e' },
  { value: 'cancelada', label: 'Cancelada', color: '#4c5a67' },
]

type Draft = InvoiceDraft & { id?: string }

const emptyItem = (company: Parameters<typeof itemDefaults>[0], state?: string): InvoiceItem => ({
  id: uid(),
  code: '',
  description: '',
  unit: 'UN',
  quantity: 1,
  unitPrice: 0,
  total: 0,
  ...itemDefaults(company, state),
})

/** Notas fiscais: lista, nova nota a partir de orçamento/projeto aprovado, emissão, consulta e cancelamento. */
export function InvoicesPage() {
  const { can } = useAuth()
  const names = useMemo(() => {
    const n: CollectionName[] = ['invoices', 'budgets', 'projects', 'clients', 'contracts']
    if (can('purchases')) n.push('purchases')
    if (can('production')) n.push('productionOrders', 'workCenters')
    n.push('payables', 'receivables')
    return n
  }, [can])
  const { data, maps, loading } = useCollections(names)
  const company = useCompany()
  const toast = useToast()
  const [editor, setEditor] = useState<Draft | null>(null)
  const [detail, setDetail] = useState<string | null>(null)
  const [fiscal, setFiscal] = useState<{ environment: string; tokens: { homologacao: boolean; producao: boolean }; problems: string[] } | null>(null)

  useEffect(() => {
    api
      .get<typeof fiscal>('/fiscal/status')
      .then(setFiscal)
      .catch(() => setFiscal(null))
  }, [company.cnpj, company.ie, company.taxRegime, company.fiscalEnvironment])

  if (loading) return <LoadingState />

  const rows = [...(data.invoices ?? [])].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const authorized = rows.filter((r) => r.status === 'autorizada')
  const columns: Column<Invoice>[] = [
    {
      key: 'code',
      header: 'Nota',
      sort: (r) => r.code ?? '',
      render: (r) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {r.number ? `NF-e ${r.number}` : (r.code ?? 'Rascunho')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {[r.code, r.environment === 'homologacao' ? 'homologação' : ''].filter(Boolean).join(' · ')}
          </Typography>
        </Box>
      ),
    },
    { key: 'to', header: 'Destinatário', render: (r) => r.recipient?.name ?? '—' },
    {
      key: 'source',
      header: 'Origem',
      hideBelow: 'md',
      render: (r) => (r.projectId ? (maps.projects.get(r.projectId)?.name ?? '—') : r.budgetId ? (maps.budgets.get(r.budgetId)?.title ?? '—') : '—'),
    },
    { key: 'total', header: 'Valor', align: 'right', sort: (r) => r.total, render: (r) => <b>{brl(r.total)}</b> },
    { key: 'date', header: 'Criada', hideBelow: 'lg', sort: (r) => r.createdAt ?? '', render: (r) => (r.createdAt ? fmtDate(r.createdAt) : '—') },
    { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={STATUS} value={r.status} /> },
  ]

  return (
    <Box>
      <PageHeader
        title="Notas fiscais"
        subtitle="NF-e de produto emitida por provedor fiscal a partir de orçamentos e projetos aprovados, com DANFE."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditor({ sourceType: 'orcamento', natureOfOperation: company.fiscalNature || 'Venda de mercadoria', recipient: { name: '', document: '' }, items: [], freight: 0, discount: 0, total: 0 })}>
            Nova nota fiscal
          </Button>
        }
      />

      {fiscal && (fiscal.problems.length > 0 || !fiscal.tokens[fiscal.environment as 'homologacao' | 'producao']) ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {fiscal.problems.length
            ? `Antes de emitir, complete em Configurações → Empresa → Nota fiscal: ${fiscal.problems.join(' ')}`
            : `Falta o token da Focus NFe (${fiscal.environment === 'producao' ? 'produção' : 'homologação'}) em Configurações → Empresa → Nota fiscal.`}
        </Alert>
      ) : null}
      {fiscal?.environment === 'homologacao' ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Ambiente de <b>homologação</b>: as notas são de teste e não têm valor fiscal. Mude para produção em Configurações quando o contador validar.
        </Alert>
      ) : null}

      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Autorizadas" value={authorized.length} tone="success" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Valor autorizado" value={brl(authorized.reduce((s, r) => s + r.total, 0))} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em processamento" value={rows.filter((r) => r.status === 'processando').length} tone="warning" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Rejeitadas" value={rows.filter((r) => r.status === 'rejeitada').length} tone={rows.some((r) => r.status === 'rejeitada') ? 'error' : 'default'} />
        </Grid>
      </Grid>

      <Paper variant="outlined" sx={{ borderRadius: 3 }}>
        {rows.length === 0 ? (
          <EmptyState title="Nenhuma nota fiscal ainda" description="Escolha um orçamento aprovado ou um projeto e gere a primeira nota. Em homologação nada tem valor fiscal." />
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowClick={(r) => setDetail(r.id)} initialSort={{ key: 'date', dir: 'desc' }} />
        )}
      </Paper>

      {editor ? (
        <InvoiceEditor
          draft={editor}
          onClose={() => setEditor(null)}
          onSaved={async (id) => {
            setEditor(null)
            await refreshCollection('invoices')
            if (id) setDetail(id)
          }}
          sources={{ budgets: data.budgets, projects: data.projects, clients: data.clients, contracts: data.contracts }}
          costInput={{ budgets: data.budgets, purchases: data.purchases ?? [], orders: data.productionOrders ?? [], workCenters: data.workCenters ?? [], payables: data.payables ?? [], receivables: data.receivables ?? [] }}
        />
      ) : null}
      {detail && maps.invoices.get(detail) ? (
        <InvoiceDetail
          invoice={maps.invoices.get(detail) as Invoice}
          onClose={() => setDetail(null)}
          onEdit={(inv) => {
            setDetail(null)
            setEditor({ ...inv })
          }}
          onChanged={() => refreshCollection('invoices')}
          toast={toast}
        />
      ) : null}
    </Box>
  )
}

// ----------------------------------------------------------------------------- editor
function InvoiceEditor({
  draft,
  onClose,
  onSaved,
  sources,
  costInput,
}: {
  draft: Draft
  onClose: () => void
  onSaved: (id?: string) => void | Promise<void>
  sources: { budgets: import('../types').Budget[]; projects: import('../types').Project[]; clients: import('../types').Client[]; contracts: import('../types').Contract[] }
  costInput: Parameters<typeof projectCost>[0] extends infer T ? Omit<NonNullable<T>, 'projectId'> : never
}) {
  const company = useCompany()
  const toast = useToast()
  const [d, setD] = useState<Draft>(draft)
  const [busy, setBusy] = useState(false)
  const [includeServices, setIncludeServices] = useState(true)
  const [sourceId, setSourceId] = useState(draft.budgetId ?? draft.projectId ?? '')
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setD((s) => ({ ...s, [key]: value }))
  const approved = sources.budgets.filter((b) => b.status === 'aprovado')

  const totals = useMemo(() => {
    const products = d.items.reduce((s, i) => s + Math.round(i.quantity * i.unitPrice * 100) / 100, 0)
    const total = Math.max(Math.round((products + d.freight - d.discount) * 100) / 100, 0)
    return { products, total }
  }, [d.items, d.freight, d.discount])

  const fromBudget = (id: string, services = includeServices) => {
    const budget = sources.budgets.find((b) => b.id === id)
    if (!budget) return
    const project = sources.projects.find((p) => p.id === budget.projectId)
    const contract = sources.contracts.find((c) => c.budgetId === budget.id || (project && c.projectId === project.id))
    const next = invoiceDraftFromBudget({ budget, client: sources.clients.find((c) => c.id === budget.clientId), project, contract, company, options: { includeServices: services } })
    setD((s) => ({ ...next, id: s.id }))
  }
  const fromProject = (id: string) => {
    const project = sources.projects.find((p) => p.id === id)
    if (!project) return
    const budget = sources.budgets.filter((b) => b.projectId === id && b.status === 'aprovado').at(-1)
    const value = budget ? budgetTotals(budget).total : (project.contractValue ?? 0)
    const contract = sources.contracts.find((c) => c.projectId === id)
    const next = invoiceDraftFromProject({ project, client: sources.clients.find((c) => c.id === project.clientId), value, budgetCode: budget?.code, contract, company })
    setD((s) => ({ ...next, id: s.id, budgetId: budget?.id }))
  }

  const cost = useMemo(() => (d.projectId ? projectCost({ ...(costInput as object), projectId: d.projectId } as Parameters<typeof projectCost>[0]) : null), [d.projectId, costInput])
  const budget = sources.budgets.find((b) => b.id === d.budgetId)
  const budgetTotal = budget ? budgetTotals(budget).total : null

  const patchItem = (id: string, patch: Partial<InvoiceItem>) => set('items', d.items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const setRecipient = (key: string, value: string) => setD((s) => ({ ...s, recipient: { ...s.recipient, [key]: value } }))

  const save = async (emit: boolean) => {
    setBusy(true)
    try {
      const body = { ...d, items: d.items.map((i) => ({ ...i })) }
      const saved = d.id ? await api.put<Invoice>(`/fiscal/invoices/${d.id}`, body) : await api.post<Invoice>('/fiscal/invoices', body)
      if (emit) {
        try {
          await api.post(`/fiscal/invoices/${saved.id}/emit`, {})
          toast.success('Nota enviada ao provedor. Acompanhe a autorização na lista.')
        } catch (e) {
          await refreshCollection('invoices')
          toast.error(e instanceof Error ? e.message : 'Não foi possível emitir a nota.')
          await onSaved(saved.id)
          return
        }
      } else toast.success('Rascunho salvo.')
      await onSaved(saved.id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar a nota.')
    } finally {
      setBusy(false)
    }
  }

  const field = (label: string, key: string, span = 6, props: object = {}) => (
    <Grid size={{ xs: 12, sm: span }}>
      <TextField label={label} size="small" value={(d.recipient as unknown as Record<string, string>)[key] ?? ''} onChange={(e) => setRecipient(key, e.target.value)} {...props} />
    </Grid>
  )

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>{d.id ? 'Editar nota fiscal' : 'Nova nota fiscal'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box>
            <Typography variant="overline" color="primary">
              Gerar a partir de
            </Typography>
            <Stack direction="row" spacing={1.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 1.5 }} alignItems="center">
              <ToggleButtonGroup
                size="small"
                exclusive
                value={d.sourceType}
                onChange={(_, v) => {
                  if (!v) return
                  set('sourceType', v)
                  setSourceId('')
                }}
              >
                <ToggleButton value="orcamento">Orçamento aprovado</ToggleButton>
                <ToggleButton value="projeto">Projeto</ToggleButton>
              </ToggleButtonGroup>
              <TextField
                select
                size="small"
                label={d.sourceType === 'orcamento' ? 'Orçamento' : 'Projeto'}
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value)
                  if (d.sourceType === 'orcamento') fromBudget(e.target.value)
                  else fromProject(e.target.value)
                }}
                sx={{ minWidth: 320 }}
              >
                {(d.sourceType === 'orcamento' ? approved : sources.projects).map((x) => (
                  <MenuItem key={x.id} value={x.id}>
                    {'title' in x ? `${x.code ?? ''} · ${x.title}` : `${(x as { code?: string }).code ?? ''} · ${(x as { name: string }).name}`}
                  </MenuItem>
                ))}
              </TextField>
              {d.sourceType === 'orcamento' ? (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={includeServices}
                      onChange={(e) => {
                        setIncludeServices(e.target.checked)
                        if (sourceId) fromBudget(sourceId, e.target.checked)
                      }}
                    />
                  }
                  label="Incluir instalação e mão de obra"
                />
              ) : null}
            </Stack>
            {d.sourceType === 'orcamento' && includeServices ? (
              <Typography variant="caption" color="text.secondary">
                Instalação e mão de obra costumam ser serviço (NFS-e, na prefeitura). Desmarque se o contador pedir só os produtos nesta nota.
              </Typography>
            ) : null}
          </Box>

          {cost ? (
            <Alert severity={cost.projectedProfit < 0 ? 'warning' : 'info'}>
              Gastos do projeto até agora: <b>{brl(cost.actual)}</b> realizados{cost.committed ? ` + ${brl(cost.committed)} comprometidos` : ''} · receita do orçamento {brl(cost.revenue)} · margem projetada <b>{String(cost.projectedMarginPercent).replace('.', ',')}%</b>.
              {budgetTotal !== null && Math.abs(budgetTotal - totals.total) > 0.05 ? ` Valor desta nota ${brl(totals.total)} × orçamento ${brl(budgetTotal)}.` : ''}
            </Alert>
          ) : budgetTotal !== null && Math.abs(budgetTotal - totals.total) > 0.05 ? (
            <Alert severity="info">
              Valor desta nota {brl(totals.total)} × total do orçamento {brl(budgetTotal)}.
            </Alert>
          ) : null}

          <Box>
            <Typography variant="overline" color="primary">
              Destinatário
            </Typography>
            <Grid container spacing={1.5} sx={{ mt: 0.25 }}>
              {field('Nome / razão social', 'name', 6)}
              {field('CPF ou CNPJ', 'document', 3)}
              {field('Inscrição estadual (se contribuinte)', 'ie', 3)}
              {field('Endereço (rua)', 'address', 5)}
              {field('Número', 'number', 2)}
              {field('Bairro', 'district', 3)}
              {field('CEP', 'zip', 2)}
              {field('Cidade', 'city', 4)}
              {field('UF', 'state', 2, { slotProps: { htmlInput: { maxLength: 2 } } })}
              {field('Telefone', 'phone', 3)}
              {field('E-mail', 'email', 3)}
            </Grid>
          </Box>

          <Box>
            <Stack direction="row" alignItems="center" justifyContent="space-between">
              <Typography variant="overline" color="primary">
                Itens
              </Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={() => set('items', [...d.items, emptyItem(company, d.recipient.state)])}>
                Item
              </Button>
            </Stack>
            <Stack spacing={1}>
              {d.items.map((i) => (
                <Paper key={i.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2, borderColor: i.service ? '#b9852e' : colors.border }}>
                  <Grid container spacing={1} sx={{ alignItems: 'center' }}>
                    <Grid size={{ xs: 12, md: 5 }}>
                      <TextField label="Descrição" size="small" value={i.description} onChange={(e) => patchItem(i.id, { description: e.target.value })} />
                    </Grid>
                    <Grid size={{ xs: 4, md: 1.5 }}>
                      <TextField label="NCM" size="small" value={i.ncm} onChange={(e) => patchItem(i.id, { ncm: e.target.value })} />
                    </Grid>
                    <Grid size={{ xs: 4, md: 1 }}>
                      <TextField label="CFOP" size="small" value={i.cfop} onChange={(e) => patchItem(i.id, { cfop: e.target.value })} />
                    </Grid>
                    <Grid size={{ xs: 4, md: 1 }}>
                      <TextField label="CSOSN/CST" size="small" value={i.taxSituation} onChange={(e) => patchItem(i.id, { taxSituation: e.target.value })} />
                    </Grid>
                    <Grid size={{ xs: 3, md: 0.8 }}>
                      <TextField label="Un." size="small" value={i.unit} onChange={(e) => patchItem(i.id, { unit: e.target.value.toUpperCase() })} />
                    </Grid>
                    <Grid size={{ xs: 4, md: 1 }}>
                      <NumberField label="Qtde" value={i.quantity} min={0} decimals={3} onChange={(n) => patchItem(i.id, { quantity: n ?? 0 })} />
                    </Grid>
                    <Grid size={{ xs: 5, md: 1.5 }}>
                      <NumberField label="Valor unit. (R$)" value={i.unitPrice} min={0} decimals={2} onChange={(n) => patchItem(i.id, { unitPrice: n ?? 0 })} />
                    </Grid>
                    <Grid size={{ xs: 12, md: 'auto' }}>
                      <IconButton aria-label="Remover item" onClick={() => set('items', d.items.filter((x) => x.id !== i.id))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Grid>
                  </Grid>
                  {i.service ? (
                    <Chip size="small" label="Serviço" sx={{ mt: 0.75 }} />
                  ) : null}
                </Paper>
              ))}
              {d.items.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Escolha um orçamento ou projeto acima, ou adicione itens manualmente.
                </Typography>
              ) : null}
            </Stack>
          </Box>

          <Grid container spacing={1.5}>
            <Grid size={{ xs: 6, md: 3 }}>
              <NumberField label="Frete (R$)" value={d.freight} min={0} decimals={2} onChange={(n) => set('freight', n ?? 0)} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <NumberField label="Desconto (R$)" value={d.discount} min={0} decimals={2} onChange={(n) => set('discount', n ?? 0)} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField label="Natureza da operação" size="small" value={d.natureOfOperation} onChange={(e) => set('natureOfOperation', e.target.value)} />
            </Grid>
            <Grid size={12}>
              <TextField label="Informações complementares" size="small" multiline minRows={3} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
            </Grid>
          </Grid>

          <Stack direction="row" justifyContent="flex-end">
            <Typography variant="h5">
              Total da nota: {brl(totals.total)}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            NCM, CFOP e CSOSN/CST vêm dos padrões de Configurações → Empresa → Nota fiscal. Confirme com o contador antes de emitir em produção.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" disabled={busy || d.items.length === 0} onClick={() => save(false)}>
          Salvar rascunho
        </Button>
        <Button variant="contained" disabled={busy || d.items.length === 0} onClick={() => save(true)}>
          {busy ? 'Enviando…' : 'Salvar e emitir'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ----------------------------------------------------------------------------- detalhe
function InvoiceDetail({
  invoice,
  onClose,
  onEdit,
  onChanged,
  toast,
}: {
  invoice: Invoice
  onClose: () => void
  onEdit: (invoice: Invoice) => void
  onChanged: () => void | Promise<unknown>
  toast: ReturnType<typeof useToast>
}) {
  const company = useCompany()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  const run = async (label: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(true)
    try {
      await fn()
      await onChanged()
      if (success) toast.success(success)
    } catch (e) {
      await onChanged()
      toast.error(e instanceof Error ? e.message : `Não foi possível ${label}.`)
    } finally {
      setBusy(false)
    }
  }

  // enquanto a SEFAZ processa, consulta sozinho a cada 6 segundos
  useEffect(() => {
    if (invoice.status !== 'processando') return
    const timer = setInterval(() => {
      api.post(`/fiscal/invoices/${invoice.id}/refresh`, {}).then(() => onChanged()).catch(() => undefined)
    }, 6000)
    return () => clearInterval(timer)
  }, [invoice.id, invoice.status, onChanged])

  const danfe = async () => {
    const logo = await logoBlackWhite(company)
    downloadBlob(buildDanfePdf({ invoice, company, logo }), `danfe-${invoice.number ?? invoice.code ?? 'nota'}.pdf`)
  }
  const editable = invoice.status === 'rascunho' || invoice.status === 'rejeitada'

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        {invoice.number ? `NF-e ${invoice.number}` : (invoice.code ?? 'Nota fiscal')} <StatusChip options={STATUS} value={invoice.status} />
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.5}>
          {invoice.environment === 'homologacao' ? <Alert severity="info">Nota de teste (homologação): sem valor fiscal.</Alert> : null}
          {invoice.message ? <Alert severity={invoice.status === 'rejeitada' ? 'error' : 'info'}>{invoice.message}</Alert> : null}
          {invoice.status === 'processando' ? <Alert severity="warning">Aguardando a autorização da SEFAZ. Esta tela atualiza sozinha.</Alert> : null}
          <Typography variant="body2">
            <b>Destinatário:</b> {invoice.recipient?.name} · {invoice.recipient?.document}
          </Typography>
          <Typography variant="body2">
            <b>Valor:</b> {brl(invoice.total)} · {invoice.items.length} item(ns) · {invoice.natureOfOperation}
          </Typography>
          {invoice.accessKey ? (
            <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
              <b>Chave de acesso:</b> {invoice.accessKey}
            </Typography>
          ) : null}
          {invoice.cancelReason ? (
            <Typography variant="body2">
              <b>Cancelada:</b> {invoice.cancelReason}
            </Typography>
          ) : null}
          {cancelling ? (
            <Stack spacing={1}>
              <TextField label="Justificativa do cancelamento (15 a 255 caracteres)" size="small" multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
              <Stack direction="row" spacing={1}>
                <Button
                  color="error"
                  variant="contained"
                  disabled={busy || reason.trim().length < 15}
                  onClick={() => run('cancelar', () => api.post(`/fiscal/invoices/${invoice.id}/cancel`, { reason }), 'Nota cancelada.').then(() => setCancelling(false))}
                >
                  Confirmar cancelamento
                </Button>
                <Button color="inherit" onClick={() => setCancelling(false)}>
                  Voltar
                </Button>
              </Stack>
            </Stack>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button color="inherit" onClick={onClose}>
          Fechar
        </Button>
        <Box sx={{ flex: 1 }} />
        {editable ? (
          <Button onClick={() => onEdit(invoice)} disabled={busy}>
            Editar
          </Button>
        ) : null}
        {invoice.status === 'rascunho' ? (
          <Button
            color="error"
            disabled={busy}
            onClick={async () => {
              if (await confirm({ title: 'Excluir rascunho?', message: 'O rascunho será removido.', confirmLabel: 'Excluir', danger: true })) {
                await run('excluir', () => api.del(`/fiscal/invoices/${invoice.id}`), 'Rascunho excluído.')
                onClose()
              }
            }}
          >
            Excluir
          </Button>
        ) : null}
        {editable ? (
          <Button variant="contained" disabled={busy} onClick={() => run('emitir', () => api.post(`/fiscal/invoices/${invoice.id}/emit`, {}), 'Nota enviada ao provedor.')}>
            {invoice.status === 'rejeitada' ? 'Reenviar' : 'Emitir'}
          </Button>
        ) : null}
        {invoice.ref && invoice.status !== 'cancelada' ? (
          <Button disabled={busy} onClick={() => run('atualizar', () => api.post(`/fiscal/invoices/${invoice.id}/refresh`, {}), 'Situação atualizada.')}>
            Atualizar situação
          </Button>
        ) : null}
        <Button startIcon={<PictureAsPdfIcon />} onClick={danfe}>
          DANFE
        </Button>
        {invoice.xmlUrl ? (
          <Button startIcon={<DownloadIcon />} component="a" href={invoice.xmlUrl} target="_blank" rel="noopener noreferrer">
            XML
          </Button>
        ) : null}
        {invoice.danfeUrl ? (
          <Button component="a" href={invoice.danfeUrl} target="_blank" rel="noopener noreferrer">
            DANFE oficial
          </Button>
        ) : null}
        {invoice.status === 'autorizada' ? (
          <Button color="error" onClick={() => setCancelling(true)} disabled={busy}>
            Cancelar nota
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
