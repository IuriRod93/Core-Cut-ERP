import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, CheckCircleIcon, CloseIcon, ContentCopyIcon, DeleteIcon, PictureAsPdfIcon, RequestQuoteIcon, ViewInArIcon, Inventory2Icon } from '../components/icons'
import { DataTable, EmptyState, LoadingState, PageHeader, SearchField, StatCard, StatusChip, type Column } from '../components/ui'
import { NumberField, RelationSelect } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { createDoc, removeDoc, updateDoc, useCollections, useCompany } from '../lib/store'
import { budgetTotals } from '../domain/budget'
import { bomCost } from '../domain/bom'
import { buildBudgetPdf } from '../domain/pdf'
import { BUDGET_ITEM_KINDS, BUDGET_STATUS } from '../domain/constants'
import { addDaysISO, brl, brlShort, downloadBlob, fmtDate, matches, round2, todayISO, uid } from '../lib/format'
import { colors } from '../theme'
import type { Budget, BudgetItem } from '../types'

export function BudgetsPage() {
  const { user } = useAuth()
  const company = useCompany()
  const [params, setParams] = useSearchParams()
  const { data, maps, loading } = useCollections(['budgets', 'clients', 'projects'] as const)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState<Budget | 'new' | null>(null)

  const idParam = params.get('id')
  const wantsNew = params.get('new') === '1'
  const fromParam = idParam ? (maps.budgets.get(idParam) ?? null) : null
  const current = editing ?? fromParam ?? (wantsNew ? 'new' : null)

  const rows = data.budgets.filter((b) => (!status || b.status === status) && matches([b.code, b.title, maps.clients.get(b.clientId ?? '')?.name], query))
  const totalsOf = (b: Budget) => budgetTotals(b).total
  const pipeline = data.budgets.filter((b) => ['rascunho', 'enviado'].includes(b.status))
  const approved = data.budgets.filter((b) => b.status === 'aprovado')
  const decided = approved.length + data.budgets.filter((b) => b.status === 'recusado').length

  const close = () => {
    setEditing(null)
    ;['id', 'new', 'cliente'].forEach((k) => params.delete(k))
    setParams(params, { replace: true })
  }

  const blank = (): Budget =>
    ({
      id: '',
      createdAt: '',
      updatedAt: '',
      title: '',
      clientId: params.get('cliente') ?? undefined,
      status: 'rascunho',
      validUntil: addDaysISO(todayISO(), company.quoteValidityDays || 15),
      items: [],
      marginPercent: company.defaultMargin || 35,
      taxPercent: company.defaultTax || 0,
      discountPercent: 0,
      laborHours: 0,
      laborRate: 0,
      freight: 0,
      installation: 0,
      paymentTerms: company.paymentTerms,
      deliveryDays: 30,
      responsibleId: user?.id,
    }) as Budget

  const columns: Column<Budget>[] = [
    {
      key: 'code',
      header: 'Orçamento',
      sort: (b) => b.code,
      render: (b) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {b.code}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {b.title}
          </Typography>
        </Box>
      ),
    },
    { key: 'client', header: 'Cliente', sort: (b) => maps.clients.get(b.clientId ?? '')?.name, render: (b) => maps.clients.get(b.clientId ?? '')?.name ?? '—' },
    { key: 'items', header: 'Itens', align: 'right', hideBelow: 'md', render: (b) => b.items.length },
    { key: 'total', header: 'Total', align: 'right', sort: (b) => totalsOf(b), render: (b) => <strong>{brl(totalsOf(b))}</strong> },
    { key: 'margin', header: 'Lucro', align: 'right', hideBelow: 'lg', sort: (b) => budgetTotals(b).profitPercent, render: (b) => `${budgetTotals(b).profitPercent}%` },
    { key: 'valid', header: 'Validade', hideBelow: 'md', sort: (b) => b.validUntil, render: (b) => fmtDate(b.validUntil) },
    { key: 'status', header: 'Situação', sort: (b) => b.status, render: (b) => <StatusChip options={BUDGET_STATUS} value={b.status} /> },
  ]

  if (loading && !data.budgets.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Orçamentos"
        subtitle="Proposta comercial com custo real de materiais, mão de obra, margem, impostos e PDF com a marca Core Cut."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
            Novo orçamento
          </Button>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em negociação" value={pipeline.length} icon={<RequestQuoteIcon />} hint={brlShort(pipeline.reduce((s, b) => s + totalsOf(b), 0))} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Aprovados" value={approved.length} tone="success" hint={brlShort(approved.reduce((s, b) => s + totalsOf(b), 0))} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Taxa de aprovação" value={decided ? `${Math.round((approved.length / decided) * 100)}%` : '—'} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Ticket médio" value={brl(approved.length ? approved.reduce((s, b) => s + totalsOf(b), 0) / approved.length : 0)} />
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <SearchField value={query} onChange={setQuery} placeholder="Buscar orçamento ou cliente…" />
          <TextField select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 180 } }}>
            <MenuItem value="">Todas</MenuItem>
            {BUDGET_STATUS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {rows.length === 0 ? (
          <EmptyState icon={<RequestQuoteIcon />} title="Nenhum orçamento" description="Monte propostas com fichas técnicas, materiais do estoque e serviços — o custo é calculado automaticamente." action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>Novo orçamento</Button>} />
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(b) => b.id} onRowClick={(b) => setEditing(b)} initialSort={{ key: 'code', dir: 'desc' }} />
        )}
      </Paper>
      {current ? <BudgetEditor key={current === 'new' ? 'new' : current.id} budget={current === 'new' ? blank() : current} onClose={close} /> : null}
    </Box>
  )
}

