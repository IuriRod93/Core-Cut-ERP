import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
  MenuItem,
  Paper,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from '../components/Stack'
import {
  AddIcon,
  CheckCircleIcon,
  CloseIcon,
  ContentCutIcon,
  DeleteIcon,
  FactoryIcon,
  PlayArrowIcon,
  ShoppingCartIcon,
  ViewKanbanIcon,
  ViewListIcon,
  WarningAmberIcon,
} from '../components/icons'
import { DataTable, Dot, EmptyState, LoadingState, PageHeader, ProgressLine, SearchField, SideDrawer, StatCard, StatusChip, type Column } from '../components/ui'
import { NumberField, RelationSelect, FormDialog, type FieldDef } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { createDoc, refreshCollection, removeDoc, updateDoc, useCollections } from '../lib/store'
import { api } from '../lib/api'
import { bomCost, explodeNeeds } from '../domain/bom'
import { OP_STATUS, OPERATION_STATUS, PROJECT_PRIORITIES, optColor, optLabel } from '../domain/constants'
import { brl, daysUntil, fmtDate, fmtDuration, matches, todayISO, addDaysISO, uid } from '../lib/format'
import { colors } from '../theme'
import type { OpOperation, OpStatus, ProductionOrder } from '../types'

/** Mensagem da aprovação da qualidade (com a entrega agendada sozinha, quando houver). */
const approvedMessage = (res: { delivery?: { code?: string; date?: string } | null }) =>
  res.delivery ? `Qualidade aprovada. Entrega ${res.delivery.code ?? ''} agendada para ${(res.delivery.date ?? '').split('-').reverse().join('/')} em Entregas.` : 'Qualidade aprovada e ordem concluída.'

const BOARD: OpStatus[] = ['planejada', 'liberada', 'em_producao', 'qualidade', 'concluida']

export const opProgress = (o: ProductionOrder) => {
  if (!o.operations.length) return o.status === 'concluida' ? 100 : 0
  const w = o.operations.reduce((s, x) => s + Math.max(x.plannedMinutes, 1), 0)
  const d = o.operations.reduce((s, x) => s + Math.max(x.plannedMinutes, 1) * (x.status === 'concluida' ? 1 : x.status === 'em_andamento' ? 0.5 : 0), 0)
  return Math.round((d / w) * 100)
}

