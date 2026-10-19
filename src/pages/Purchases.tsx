import { useMemo, useState } from 'react'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
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
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, CheckCircleIcon, CloseIcon, DeleteIcon, ThumbDownIcon, LocalShippingIcon, PaidIcon, ShoppingCartIcon, ViewKanbanIcon, ViewListIcon, WarningAmberIcon } from '../components/icons'
import { DataTable, Dot, EmptyState, LoadingState, PageHeader, SearchField, SideDrawer, StatCard, StatusChip, type Column } from '../components/ui'
import { NumberField, RelationSelect, FormDialog, type FieldDef } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { api } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import { createDoc, refreshCollection, removeDoc, updateDoc, useCollections } from '../lib/store'
import { PURCHASE_STATUS, optColor, optLabel } from '../domain/constants'
import { addDaysISO, brl, daysUntil, fmtDate, matches, todayISO } from '../lib/format'
import { colors } from '../theme'
import type { Purchase, PurchaseItem, PurchaseStatus } from '../types'

const BOARD: PurchaseStatus[] = ['rascunho', 'solicitado', 'cotacao', 'aprovado', 'reprovado', 'pedido', 'parcial', 'recebido']
// aprovar e reprovar passam pelo servidor (/purchases/:id/decision) e exigem perfil de aprovação
const NEXT: Partial<Record<PurchaseStatus, { to: PurchaseStatus; label: string }>> = {
  rascunho: { to: 'solicitado', label: 'Solicitar compra' },
  solicitado: { to: 'cotacao', label: 'Iniciar cotação' },
  aprovado: { to: 'pedido', label: 'Enviar pedido ao fornecedor' },
}
const APPROVER_ROLES = ['admin', 'gerente', 'financeiro']
const PENDING_APPROVAL: PurchaseStatus[] = ['rascunho', 'solicitado', 'cotacao']

async function decide(id: string, decision: 'aprovar' | 'reprovar' | 'reabrir', reason?: string) {
  await api.post(`/purchases/${id}/decision`, { decision, reason })
  await refreshCollection('purchases')
}

const total = (p: Purchase) => p.items.reduce((s, i) => s + i.quantity * i.unitCost, 0) + (p.freight ?? 0)