// ------------------------------------------------------------------- editor
function BudgetEditor({ budget, onClose }: { budget: Budget; onClose: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const company = useCompany()
  const { data, maps } = useCollections(['boms', 'materials', 'workCenters', 'clients', 'productsServices'] as const)
  const [draft, setDraft] = useState<Budget>(budget)
  const [saving, setSaving] = useState(false)
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null)
  const [pick, setPick] = useState<'bom' | 'material' | 'service' | null>(null)
  const isNew = !budget.id
  const totals = useMemo(() => budgetTotals(draft), [draft])
  const set = <K extends keyof Budget>(k: K, v: Budget[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const groups = [...new Set(draft.items.map((i) => i.group || 'Itens'))]
  const marginFactor = 1 + (draft.marginPercent ?? 0) / 100

  const updateItem = (id: string, patch: Partial<BudgetItem>) => set('items', draft.items.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  const addItem = (item: Partial<BudgetItem>) =>
    set('items', [...draft.items, { id: uid(), group: groups.at(-1) ?? 'Ambiente 1', description: '', kind: 'servico', unit: 'un', quantity: 1, unitCost: 0, unitPrice: 0, ...item } as BudgetItem])

  const persist = async (patch: Partial<Budget> = {}) => {
    if (!draft.title.trim()) {
      toast.error('Informe o título do orçamento.')
      return null
    }
    setSaving(true)
    try {
      const { id, createdAt, updatedAt, code, ...rest } = { ...draft, ...patch }
      void createdAt
      void updatedAt
      void code
      if (id) {
        const saved = await updateDoc('budgets', id, rest)
        return saved
      }
      return await createDoc('budgets', rest)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')
      return null
    } finally {
      setSaving(false)
    }
  }

  const save = async () => {
    const saved = await persist()
    if (saved) {
      toast.success(`Orçamento ${saved.code} salvo.`)
      onClose()
    }
  }

  const exportPdf = async () => {
    const saved = isNew ? await persist() : { ...draft }
    if (!saved) return
    if (!company.cnpj || !company.address) toast.warning('Os dados da empresa (CNPJ e endereço) estão incompletos e saem em branco na proposta. Preencha em Configurações → Empresa.')
    const blob = await buildBudgetPdf({ ...draft, code: saved.code } as Budget, maps.clients.get(draft.clientId ?? ''), company)
    downloadBlob(blob, `proposta-${(saved.code ?? 'orcamento').toLowerCase()}.pdf`)
    if (draft.status === 'rascunho') set('status', 'enviado')
  }

  const approve = async () => {
    const ok = await confirm({
      title: 'Aprovar orçamento?',
      message: 'O orçamento será marcado como aprovado e, se não houver projeto vinculado, um projeto será criado a partir do modelo de ambiente planejado.',
      confirmLabel: 'Aprovar e criar projeto',
    })
    if (!ok) return
    setSaving(true)
    try {
      const saved = await persist()
      if (!saved) return
      const result = await api.post<{ project: { id: string }; productionOrder: { id: string }; receivables: unknown[] }>(`/budgets/${saved.id}/approve`)
      if (result) {
        toast.success('Orçamento aprovado e projeto criado.')
        navigate(`/projetos/${result.project.id}`)
      }
    } finally {
      setSaving(false)
    }
  }

  const duplicate = async () => {
    const { id, createdAt, updatedAt, code, ...rest } = draft
    void id
    void createdAt
    void updatedAt
    void code
    const copy = await createDoc('budgets', { ...rest, title: `${draft.title} (cópia)`, status: 'rascunho', approvedAt: undefined, projectId: undefined })
    toast.success(`Copiado como ${copy.code}.`)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xl" scroll="paper">
      <DialogTitle>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <span>{isNew ? 'Novo orçamento' : `Orçamento ${budget.code}`}</span>
          <StatusChip options={BUDGET_STATUS} value={draft.status} size="medium" />
          <Box sx={{ flex: 1 }} />
          <IconButton onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid size={{ xs: 12, md: 5 }}>
            <TextField label="Título / ambiente" value={draft.title} onChange={(e) => set('title', e.target.value)} required placeholder="Ex.: Cozinha planejada — Residência Silva" />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <RelationSelect collection="clients" label="Cliente" value={draft.clientId} onChange={(id) => set('clientId', id ?? undefined)} />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <TextField type="date" label="Válido até" value={draft.validUntil ?? ''} onChange={(e) => set('validUntil', e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <RelationSelect collection="projects" label="Projeto vinculado" value={draft.projectId} onChange={(id) => set('projectId', id ?? undefined)} />
          </Grid>
          <Grid size={{ xs: 12, md: 5 }}>
            <TextField label="Condições de pagamento" value={draft.paymentTerms ?? ''} onChange={(e) => set('paymentTerms', e.target.value)} />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <NumberField label="Prazo de entrega (dias úteis)" value={draft.deliveryDays} min={0} decimals={0} onChange={(v) => set('deliveryDays', v ?? undefined)} />
          </Grid>
        </Grid>

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="overline" color="primary">
            Itens da proposta
          </Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" startIcon={<ViewInArIcon />} onClick={() => setPick('bom')}>
              Ficha técnica
            </Button>
            <Button size="small" startIcon={<Inventory2Icon />} onClick={() => setPick('material')}>
              Material do estoque
            </Button>
            <Button size="small" startIcon={<RequestQuoteIcon />} onClick={() => setPick('service')}>
              Produto / serviço
            </Button>
            <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={(e) => setAddMenu(e.currentTarget)}>
              Linha livre
            </Button>
            <Menu anchorEl={addMenu} open={Boolean(addMenu)} onClose={() => setAddMenu(null)}>
              {BUDGET_ITEM_KINDS.map((k) => (
                <MenuItem
                  key={k.value}
                  onClick={() => {
                    setAddMenu(null)
                    addItem({ kind: k.value as BudgetItem['kind'] })
                  }}
                >
                  {k.label}
                </MenuItem>
              ))}
            </Menu>
          </Stack>
        </Stack>

        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 960 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1.1fr 2.6fr 90px 90px 130px 130px 110px 36px', gap: 1, px: 0.5, pb: 0.5 }}>
              {['Ambiente', 'Descrição', 'Qtd.', 'Un.', 'Custo unit.', 'Preço unit.', 'Total', ''].map((h, i) => (
                <Typography key={i} variant="overline" color="text.secondary" sx={{ textAlign: i >= 2 && i !== 3 && i !== 7 ? 'right' : 'left' }}>
                  {h}
                </Typography>
              ))}
            </Box>
            {draft.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center', border: `1px dashed ${colors.borderStrong}`, borderRadius: 2 }}>
                Nenhum item. Adicione fichas técnicas, materiais ou serviços acima.
              </Typography>
            ) : null}
            {draft.items.map((it) => {
              const unitPrice = it.unitPrice > 0 ? it.unitPrice : it.unitCost * marginFactor
              return (
                <Box key={it.id} sx={{ display: 'grid', gridTemplateColumns: '1.1fr 2.6fr 90px 90px 130px 130px 110px 36px', gap: 1, mb: 0.75, alignItems: 'center' }}>
                  <TextField value={it.group} onChange={(e) => updateItem(it.id, { group: e.target.value })} placeholder="Ambiente" />
                  <TextField
                    value={it.description}
                    onChange={(e) => updateItem(it.id, { description: e.target.value })}
                    placeholder="Descrição"
                    title={it.cutPlanId ? 'Item do plano de corte — atualizado automaticamente ao salvar o plano' : undefined}
                    sx={it.cutPlanId ? { '& fieldset': { borderColor: colors.brand, borderLeftWidth: 4 } } : undefined}
                  />
                  <NumberField value={it.quantity} min={0} onChange={(v) => updateItem(it.id, { quantity: v ?? 0 })} />
                  <TextField value={it.unit} onChange={(e) => updateItem(it.id, { unit: e.target.value })} />
                  <NumberField value={it.unitCost} adornment="R$" min={0} decimals={2} onChange={(v) => updateItem(it.id, { unitCost: v ?? 0 })} />
                  <NumberField value={it.unitPrice || null} adornment="R$" placeholder={round2(unitPrice).toFixed(2).replace('.', ',')} min={0} decimals={2} onChange={(v) => updateItem(it.id, { unitPrice: v ?? 0 })} />
                  <Typography variant="body2" sx={{ textAlign: 'right', fontWeight: 700 }}>
                    {brl(unitPrice * it.quantity)}
                  </Typography>
                  <IconButton size="small" onClick={() => set('items', draft.items.filter((x) => x.id !== it.id))} aria-label="Remover item">
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              )
            })}
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary">
          Deixe o preço unitário em branco para aplicar a margem padrão de {draft.marginPercent}% sobre o custo.
        </Typography>

        <Grid container spacing={3} sx={{ mt: 1 }}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 1 }}>
              Composição de preço
            </Typography>
            <Grid container spacing={2}>
              <Grid size={6}>
                <NumberField label="Horas de mão de obra" value={draft.laborHours} min={0} onChange={(v) => set('laborHours', v ?? 0)} />
              </Grid>
              <Grid size={6}>
                <NumberField label="Valor da hora (R$)" adornment="R$" value={draft.laborRate} min={0} decimals={2} onChange={(v) => set('laborRate', v ?? 0)} />
              </Grid>
              <Grid size={4}>
                <NumberField label="Margem (%)" value={draft.marginPercent} min={0} onChange={(v) => set('marginPercent', v ?? 0)} />
              </Grid>
              <Grid size={4}>
                <NumberField label="Impostos (%)" value={draft.taxPercent} min={0} max={60} onChange={(v) => set('taxPercent', v ?? 0)} />
              </Grid>
              <Grid size={4}>
                <NumberField label="Desconto (%)" value={draft.discountPercent} min={0} max={100} onChange={(v) => set('discountPercent', v ?? 0)} />
              </Grid>
              <Grid size={6}>
                <NumberField label="Frete (R$)" adornment="R$" value={draft.freight} min={0} decimals={2} onChange={(v) => set('freight', v ?? 0)} />
              </Grid>
              <Grid size={6}>
                <NumberField label="Instalação (R$)" adornment="R$" value={draft.installation} min={0} decimals={2} onChange={(v) => set('installation', v ?? 0)} />
              </Grid>
              <Grid size={12}>
                <TextField multiline minRows={2} label="Observações da proposta" value={draft.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
              </Grid>
            </Grid>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, bgcolor: colors.subtle }}>
              {(
                [
                  ['Custo direto dos itens', totals.cost],
                  ['Mão de obra (custo)', totals.labor],
                  ['Margem aplicada', totals.margin],
                  ['Frete e instalação', totals.extras],
                  ['Desconto', -totals.discount],
                  ['Impostos', totals.taxes],
                ] as [string, number][]
              ).map(([label, value]) => (
                <Stack key={label} direction="row" justifyContent="space-between" sx={{ py: 0.5 }}>
                  <Typography variant="body2" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {value < 0 ? `− ${brl(-value)}` : brl(value)}
                  </Typography>
                </Stack>
              ))}
              <Box sx={{ borderTop: `1px solid ${colors.borderStrong}`, mt: 1, pt: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                  <Typography variant="subtitle1">Total da proposta</Typography>
                  <Typography variant="h3" sx={{ color: colors.brand }}>
                    {brl(totals.total)}
                  </Typography>
                </Stack>
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Lucro estimado
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700, color: totals.profitPercent >= 15 ? colors.success : colors.error }}>
                    {brl(totals.profit)} ({totals.profitPercent}%)
                  </Typography>
                </Stack>
              </Box>
            </Paper>
            {totals.profitPercent < 10 && draft.items.length ? (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                A margem líquida está abaixo de 10%. Revise custos, desconto ou preços unitários.
              </Alert>
            ) : null}
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        {!isNew ? (
          <>
            <Button
              color="error"
              startIcon={<DeleteIcon />}
              onClick={async () => {
                if (await confirm({ title: 'Excluir orçamento?', message: budget.code, confirmLabel: 'Excluir', danger: true })) {
                  await removeDoc('budgets', budget.id)
                  onClose()
                }
              }}
            >
              Excluir
            </Button>
            <Button startIcon={<ContentCopyIcon />} onClick={duplicate}>
              Duplicar
            </Button>
          </>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button startIcon={<PictureAsPdfIcon />} onClick={exportPdf}>
          Gerar PDF
        </Button>
        {draft.status !== 'aprovado' ? (
          <Button color="success" startIcon={<CheckCircleIcon />} onClick={approve} disabled={saving || !draft.items.length}>
            Aprovar
          </Button>
        ) : null}
        {draft.status === 'enviado' ? (
          <Button color="error" onClick={() => set('status', 'recusado')}>
            Marcar como recusado
          </Button>
        ) : null}
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar orçamento'}
        </Button>
      </DialogActions>

      <PickerDialog
        mode={pick}
        onClose={() => setPick(null)}
        boms={data.boms.filter((b) => b.active !== false)}
        materials={data.materials.filter((m) => m.active !== false)}
        services={data.productsServices.filter((p) => p.active)}
        costOfBom={(b) => bomCost(b, maps.materials, maps.workCenters).total}
        onAdd={(items) => {
          set('items', [...draft.items, ...items.map((i) => ({ ...i, id: uid(), group: i.group || groups.at(-1) || 'Ambiente 1' }) as BudgetItem)])
          setPick(null)
        }}
      />
    </Dialog>
  )
}

function PickerDialog({
  mode,
  onClose,
  boms,
  materials,
  services,
  costOfBom,
  onAdd,
}: {
  mode: 'bom' | 'material' | 'service' | null
  onClose: () => void
  boms: import('../types').Bom[]
  materials: import('../types').Material[]
  services: import('../types').ProductService[]
  costOfBom: (b: import('../types').Bom) => number
  onAdd: (items: Partial<BudgetItem>[]) => void
}) {
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('Ambiente 1')
  const list = useMemo(() => {
    if (mode === 'bom')
      return boms.map((b) => ({ key: b.id, title: b.name, sub: b.code, cost: costOfBom(b), price: b.salePrice ?? 0, item: { kind: 'modulo', description: b.name, unit: 'un', unitCost: round2(costOfBom(b)), unitPrice: b.salePrice ?? 0, bomId: b.id } as Partial<BudgetItem> }))
    if (mode === 'material')
      return materials.map((m) => ({ key: m.id, title: m.name, sub: [m.code, m.brand].filter(Boolean).join(' · '), cost: m.cost, price: 0, item: { kind: m.category === 'ferragem' ? 'ferragem' : 'material', description: m.name, unit: m.unit, unitCost: m.cost, unitPrice: 0, materialId: m.id } as Partial<BudgetItem> }))
    if (mode === 'service')
      return services.map((s) => ({ key: s.id, title: s.name, sub: s.category ?? '', cost: s.cost ?? 0, price: s.price, item: { kind: s.kind === 'servico' ? 'servico' : 'outro', description: s.name, unit: s.unit, unitCost: s.cost ?? 0, unitPrice: s.price } as Partial<BudgetItem> }))
    return []
  }, [mode, boms, materials, services, costOfBom])
  const filtered = list.filter((r) => matches([r.title, r.sub], q)).slice(0, 80)

  return (
    <Dialog open={Boolean(mode)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{mode === 'bom' ? 'Adicionar ficha técnica' : mode === 'material' ? 'Adicionar material do estoque' : 'Adicionar produto ou serviço'}</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <SearchField value={q} onChange={setQ} autoFocus width="100%" />
          <TextField label="Ambiente" value={group} onChange={(e) => setGroup(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 180 } }} />
        </Stack>
        {filtered.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            Nada encontrado.
          </Typography>
        ) : null}
        {filtered.map((r) => (
          <Stack
            key={r.key}
            direction="row"
            alignItems="center"
            spacing={1.5}
            onClick={() => onAdd([{ ...r.item, group, quantity: 1 }])}
            sx={{ py: 1, px: 1, borderRadius: 2, cursor: 'pointer', '&:hover': { bgcolor: colors.brandTint } }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {r.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {r.sub}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {brl(r.price || r.cost)}
            </Typography>
          </Stack>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}