export function ProductionPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { data, maps, loading } = useCollections(['productionOrders', 'projects'] as const)
  const toast = useToast()
  const [view, setView] = useState<'quadro' | 'lista'>('quadro')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<ProductionOrder | 'new' | null>(params.get('new') === '1' ? 'new' : null)
  const [detailId, setDetailId] = useState<string | null>(params.get('id'))

  const rows = data.productionOrders.filter((o) => matches([o.code, o.title, o.batch, maps.projects.get(o.projectId ?? '')?.name], query))
  const active = data.productionOrders.filter((o) => ['liberada', 'em_producao', 'qualidade'].includes(o.status))
  const late = data.productionOrders.filter((o) => !['concluida', 'cancelada'].includes(o.status) && o.dueDate && (daysUntil(o.dueDate) ?? 0) < 0)
  const detail = detailId ? maps.productionOrders.get(detailId) : null

  const closeDetail = () => {
    setDetailId(null)
    if (params.get('id')) {
      params.delete('id')
      setParams(params, { replace: true })
    }
  }

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return
    const status = r.destination.droppableId as OpStatus
    if (status === 'liberada') {
      void api
        .post(`/production-orders/${r.draggableId}/release`)
        .then(() => refreshCollection('productionOrders'))
        .catch((error: Error) => {
          void refreshCollection('productionOrders')
          toast.error(error.message)
        })
      return
    }
    if (status === 'qualidade') {
      void api
        .post(`/production-orders/${r.draggableId}/quality/start`)
        .then(() => refreshCollection('productionOrders'))
        .catch((error: Error) => {
          void refreshCollection('productionOrders')
          toast.error(error.message)
        })
      return
    }
    if (status === 'concluida') {
      void api
        .post<{ delivery?: { code?: string; date?: string } | null }>(`/production-orders/${r.draggableId}/quality/approve`)
        .then((res) => {
          toast.success(approvedMessage(res))
          return refreshCollection('productionOrders')
        })
        .catch((error: Error) => {
          void refreshCollection('productionOrders')
          toast.error(error.message)
        })
      return
    }
    const patch: Partial<ProductionOrder> = { status }
    void updateDoc('productionOrders', r.draggableId, patch)
  }

  const columns: Column<ProductionOrder>[] = [
    {
      key: 'code',
      header: 'Ordem',
      sort: (o) => o.code,
      render: (o) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {o.code}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {o.title}
          </Typography>
        </Box>
      ),
    },
    { key: 'project', header: 'Projeto', hideBelow: 'md', render: (o) => maps.projects.get(o.projectId ?? '')?.name ?? '—' },
    { key: 'batch', header: 'Lote', hideBelow: 'lg', render: (o) => o.batch || '—' },
    { key: 'status', header: 'Situação', sort: (o) => o.status, render: (o) => <StatusChip options={OP_STATUS} value={o.status} /> },
    { key: 'priority', header: 'Prioridade', hideBelow: 'md', render: (o) => <StatusChip options={PROJECT_PRIORITIES} value={o.priority} /> },
    { key: 'progress', header: 'Avanço', width: 150, sort: (o) => opProgress(o), render: (o) => <ProgressLine value={opProgress(o)} /> },
    {
      key: 'due',
      header: 'Entrega',
      sort: (o) => o.dueDate,
      render: (o) => {
        const d = o.dueDate ? daysUntil(o.dueDate) : null
        const isLate = d !== null && d < 0 && !['concluida', 'cancelada'].includes(o.status)
        return <Box sx={{ color: isLate ? 'error.main' : 'text.primary', fontWeight: isLate ? 700 : 400 }}>{fmtDate(o.dueDate)}</Box>
      },
    },
  ]

  if (loading && !data.productionOrders.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Ordens de produção"
        subtitle="Planejamento e controle da produção: da liberação ao apontamento por setor, com necessidade de materiais e custo."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('new')}>
            Nova ordem
          </Button>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em produção" value={active.length} icon={<FactoryIcon />} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Planejadas" value={data.productionOrders.filter((o) => o.status === 'planejada').length} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Atrasadas" value={late.length} tone={late.length ? 'error' : 'success'} icon={<WarningAmberIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Concluídas no mês" value={data.productionOrders.filter((o) => o.status === 'concluida' && o.completedAt?.slice(0, 7) === todayISO().slice(0, 7)).length} tone="success" />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar OP, projeto, lote…" />
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

      {data.productionOrders.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState icon={<FactoryIcon />} title="Nenhuma ordem de produção" description="Crie uma OP a partir de fichas técnicas para gerar o roteiro por setor e a necessidade de materiais." action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('new')}>Nova ordem</Button>} />
        </Paper>
      ) : view === 'quadro' ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
            {BOARD.map((st) => {
              const items = rows.filter((o) => o.status === st)
              const color = optColor(OP_STATUS, st)
              return (
                <Box key={st} sx={{ width: 300, flexShrink: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, borderRadius: 2, bgcolor: alpha(color, 0.1), mb: 1 }}>
                    <Dot color={color} size={10} />
                    <Typography variant="subtitle2" sx={{ flex: 1 }}>
                      {optLabel(OP_STATUS, st)}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color }}>
                      {items.length}
                    </Typography>
                  </Stack>
                  <Droppable droppableId={st}>
                    {(p, snap) => (
                      <Box ref={p.innerRef} {...p.droppableProps} sx={{ minHeight: 80, p: 0.5, borderRadius: 2, bgcolor: snap.isDraggingOver ? alpha(colors.brand, 0.05) : 'transparent' }}>
                        {items.map((o, i) => {
                          const d = o.dueDate ? daysUntil(o.dueDate) : null
                          return (
                            <Draggable key={o.id} draggableId={o.id} index={i}>
                              {(dp, ds) => (
                                <Paper
                                  ref={dp.innerRef}
                                  {...dp.draggableProps}
                                  {...dp.dragHandleProps}
                                  variant="outlined"
                                  onClick={() => setDetailId(o.id)}
                                  sx={{ p: 1.75, mb: 1, borderRadius: 2.5, cursor: 'pointer', bgcolor: '#fff', boxShadow: ds.isDragging ? '0 10px 28px rgba(30,26,25,0.18)' : 'none', '&:hover': { borderColor: colors.brand } }}
                                >
                                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                                    <Typography variant="caption" sx={{ fontWeight: 700, color: colors.brand }}>
                                      {o.code}
                                    </Typography>
                                    <StatusChip options={PROJECT_PRIORITIES} value={o.priority} />
                                  </Stack>
                                  <Typography variant="subtitle2" sx={{ my: 0.5 }}>
                                    {o.title}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 1 }}>
                                    {maps.projects.get(o.projectId ?? '')?.name ?? 'Sem projeto'}
                                    {o.batch ? ` · Lote ${o.batch}` : ''}
                                  </Typography>
                                  <ProgressLine value={opProgress(o)} label={`${o.operations.filter((x) => x.status === 'concluida').length}/${o.operations.length} etapas`} />
                                  <Typography variant="caption" sx={{ display: 'block', mt: 0.75, fontWeight: 700, color: d !== null && d < 0 && o.status !== 'concluida' ? 'error.main' : 'text.secondary' }}>
                                    Entrega {fmtDate(o.dueDate, 'dd MMM')}
                                  </Typography>
                                </Paper>
                              )}
                            </Draggable>
                          )
                        })}
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
          <DataTable rows={rows} columns={columns} rowKey={(o) => o.id} onRowClick={(o) => setDetailId(o.id)} initialSort={{ key: 'due', dir: 'asc' }} />
        </Paper>
      )}

      {detail ? <OrderDetail order={detail} onClose={closeDetail} onEdit={() => setDialog(detail)} onOpenProject={(id) => navigate(`/projetos/${id}`)} /> : null}
      {dialog ? <OrderDialog order={dialog === 'new' ? null : dialog} onClose={() => { setDialog(null); if (params.get('new')) { params.delete('new'); setParams(params, { replace: true }) } }} onSaved={(id) => setDetailId(id)} /> : null}
    </Box>
  )
}