export function PurchasesPage() {
  const [params, setParams] = useSearchParams()
  const { data, maps, loading } = useCollections(['purchases', 'suppliers', 'materials', 'projects'] as const)
  const toast = useToast()
  const { user } = useAuth()
  const canDecide = APPROVER_ROLES.includes(user?.role ?? '')
  const [rejecting, setRejecting] = useState<string | null>(null)
  const [view, setView] = useState<'quadro' | 'lista'>('quadro')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Purchase | 'new' | null>(params.get('new') === '1' ? 'new' : null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [suggestOpen, setSuggestOpen] = useState(false)

  const rows = data.purchases.filter((p) => matches([p.code, maps.suppliers.get(p.supplierId ?? '')?.name, p.invoiceNumber, ...p.items.map((i) => i.description)], query))
  const open = data.purchases.filter((p) => !['recebido', 'cancelado', 'reprovado'].includes(p.status))
  const awaiting = data.purchases.filter((p) => PENDING_APPROVAL.includes(p.status) && p.status !== 'rascunho')
  const late = open.filter((p) => ['pedido', 'parcial'].includes(p.status) && p.expectedDate && (daysUntil(p.expectedDate) ?? 0) < 0)
  const low = data.materials.filter((m) => m.active !== false && m.minStock > 0 && m.stock <= m.minStock)
  const detail = detailId ? maps.purchases.get(detailId) : null

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return
    const status = r.destination.droppableId as PurchaseStatus
    if (status === 'recebido' || status === 'parcial') {
      setDetailId(r.draggableId)
      return
    }
    if (status === 'aprovado' || status === 'reprovado') {
      if (!canDecide) {
        toast.warning('Somente administração, gerência e financeiro aprovam ou reprovam compras.')
        return
      }
      if (status === 'reprovado') setRejecting(r.draggableId)
      else void decide(r.draggableId, 'aprovar').then(() => toast.success('Compra aprovada.'), (e) => toast.error(e instanceof Error ? e.message : 'Falha ao aprovar.'))
      return
    }
    void updateDoc('purchases', r.draggableId, { status })
  }

  const columns: Column<Purchase>[] = [
    { key: 'code', header: 'Pedido', sort: (p) => p.code, render: (p) => <strong>{p.code}</strong> },
    { key: 'supplier', header: 'Fornecedor', sort: (p) => maps.suppliers.get(p.supplierId ?? '')?.name, render: (p) => maps.suppliers.get(p.supplierId ?? '')?.name ?? '—' },
    { key: 'items', header: 'Itens', align: 'right', hideBelow: 'md', render: (p) => p.items.length },
    { key: 'total', header: 'Valor', align: 'right', sort: (p) => total(p), render: (p) => <strong>{brl(total(p))}</strong> },
    { key: 'expected', header: 'Previsão', hideBelow: 'md', sort: (p) => p.expectedDate, render: (p) => fmtDate(p.expectedDate) },
    { key: 'status', header: 'Situação', sort: (p) => p.status, render: (p) => <StatusChip options={PURCHASE_STATUS} value={p.status} /> },
  ]

  if (loading && !data.purchases.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Compras"
        subtitle="Do pedido de compra ao recebimento: cotação, aprovação, envio ao fornecedor e entrada automática no estoque."
        actions={
          <>
            <Button variant="outlined" color="inherit" startIcon={<WarningAmberIcon />} onClick={() => setSuggestOpen(true)} disabled={!low.length}>
              Reposição sugerida ({low.length})
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
              Novo pedido
            </Button>
          </>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 'grow' }}>
          <StatCard label="Pedidos em aberto" value={open.length} icon={<ShoppingCartIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 'grow' }}>
          <StatCard label="Aguardando aprovação" value={awaiting.length} tone={awaiting.length ? 'warning' : 'success'} icon={<CheckCircleIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 'grow' }}>
          <StatCard label="Valor em aberto" value={brl(open.reduce((s, p) => s + total(p), 0))} tone="brand" icon={<PaidIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 'grow' }}>
          <StatCard label="Aguardando entrega" value={data.purchases.filter((p) => ['pedido', 'parcial'].includes(p.status)).length} icon={<LocalShippingIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 'grow' }}>
          <StatCard label="Entregas atrasadas" value={late.length} tone={late.length ? 'error' : 'success'} />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar pedido, fornecedor, item…" />
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="quadro">
            <ViewKanbanIcon fontSize="small" sx={{ mr: 0.75 }} /> Quadro
          </ToggleButton>
          <ToggleButton value="lista">
            <ViewListIcon fontSize="small" sx={{ mr: 0.75 }} /> Lista
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {data.purchases.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState icon={<ShoppingCartIcon />} title="Nenhum pedido de compra" description="Crie pedidos manualmente, a partir da reposição sugerida ou da necessidade de uma ordem de produção." action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>Novo pedido</Button>} />
        </Paper>
      ) : view === 'quadro' ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
            {BOARD.map((st) => {
              const items = rows.filter((p) => p.status === st)
              const color = optColor(PURCHASE_STATUS, st)
              return (
                <Box key={st} sx={{ width: 280, flexShrink: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, borderRadius: 2, bgcolor: alpha(color, 0.1), mb: 1 }}>
                    <Dot color={color} size={10} />
                    <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
                      {optLabel(PURCHASE_STATUS, st)}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color }}>
                      {items.length}
                    </Typography>
                  </Stack>
                  <Droppable droppableId={st}>
                    {(p, snap) => (
                      <Box ref={p.innerRef} {...p.droppableProps} sx={{ minHeight: 80, p: 0.5, borderRadius: 2, bgcolor: snap.isDraggingOver ? alpha(colors.brand, 0.05) : 'transparent' }}>
                        {items.map((po, i) => (
                          <Draggable key={po.id} draggableId={po.id} index={i}>
                            {(dp, ds) => (
                              <Paper
                                ref={dp.innerRef}
                                {...dp.draggableProps}
                                {...dp.dragHandleProps}
                                variant="outlined"
                                onClick={() => setDetailId(po.id)}
                                sx={{ p: 1.5, mb: 1, borderRadius: 2.5, cursor: 'pointer', bgcolor: '#fff', boxShadow: ds.isDragging ? '0 10px 28px rgba(30,26,25,0.18)' : 'none', '&:hover': { borderColor: colors.brand } }}
                              >
                                <Typography variant="caption" sx={{ fontWeight: 700, color: colors.brand }}>
                                  {po.code}
                                </Typography>
                                <Typography variant="subtitle2" noWrap>
                                  {maps.suppliers.get(po.supplierId ?? '')?.name ?? 'Fornecedor a definir'}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                  {po.items.length} itens · {brl(total(po))}
                                </Typography>
                                {po.expectedDate ? (
                                  <Typography variant="caption" sx={{ fontWeight: 600, color: ['pedido', 'parcial'].includes(po.status) && (daysUntil(po.expectedDate) ?? 0) < 0 ? 'error.main' : 'text.secondary' }}>
                                    Previsão {fmtDate(po.expectedDate, 'dd MMM')}
                                  </Typography>
                                ) : null}
                              </Paper>
                            )}
                          </Draggable>
                        ))}
                        {p.placeholder}
                      </Box>
                    )}
                  </Droppable>
                </Box>
              )
            })}
          </Box>
        </DragDropContext>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} onRowClick={(p) => setDetailId(p.id)} initialSort={{ key: 'code', dir: 'desc' }} />
        </Paper>
      )}

      {detail ? (
        <PurchaseDetail
          purchase={detail}
          canDecide={canDecide}
          onReject={() => setRejecting(detail.id)}
          onClose={() => setDetailId(null)}
          onEdit={() => {
            setEditing(detail)
          }}
        />
      ) : null}
      {editing ? <PurchaseDialog purchase={editing === 'new' ? null : editing} onClose={() => { setEditing(null); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }) } }} /> : null}
      {suggestOpen ? <SuggestDialog onClose={() => setSuggestOpen(false)} /> : null}
      {rejecting ? <RejectDialog purchase={maps.purchases.get(rejecting)} onClose={() => setRejecting(null)} /> : null}
    </Box>
  )
}