// ------------------------------------------------------------- order dialog
function OrderDialog({ order, onClose, onSaved }: { order: ProductionOrder | null; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast()
  const { data, maps } = useCollections(['boms', 'workCenters', 'projects'] as const)
  const [items, setItems] = useState(order?.items ?? [{ id: uid(), name: '', quantity: 1 }])

  const fields: FieldDef[] = [
    { name: 'title', label: 'Título da ordem', type: 'text', required: true, span: 8, placeholder: 'Ex.: Cozinha Silva — módulos de balcão' },
    { name: 'priority', label: 'Prioridade', type: 'select', options: PROJECT_PRIORITIES, required: true, span: 4 },
    { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', span: 6 },
    { name: 'batch', label: 'Lote / pedido', type: 'text', span: 6, placeholder: 'Ex.: L-2410-A' },
    { name: 'startDate', label: 'Início planejado', type: 'date', span: 4 },
    { name: 'dueDate', label: 'Entrega', type: 'date', span: 4 },
    { name: 'status', label: 'Situação', type: 'select', options: OP_STATUS, required: true, span: 4 },
    { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
  ]

  const buildOperations = (existing: OpOperation[] | undefined) => {
    const minutes = new Map<string, number>()
    for (const it of items) {
      const bom = it.bomId ? maps.boms.get(it.bomId) : undefined
      for (const r of bom?.routing ?? []) minutes.set(r.workCenterId, (minutes.get(r.workCenterId) ?? 0) + r.minutes * it.quantity)
    }
    const prev = new Map((existing ?? []).map((o) => [o.workCenterId, o]))
    return data.workCenters
      .filter((w) => minutes.has(w.id))
      .sort((a, b) => a.order - b.order)
      .map((w, i): OpOperation => {
        const old = prev.get(w.id)
        return old
          ? { ...old, plannedMinutes: Math.round(minutes.get(w.id) ?? 0), order: i + 1 }
          : { id: uid(), workCenterId: w.id, name: w.name, order: i + 1, plannedMinutes: Math.round(minutes.get(w.id) ?? 0), actualSeconds: 0, status: 'pendente', quantityDone: 0 }
      })
  }

  return (
    <FormDialog
      open
      title={order ? 'Editar ordem de produção' : 'Nova ordem de produção'}
      subtitle={order?.code}
      fields={fields}
      initial={order ? { ...order } : { priority: 'media', status: 'planejada', startDate: todayISO(), dueDate: addDaysISO(todayISO(), 15) }}
      maxWidth="md"
      onClose={onClose}
      onSave={async (values) => {
        const cleanItems = items.filter((i) => i.name.trim() || i.bomId).map((i) => ({ ...i, name: i.name.trim() || maps.boms.get(i.bomId ?? '')?.name || 'Item' }))
        if (!cleanItems.length) throw new Error('Inclua ao menos um item na ordem.')
        const operations = buildOperations(order?.operations)
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = values
        void _i
        void _c
        void _u
        const payload = { ...rest, items: cleanItems, operations } as Partial<ProductionOrder>
        if (order) {
          await updateDoc('productionOrders', order.id, payload)
          toast.success('Ordem atualizada.')
          onSaved(order.id)
        } else {
          const created = await createDoc('productionOrders', { ...payload, materialsPosted: false })
          toast.success(`Ordem ${created.code} criada com ${operations.length} etapas de roteiro.`)
          onSaved(created.id)
        }
      }}
    >
      {() => (
        <Box>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="overline" color="primary">
              Itens a produzir
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setItems((l) => [...l, { id: uid(), name: '', quantity: 1 }])}>
              Adicionar item
            </Button>
          </Stack>
          {items.map((it) => (
            <Stack key={it.id} direction="row" spacing={1} sx={{ mb: 1 }} alignItems="center">
              <Box sx={{ flex: 2 }}>
                <RelationSelect
                  collection="boms"
                  label="Ficha técnica"
                  value={it.bomId}
                  onChange={(id) => setItems((l) => l.map((x) => (x.id === it.id ? { ...x, bomId: id ?? undefined, name: id ? (maps.boms.get(id)?.name ?? x.name) : x.name } : x)))}
                />
              </Box>
              <Box sx={{ flex: 1.2 }}>
                <TextField label="Descrição" value={it.name} onChange={(e) => setItems((l) => l.map((x) => (x.id === it.id ? { ...x, name: e.target.value } : x)))} />
              </Box>
              <Box sx={{ width: 90 }}>
                <NumberField label="Qtd." value={it.quantity} min={1} decimals={0} onChange={(v) => setItems((l) => l.map((x) => (x.id === it.id ? { ...x, quantity: v ?? 1 } : x)))} />
              </Box>
              <IconButton onClick={() => setItems((l) => (l.length > 1 ? l.filter((x) => x.id !== it.id) : l))} aria-label="Remover item">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Typography variant="caption" color="text.secondary">
            O roteiro por setor é calculado automaticamente somando o tempo das fichas técnicas × quantidades.
          </Typography>
        </Box>
      )}
    </FormDialog>
  )
}

// -------------------------------------------------------------- detail panel
function OrderDetail({ order, onClose, onEdit, onOpenProject }: { order: ProductionOrder; onClose: () => void; onEdit: () => void; onOpenProject: (id: string) => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { data, maps } = useCollections(['boms', 'materials', 'workCenters', 'projects', 'suppliers', 'cutPlans', 'users', 'qualityInspections', 'inventoryReservations'] as const)
  const navigate = useNavigate()
  const [posting, setPosting] = useState(false)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectNotes, setRejectNotes] = useState('')

  const needs = useMemo(() => explodeNeeds(order.items, maps.boms, maps.materials), [order.items, maps.boms, maps.materials])
  const reservedByMaterial = useMemo(() => {
    const totals = new Map<string, number>()
    for (const reservation of data.inventoryReservations) {
      if (reservation.status !== 'reserved' || reservation.productionOrderId === order.id) continue
      totals.set(reservation.materialId, (totals.get(reservation.materialId) ?? 0) + reservation.quantity)
    }
    return totals
  }, [data.inventoryReservations, order.id])
  const missing = needs.filter((n) => n.materialId && (maps.materials.get(n.materialId)?.stock ?? 0) - (reservedByMaterial.get(n.materialId) ?? 0) < n.quantity)
  const estCost = useMemo(
    () =>
      order.items.reduce((s, it) => {
        const bom = it.bomId ? maps.boms.get(it.bomId) : undefined
        return s + (bom ? bomCost(bom, maps.materials, maps.workCenters).total * it.quantity : 0)
      }, 0),
    [order.items, maps.boms, maps.materials, maps.workCenters],
  )
  const project = maps.projects.get(order.projectId ?? '')
  const inspection = data.qualityInspections.find((item) => item.id === order.qualityInspectionId)

  const setStatus = async (status: OpStatus) => {
    if (status === 'liberada') {
      await api.post(`/production-orders/${order.id}/release`)
      await refreshCollection('productionOrders')
      toast.success('Ordem liberada e materiais reservados.')
      return
    }
    if (status === 'qualidade') {
      await api.post(`/production-orders/${order.id}/quality/start`)
      await Promise.all([refreshCollection('productionOrders'), refreshCollection('qualityInspections')])
      toast.success('Ordem enviada para inspeção de qualidade.')
      return
    }
    if (status === 'concluida') {
      const res = await api.post<{ delivery?: { code?: string; date?: string } | null }>(`/production-orders/${order.id}/quality/approve`)
      await Promise.all([refreshCollection('productionOrders'), refreshCollection('qualityInspections'), refreshCollection('installations')])
      toast.success(approvedMessage(res))
      return
    }
    const patch: Partial<ProductionOrder> = { status }
    await updateDoc('productionOrders', order.id, patch)
  }

  const postMaterials = async () => {
    const ok = await confirm({
      title: 'Consumir materiais reservados?',
      message: `Serão lançadas saídas de ${needs.length} itens conforme a lista de materiais da ordem ${order.code}. Itens sem saldo suficiente serão ignorados e listados.`,
      confirmLabel: 'Consumir materiais',
    })
    if (!ok) return
    setPosting(true)
    try {
      await api.post(`/production-orders/${order.id}/consume`)
      await Promise.all([refreshCollection('productionOrders'), refreshCollection('materials')])
      toast.success('Materiais consumidos do estoque.')
    } finally {
      setPosting(false)
    }
  }

  const rejectQuality = async () => {
    if (!rejectNotes.trim()) return
    await api.post(`/production-orders/${order.id}/quality/reject`, { notes: rejectNotes.trim() })
    await Promise.all([refreshCollection('productionOrders'), refreshCollection('qualityInspections')])
    setRejectOpen(false)
    setRejectNotes('')
    toast.warning('Inspeção reprovada. A ordem voltou para retrabalho.')
  }

  const generatePurchase = async (supplierId: string | null) => {
    const result = await api.post<{ purchase: { code: string }; existing: boolean; shortages: unknown[] }>(`/production-orders/${order.id}/purchase`, { supplierId: supplierId ?? undefined })
    toast.success(result.existing ? `Pedido de compra ${result.purchase.code} jÃ¡ existe.` : `Pedido de compra ${result.purchase.code} criado com ${result.shortages.length} itens.`)
    setPurchaseOpen(false)
  }

  /* legacy client-side purchase flow kept out of the active path.
  const legacyGeneratePurchase = async (supplierId: string | null) => {
    const items = missing.map((n) => {
      const m = n.materialId ? maps.materials.get(n.materialId) : undefined
      return { materialId: n.materialId, description: n.description, unit: n.unit, quantity: Math.max(n.quantity - (m?.stock ?? 0), 0), unitCost: m?.cost ?? 0, received: 0 }
    })
    const po = await createDoc('purchases', {
      status: 'rascunho',
      supplierId: supplierId ?? undefined,
      projectId: order.projectId,
      productionOrderId: order.id,
      items,
      notes: `Gerado a partir da ${order.code} — materiais em falta.`,
    })
    toast.success(`Pedido de compra ${po.code} criado com ${items.length} itens.`)
    setPurchaseOpen(false)
  }

  */
  const updateOp = (id: string, patch: Partial<OpOperation>) =>
    updateDoc('productionOrders', order.id, { operations: order.operations.map((o) => (o.id === id ? { ...o, ...patch } : o)) })

  const totalPlanned = order.operations.reduce((s, o) => s + o.plannedMinutes, 0)
  const totalActual = order.operations.reduce((s, o) => s + o.actualSeconds, 0)

  return (
    <SideDrawer
      open
      onClose={onClose}
      width={680}
      title={`${order.code} · ${order.title}`}
      subtitle={project ? `Projeto: ${project.name}` : undefined}
      actions={
        <Button size="small" onClick={onEdit}>
          Editar
        </Button>
      }
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <StatusChip options={OP_STATUS} value={order.status} size="medium" />
        <StatusChip options={PROJECT_PRIORITIES} value={order.priority} size="medium" />
        {order.batch ? <Typography variant="caption">Lote {order.batch}</Typography> : null}
        <Box sx={{ flex: 1 }} />
        {order.status === 'planejada' ? (
          <Button size="small" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => setStatus('liberada')}>
            Liberar para produção
          </Button>
        ) : null}
        {order.status === 'liberada' || order.status === 'em_producao' ? (
          <Button size="small" variant="outlined" onClick={() => setStatus('qualidade')}>
            Enviar para qualidade
          </Button>
        ) : null}
        {order.status === 'qualidade' ? (
          <>
            <Button size="small" variant="outlined" color="error" onClick={() => setRejectOpen(true)}>
              Reprovar qualidade
            </Button>
            <Button size="small" variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={() => setStatus('concluida')}>
              Aprovar e concluir
            </Button>
          </>
        ) : null}
      </Stack>

      {order.qualityStatus ? (
        <Alert severity={order.qualityStatus === 'approved' ? 'success' : order.qualityStatus === 'rejected' ? 'error' : 'info'} sx={{ mb: 2 }}>
          Qualidade: <strong>{order.qualityStatus === 'approved' ? 'aprovada' : order.qualityStatus === 'rejected' ? 'reprovada — retrabalho necessário' : 'aguardando inspeção'}</strong>
          {inspection?.notes ? ` · ${inspection.notes}` : ''}
        </Alert>
      ) : null}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={4}>
          <StatCard label="Avanço" value={`${opProgress(order)}%`} tone="brand" />
        </Grid>
        <Grid size={4}>
          <StatCard label="Tempo planejado" value={fmtDuration(totalPlanned * 60)} hint={totalActual ? `${fmtDuration(totalActual)} apontado` : 'Sem apontamento'} />
        </Grid>
        <Grid size={4}>
          <StatCard label="Custo estimado" value={brl(estCost)} />
        </Grid>
      </Grid>

      <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 1 }}>
        Itens
      </Typography>
      {order.items.map((it) => (
        <Stack key={it.id} direction="row" spacing={1} sx={{ py: 0.75, borderBottom: `1px solid ${colors.border}` }}>
          <Typography variant="body2" sx={{ flex: 1 }}>
            {it.name}
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {it.quantity} un
          </Typography>
        </Stack>
      ))}

      <Typography variant="overline" color="primary" sx={{ display: 'block', mt: 3, mb: 1 }}>
        Roteiro por setor
      </Typography>
      {order.operations.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Sem roteiro: vincule fichas técnicas com roteiro de produção aos itens.
        </Typography>
      ) : (
        order.operations
          .sort((a, b) => a.order - b.order)
          .map((op) => (
            <Paper key={op.id} variant="outlined" sx={{ p: 1.5, mb: 1, borderRadius: 2.5 }}>
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Typography variant="caption" sx={{ width: 20, color: colors.textMuted, fontWeight: 700 }}>
                  {op.order}
                </Typography>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {maps.workCenters.get(op.workCenterId)?.name ?? op.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Previsto {fmtDuration(op.plannedMinutes * 60)}
                    {op.actualSeconds ? ` · apontado ${fmtDuration(op.actualSeconds)}` : ''}
                    {op.operatorName ? ` · ${op.operatorName}` : ''}
                  </Typography>
                </Box>
                <TextField select value={op.status} onChange={(e) => updateOp(op.id, { status: e.target.value as OpOperation['status'], ...(e.target.value === 'concluida' ? { finishedAt: new Date().toISOString() } : {}) })} sx={{ width: { xs: 'calc(50% - 6px)', sm: 150 } }}>
                  {OPERATION_STATUS.map((s) => (
                    <MenuItem key={s.value} value={s.value}>
                      {s.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Paper>
          ))
      )}

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 3, mb: 1 }}>
        <Typography variant="overline" color="primary">
          Necessidade de materiais
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<ShoppingCartIcon />} disabled={!missing.length} onClick={() => setPurchaseOpen(true)}>
            Gerar compra ({missing.length})
          </Button>
          <Button size="small" variant="outlined" color="inherit" disabled={posting || order.materialsPosted || !needs.length || order.reservationStatus !== 'reserved'} onClick={postMaterials}>
            {order.materialsPosted ? 'Materiais consumidos' : order.reservationStatus === 'reserved' ? 'Consumir reservados' : 'Libere para reservar'}
          </Button>
        </Stack>
      </Stack>
      {needs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nenhuma necessidade calculada — as fichas técnicas dos itens não possuem peças ou ferragens com material.
        </Typography>
      ) : (
        needs.map((n) => {
          const stock = n.materialId ? (maps.materials.get(n.materialId)?.stock ?? 0) : 0
          const reserved = n.materialId ? (reservedByMaterial.get(n.materialId) ?? 0) : 0
          const available = stock - reserved
          const short = available < n.quantity
          return (
            <Stack key={n.key} direction="row" spacing={1} alignItems="center" sx={{ py: 0.75, borderBottom: `1px solid ${colors.border}` }}>
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                {n.description}
              </Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {n.quantity} {n.unit}
              </Typography>
              <Typography variant="caption" sx={{ width: 120, textAlign: 'right', color: short ? 'error.main' : 'success.main', fontWeight: 700 }}>
                {short ? `Faltam ${Math.max(n.quantity - available, 0)}` : `Disponivel ${available}`}
              </Typography>
            </Stack>
          )
        })
      )}
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 3, mb: 1 }}>
        <Typography variant="overline" color="primary">
          Planos de corte
        </Typography>
        <Button size="small" startIcon={<ContentCutIcon />} onClick={() => navigate('/plano-de-corte?plano=novo')}>
          Novo plano
        </Button>
      </Stack>
      {data.cutPlans.filter((c) => c.productionOrderId === order.id).length === 0 ? (
        <Alert severity="info" icon={<ContentCutIcon fontSize="inherit" />}>
          Nenhum plano de corte vinculado. Crie um em <strong>Plano de corte</strong> e importe as peças desta ordem para otimizar chapas e gerar o G-code.
        </Alert>
      ) : (
        data.cutPlans
          .filter((c) => c.productionOrderId === order.id)
          .map((c) => (
            <Stack key={c.id} direction="row" spacing={1.5} alignItems="center" onClick={() => navigate(`/plano-de-corte?plano=${c.id}`)} sx={{ py: 0.9, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer' }}>
              <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                <strong>{c.code}</strong> · {c.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {data.users.find((u) => u.id === c.responsibleId)?.name ?? ''}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {brl(c.costs?.total)}
              </Typography>
            </Stack>
          ))
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 3 }}>
        {project ? (
          <Button variant="outlined" color="inherit" onClick={() => onOpenProject(project.id)}>
            Abrir projeto
          </Button>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Button
          color="error"
          startIcon={<DeleteIcon />}
          onClick={async () => {
            if (await confirm({ title: 'Excluir ordem de produção?', message: order.code, confirmLabel: 'Excluir', danger: true })) {
              await removeDoc('productionOrders', order.id)
              onClose()
            }
          }}
        >
          Excluir
        </Button>
      </Stack>

      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Reprovar inspeção de qualidade</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Informe o motivo para devolver a ordem ao retrabalho.
          </Typography>
          <TextField autoFocus fullWidth multiline minRows={3} label="Motivo da reprovação" value={rejectNotes} onChange={(event) => setRejectNotes(event.target.value)} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectOpen(false)} color="inherit">Cancelar</Button>
          <Button onClick={rejectQuality} color="error" variant="contained" disabled={!rejectNotes.trim()}>Reprovar</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={purchaseOpen} onClose={() => setPurchaseOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Gerar pedido de compra</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {missing.length} itens abaixo da necessidade serão incluídos em um pedido em rascunho.
          </Typography>
          <PurchaseSupplierPicker suppliers={data.suppliers.filter((s) => s.status === 'ativo')} onConfirm={generatePurchase} onCancel={() => setPurchaseOpen(false)} />
        </DialogContent>
      </Dialog>
    </SideDrawer>
  )
}

function PurchaseSupplierPicker({ suppliers, onConfirm, onCancel }: { suppliers: { id: string; name: string }[]; onConfirm: (id: string | null) => void; onCancel: () => void }) {
  const [id, setId] = useState('')
  return (
    <>
      <TextField select label="Fornecedor" value={id} onChange={(e) => setId(e.target.value)}>
        <MenuItem value="">Definir depois</MenuItem>
        {suppliers.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.name}
          </MenuItem>
        ))}
      </TextField>
      <DialogActions sx={{ px: 0, pt: 2 }}>
        <Button color="inherit" onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={() => onConfirm(id || null)}>
          Criar pedido
        </Button>
      </DialogActions>
    </>
  )
}