// -------------------------------------------------------------- formulário
function PurchaseDialog({ purchase, onClose }: { purchase: Purchase | null; onClose: () => void }) {
  const toast = useToast()
  const { maps } = useCollections(['materials', 'suppliers'] as const)
  const [items, setItems] = useState<PurchaseItem[]>(purchase?.items ?? [{ description: '', quantity: 1, unitCost: 0, received: 0 }])
  const supplierLead = (id?: string) => maps.suppliers.get(id ?? '')?.leadTimeDays ?? 5

  const fields: FieldDef[] = [
    { name: 'supplierId', label: 'Fornecedor', type: 'relation', collection: 'suppliers', span: 6 },
    { name: 'projectId', label: 'Projeto (opcional)', type: 'relation', collection: 'projects', span: 6 },
    { name: 'status', label: 'Situação', type: 'select', options: PURCHASE_STATUS.filter((s) => !['parcial', 'recebido'].includes(s.value)), required: true, span: 4 },
    { name: 'expectedDate', label: 'Previsão de entrega', type: 'date', span: 4 },
    { name: 'freight', label: 'Frete (R$)', type: 'money', span: 4 },
    { name: 'paymentTerms', label: 'Condição de pagamento', type: 'text', span: 6 },
    { name: 'invoiceNumber', label: 'Nota fiscal', type: 'text', span: 6 },
    { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
  ]

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitCost, 0)

  return (
    <FormDialog
      open
      title={purchase ? `Pedido ${purchase.code}` : 'Novo pedido de compra'}
      fields={fields}
      initial={purchase ? { ...purchase } : { status: 'rascunho' }}
      maxWidth="lg"
      onClose={onClose}
      onSave={async (values) => {
        const clean = items.filter((i) => i.description.trim() && i.quantity > 0)
        if (!clean.length) throw new Error('Inclua ao menos um item no pedido.')
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = values
        void _i
        void _c
        void _u
        const payload = { ...rest, items: clean } as Partial<Purchase>
        if (!payload.expectedDate && payload.supplierId) payload.expectedDate = addDaysISO(todayISO(), supplierLead(payload.supplierId))
        if (purchase) await updateDoc('purchases', purchase.id, payload)
        else await createDoc('purchases', payload)
        toast.success('Pedido salvo.')
      }}
    >
      {() => (
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="overline" color="primary">
              Itens do pedido
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setItems((l) => [...l, { description: '', quantity: 1, unitCost: 0, received: 0 }])}>
              Adicionar item
            </Button>
          </Stack>
          {items.map((it, idx) => (
            <Stack key={idx} direction="row" spacing={1} sx={{ mb: 1 }} alignItems="flex-start">
              <Box sx={{ flex: 2 }}>
                <RelationSelect
                  collection="materials"
                  label="Material do estoque"
                  value={it.materialId}
                  onChange={(id) => {
                    const m = id ? maps.materials.get(id) : undefined
                    setItems((l) => l.map((x, j) => (j === idx ? { ...x, materialId: id ?? undefined, description: m?.name ?? x.description, unit: m?.unit ?? x.unit, unitCost: m?.cost ?? x.unitCost } : x)))
                  }}
                />
              </Box>
              <Box sx={{ flex: 2 }}>
                <TextField label="Descrição" value={it.description} onChange={(e) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, description: e.target.value } : x)))} />
              </Box>
              <Box sx={{ width: 100 }}>
                <NumberField label="Qtd." value={it.quantity} min={0} onChange={(v) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, quantity: v ?? 0 } : x)))} />
              </Box>
              <Box sx={{ width: 140 }}>
                <NumberField label="Custo unit." adornment="R$" value={it.unitCost} min={0} decimals={2} onChange={(v) => setItems((l) => l.map((x, j) => (j === idx ? { ...x, unitCost: v ?? 0 } : x)))} />
              </Box>
              <Typography variant="body2" sx={{ width: 100, pt: 1, textAlign: 'right', fontWeight: 700 }}>
                {brl(it.quantity * it.unitCost)}
              </Typography>
              <IconButton onClick={() => setItems((l) => (l.length > 1 ? l.filter((_, j) => j !== idx) : l))} aria-label="Remover item">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Typography variant="subtitle1" sx={{ textAlign: 'right', mt: 1 }}>
            Subtotal: {brl(subtotal)}
          </Typography>
        </Box>
      )}
    </FormDialog>
  )
}

// ------------------------------------------------------------------ detalhe
function RejectDialog({ purchase, onClose }: { purchase?: Purchase; onClose: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  if (!purchase) return null
  const submit = async () => {
    setBusy(true)
    try {
      await decide(purchase.id, 'reprovar', reason.trim())
      toast.success(`Compra ${purchase.code} reprovada.`)
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reprovar.')
      setBusy(false)
    }
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Reprovar compra {purchase.code}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Informe o motivo para que o solicitante possa ajustar e reenviar o pedido.
        </Typography>
        <TextField autoFocus label="Motivo da reprovação" value={reason} onChange={(e) => setReason(e.target.value)} multiline minRows={3} required />
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" color="error" disabled={!reason.trim() || busy} onClick={submit}>
          Reprovar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function PurchaseDetail({ purchase, onClose, onEdit, canDecide, onReject }: { purchase: Purchase; onClose: () => void; onEdit: () => void; canDecide: boolean; onReject: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { maps } = useCollections(['suppliers', 'projects', 'payables', 'cutPlans'] as const)
  const plan = purchase.cutPlanId ? maps.cutPlans.get(purchase.cutPlanId) : undefined
  const approve = async () => {
    try {
      await decide(purchase.id, 'aprovar')
      toast.success(`Compra ${purchase.code} aprovada.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao aprovar.')
    }
  }
  const reopen = async () => {
    try {
      await decide(purchase.id, 'reabrir')
      toast.success('Pedido reaberto como rascunho.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao reabrir.')
    }
  }
  const [receiving, setReceiving] = useState(false)
  const next = NEXT[purchase.status]
  const supplier = maps.suppliers.get(purchase.supplierId ?? '')
  const payable = [...maps.payables.values()].find((p) => p.purchaseId === purchase.id)

  const advance = async () => {
    if (!next) return
    await updateDoc('purchases', purchase.id, { status: next.to })
    toast.success(`Pedido ${purchase.code}: ${optLabel(PURCHASE_STATUS, next.to)}`)
  }

  const createPayable = async () => {
    const due = addDaysISO(todayISO(), 28)
    await createDoc('payables', {
      description: `Compra ${purchase.code} — ${supplier?.name ?? 'fornecedor'}`,
      amount: total(purchase),
      dueDate: purchase.expectedDate ? addDaysISO(purchase.expectedDate, 28) : due,
      status: 'pendente',
      category: 'Matéria-prima',
      supplierId: purchase.supplierId,
      purchaseId: purchase.id,
      projectId: purchase.projectId,
      documentNumber: purchase.invoiceNumber,
    })
    await updateDoc('purchases', purchase.id, {})
    toast.success('Conta a pagar gerada no financeiro.')
  }

  return (
    <SideDrawer open onClose={onClose} width={620} title={`Pedido ${purchase.code}`} subtitle={supplier?.name ?? 'Fornecedor a definir'} actions={<Button size="small" onClick={onEdit}>Editar</Button>}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <StatusChip options={PURCHASE_STATUS} value={purchase.status} size="medium" />
        <Box sx={{ flex: 1 }} />
        {PENDING_APPROVAL.includes(purchase.status) && purchase.status !== 'rascunho' && canDecide ? (
          <>
            <Button variant="contained" size="small" color="success" startIcon={<CheckCircleIcon />} onClick={approve}>
              Aprovar
            </Button>
            <Button variant="outlined" size="small" color="error" startIcon={<ThumbDownIcon />} onClick={onReject}>
              Reprovar
            </Button>
          </>
        ) : null}
        {purchase.status === 'reprovado' ? (
          <Button variant="outlined" size="small" onClick={reopen}>
            Reabrir como rascunho
          </Button>
        ) : null}
        {next ? (
          <Button variant={PENDING_APPROVAL.includes(purchase.status) && purchase.status !== 'rascunho' ? 'outlined' : 'contained'} size="small" onClick={advance}>
            {next.label}
          </Button>
        ) : null}
        {['pedido', 'parcial'].includes(purchase.status) ? (
          <Button variant="contained" size="small" color="success" startIcon={<CheckCircleIcon />} onClick={() => setReceiving(true)}>
            Registrar recebimento
          </Button>
        ) : null}
      </Stack>

      {purchase.status === 'rascunho' && !purchase.supplierId ? <Alert severity="warning" sx={{ mb: 2 }}>Defina o fornecedor antes de enviar o pedido.</Alert> : null}
      {purchase.status === 'reprovado' ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          Reprovado{purchase.decidedByName ? ` por ${purchase.decidedByName}` : ''}
          {purchase.decidedAt ? ` em ${fmtDate(purchase.decidedAt)}` : ''}. Motivo: {purchase.rejectedReason || 'não informado'}
        </Alert>
      ) : null}
      {['aprovado', 'pedido', 'parcial', 'recebido'].includes(purchase.status) && purchase.decidedByName ? (
        <Alert severity="success" sx={{ mb: 2 }}>
          Aprovado por {purchase.decidedByName}
          {purchase.decidedAt ? ` em ${fmtDate(purchase.decidedAt)}` : ''}.
        </Alert>
      ) : null}
      {['solicitado', 'cotacao'].includes(purchase.status) && !canDecide ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Aguardando aprovação da administração, gerência ou financeiro.
        </Alert>
      ) : null}

      <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 2.5, overflow: 'hidden' }}>
        {purchase.items.map((it, i) => (
          <Stack key={i} direction="row" spacing={1.5} alignItems="center" sx={{ px: 1.5, py: 1, borderBottom: i < purchase.items.length - 1 ? `1px solid ${colors.border}` : 0 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {it.description}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {it.quantity} {it.unit ?? 'un'} × {brl(it.unitCost)} · recebido {it.received ?? 0}
              </Typography>
            </Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {brl(it.quantity * it.unitCost)}
            </Typography>
          </Stack>
        ))}
        <Stack direction="row" justifyContent="space-between" sx={{ px: 1.5, py: 1.25, bgcolor: colors.subtle }}>
          <Typography variant="subtitle2">Total {purchase.freight ? `(frete ${brl(purchase.freight)})` : ''}</Typography>
          <Typography variant="subtitle1" sx={{ color: colors.brand }}>
            {brl(total(purchase))}
          </Typography>
        </Stack>
      </Box>

      <Stack spacing={0.75} sx={{ mt: 2 }}>
        <Typography variant="body2">Projeto: {maps.projects.get(purchase.projectId ?? '')?.name ?? '—'}</Typography>
        {plan ? (
          <Typography variant="body2">
            Origem:{' '}
            <RouterLink to={`/plano-de-corte?plano=${plan.id}`} style={{ color: colors.brand, fontWeight: 700 }}>
              plano de corte {plan.code}
            </RouterLink>
          </Typography>
        ) : null}
        <Typography variant="body2">Previsão de entrega: {fmtDate(purchase.expectedDate)}</Typography>
        {purchase.invoiceNumber ? <Typography variant="body2">Nota fiscal: {purchase.invoiceNumber}</Typography> : null}
        {purchase.notes ? <Typography variant="body2" color="text.secondary">{purchase.notes}</Typography> : null}
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
        {!payable && ['pedido', 'parcial', 'recebido'].includes(purchase.status) ? (
          <Button variant="outlined" color="inherit" startIcon={<PaidIcon />} onClick={createPayable}>
            Gerar conta a pagar
          </Button>
        ) : payable ? (
          <Typography variant="caption" color="success.main" sx={{ alignSelf: 'center' }}>
            Conta a pagar já gerada ({brl(payable.amount)})
          </Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button
          color="error"
          startIcon={<DeleteIcon />}
          onClick={async () => {
            if (await confirm({ title: 'Excluir pedido?', message: purchase.code, confirmLabel: 'Excluir', danger: true })) {
              await removeDoc('purchases', purchase.id)
              onClose()
            }
          }}
        >
          Excluir
        </Button>
      </Stack>
      {receiving ? <ReceiveDialog purchase={purchase} onClose={() => setReceiving(false)} /> : null}
    </SideDrawer>
  )
}

function ReceiveDialog({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const toast = useToast()
  const [qty, setQty] = useState<(number | null)[]>(purchase.items.map((i) => Math.max(i.quantity - (i.received ?? 0), 0)))
  const [invoice, setInvoice] = useState(purchase.invoiceNumber ?? '')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const lines = qty.map((q, index) => ({ index, quantity: q ?? 0 })).filter((l) => l.quantity > 0)
      if (!lines.length) throw new Error('Informe ao menos uma quantidade recebida.')
      await api.post(`/purchases/${purchase.id}/receive`, { lines, invoiceNumber: invoice || undefined })
      await Promise.all([refreshCollection('purchases'), refreshCollection('materials'), refreshCollection('inventoryMovements')])
      toast.success('Recebimento registrado e estoque atualizado.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao registrar recebimento.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Registrar recebimento · {purchase.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          {purchase.items.map((it, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="center">
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {it.description}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Pedido {it.quantity} · já recebido {it.received ?? 0}
                </Typography>
              </Box>
              <Box sx={{ width: 120 }}>
                <NumberField value={qty[i]} min={0} onChange={(v) => setQty((l) => l.map((x, j) => (j === i ? v : x)))} />
              </Box>
            </Stack>
          ))}
          <TextField label="Nota fiscal" value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          <Alert severity="info">Os itens vinculados ao estoque terão entrada automática e o custo será atualizado com o valor do pedido.</Alert>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" color="success" onClick={submit} disabled={busy}>
          Confirmar recebimento
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ------------------------------------------------------- reposição sugerida
function SuggestDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const { data, maps } = useCollections(['materials', 'suppliers'] as const)
  const low = data.materials.filter((m) => m.active !== false && m.minStock > 0 && m.stock <= m.minStock)
  const groups = useMemo(() => {
    const g = new Map<string, typeof low>()
    for (const m of low) {
      const key = m.supplierId ?? '_none'
      g.set(key, [...(g.get(key) ?? []), m])
    }
    return [...g.entries()]
  }, [low])

  const generate = async () => {
    for (const [supplierId, mats] of groups) {
      await createDoc('purchases', {
        status: 'rascunho',
        supplierId: supplierId === '_none' ? undefined : supplierId,
        notes: 'Reposição automática — itens abaixo do estoque mínimo.',
        items: mats.map((m) => ({ materialId: m.id, description: m.name, unit: m.unit, quantity: Math.max(m.minStock * 2 - m.stock, 1), unitCost: m.cost, received: 0 })),
      })
    }
    toast.success(`${groups.length} pedido(s) em rascunho criados.`)
    onClose()
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Reposição sugerida</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Itens com saldo igual ou inferior ao mínimo, agrupados por fornecedor. A quantidade sugerida repõe até o dobro do mínimo.
        </Typography>
        {groups.map(([sid, mats]) => (
          <Box key={sid} sx={{ mb: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {maps.suppliers.get(sid)?.name ?? 'Sem fornecedor definido'}
            </Typography>
            {mats.map((m) => (
              <Stack key={m.id} direction="row" spacing={1} sx={{ py: 0.5, borderBottom: `1px solid ${colors.border}` }}>
                <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                  {m.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  saldo {m.stock} / mín. {m.minStock}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, width: 90, textAlign: 'right' }}>
                  +{Math.max(m.minStock * 2 - m.stock, 1)} {m.unit}
                </Typography>
              </Stack>
            ))}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={generate}>
          Criar {groups.length} pedido(s) em rascunho
        </Button>
      </DialogActions>
    </Dialog>
  )
}
