import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Alert,
  Avatar,
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
  Pagination,
  Paper,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, CloudSyncIcon, Inventory2Icon, OpenInNewIcon, SwapVertIcon, WarningAmberIcon, CheckCircleIcon, StorefrontIcon, ImageIcon, ShoppingCartIcon } from '../components/icons'
import { OffcutsTab } from './Offcuts'
import { DataTable, EmptyState, LoadingState, PageHeader, SearchField, StatCard, StatusChip, type Column } from '../components/ui'
import { FormDialog, NumberField, type FieldDef } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { api, fileUrl } from '../lib/api'
import { createDoc, refreshCollection, removeDoc, updateDoc, useCollections } from '../lib/store'
import { MATERIAL_CATEGORIES, UNITS } from '../domain/constants'
import { brl, fmtDate, fmtDateTime, fmtNumber, matches } from '../lib/format'
import { colors } from '../theme'
import type { InventoryMovement, Material } from '../types'

interface CatalogItem {
  id: string
  kind: 'chapa' | 'ferragem' | 'fita'
  code: string
  name: string
  category: string
  brand: string | null
  thickness: number | null
  width: number | null
  height: number | null
  unit: string
  price: number | null
  pricePerM2: number | null
  image: string | null
  url: string | null
  updatedAt: string | null
}
interface CatalogPage {
  total: number
  page: number
  pageSize: number
  items: CatalogItem[]
  supplier?: SupplierReference
}
interface SupplierReference {
  id: string
  name: string
  code?: string
  status?: string
}
interface Facets {
  generatedAt: string | null
  total: number
  kinds: Record<string, { total: number; priced: number; categories: Record<string, number> }>
  brands: string[]
  thickness: number[]
  supplier?: SupplierReference
}

const KIND_LABEL: Record<string, string> = { chapa: 'Chapas MDF/MDP', ferragem: 'Ferragens', fita: 'Fitas de borda' }

export function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState(params.get('aba') === 'catalogo' ? 1 : params.get('aba') === 'retalhos' ? 3 : 0)
  return (
    <Box>
      <PageHeader title="Estoque e catálogo" subtitle="Saldos, movimentações e o catálogo da Leo Madeiras com preços em reais." />
      <Tabs
        value={tab}
        variant="scrollable"
        scrollButtons="auto"
        onChange={(_, v) => {
          setTab(v)
          params.set('aba', ['estoque', 'catalogo', 'movimentos', 'retalhos'][v])
          setParams(params, { replace: true })
        }}
        sx={{ mb: 2.5, borderBottom: `1px solid ${colors.border}` }}
      >
        <Tab label="Estoque" />
        <Tab label="Catálogo Leo Madeiras" />
        <Tab label="Movimentações" />
        <Tab label="Retalhos" />
      </Tabs>
      {tab === 0 ? <StockTab /> : tab === 1 ? <CatalogTab /> : tab === 2 ? <MovementsTab /> : <OffcutsTab />}
    </Box>
  )
}

// ---------------------------------------------------------------- Estoque
function StockTab() {
  const toast = useToast()
  const confirm = useConfirm()
  const [params] = useSearchParams()
  const { data, maps, loading } = useCollections(['materials', 'suppliers'] as const)
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [category, setCategory] = useState('')
  const [onlyLow, setOnlyLow] = useState(false)
  const [editing, setEditing] = useState<Material | 'new' | null>(null)
  const [moving, setMoving] = useState<Material | null>(null)

  const rows = data.materials.filter(
    (m) => (!category || m.category === category) && (!onlyLow || (m.minStock > 0 && m.stock <= m.minStock)) && matches([m.name, m.code, m.brand, m.subcategory, m.location], query),
  )
  const low = data.materials.filter((m) => m.active !== false && m.minStock > 0 && m.stock <= m.minStock)
  const value = data.materials.reduce((s, m) => s + m.stock * m.cost, 0)

  const fields: FieldDef[] = [
    { name: 'name', label: 'Descrição', type: 'text', required: true, span: 8 },
    { name: 'code', label: 'Código', type: 'text', span: 4 },
    { name: 'category', label: 'Categoria', type: 'select', options: MATERIAL_CATEGORIES, required: true, span: 4 },
    { name: 'subcategory', label: 'Subcategoria', type: 'text', span: 4 },
    { name: 'brand', label: 'Marca', type: 'text', span: 4 },
    { name: 'unit', label: 'Unidade', type: 'select', options: UNITS, required: true, span: 3 },
    { name: 'cost', label: 'Custo unitário (R$)', type: 'money', required: true, span: 3 },
    { name: 'stock', label: 'Saldo inicial', type: 'number', span: 3, disabled: (v) => Boolean(v.id), helper: 'Use “Movimentar” para ajustar' },
    { name: 'minStock', label: 'Estoque mínimo', type: 'number', span: 3, min: 0 },
    { name: 'thickness', label: 'Espessura (mm)', type: 'number', span: 3, show: (v) => v.category === 'chapa' || v.category === 'fita_borda' },
    { name: 'sheetWidth', label: 'Comprimento da chapa (mm)', type: 'number', span: 3, show: (v) => v.category === 'chapa' },
    { name: 'sheetHeight', label: 'Largura da chapa (mm)', type: 'number', span: 3, show: (v) => v.category === 'chapa' },
    { name: 'supplierId', label: 'Fornecedor', type: 'relation', collection: 'suppliers', span: 6 },
    { name: 'location', label: 'Local de armazenagem', type: 'text', span: 6, placeholder: 'Ex.: Corredor B · Prateleira 3' },
    { name: 'photoFileId', label: 'Foto do material', type: 'image', span: 12 },
    { name: 'active', label: 'Item ativo', type: 'switch', span: 6 },
  ]

  const columns: Column<Material>[] = [
    {
      key: 'name',
      header: 'Material',
      sort: (m) => m.name,
      render: (m) => (
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Avatar variant="rounded" src={m.photoFileId ? fileUrl(m.photoFileId, { inline: true }) : (m.imageUrl ?? undefined)} sx={{ width: 40, height: 40, bgcolor: colors.subtle, color: colors.textMuted, border: `1px solid ${colors.border}` }}>
            <ImageIcon fontSize="small" />
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {m.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {[m.code, m.brand].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        </Stack>
      ),
    },
    { key: 'cat', header: 'Categoria', hideBelow: 'md', sort: (m) => m.category, render: (m) => <StatusChip options={MATERIAL_CATEGORIES} value={m.category} /> },
    {
      key: 'stock',
      header: 'Saldo',
      align: 'right',
      sort: (m) => m.stock,
      render: (m) => {
        const isLow = m.minStock > 0 && m.stock <= m.minStock
        return (
          <Stack direction="row" spacing={0.75} justifyContent="flex-end" alignItems="center" sx={{ color: isLow ? 'error.main' : 'text.primary', fontWeight: isLow ? 700 : 500 }}>
            {isLow ? <WarningAmberIcon sx={{ fontSize: 16 }} /> : null}
            <span>
              {fmtNumber(m.stock)} {m.unit}
            </span>
          </Stack>
        )
      },
    },
    { key: 'min', header: 'Mínimo', align: 'right', hideBelow: 'md', sort: (m) => m.minStock, render: (m) => (m.minStock ? fmtNumber(m.minStock) : '—') },
    { key: 'cost', header: 'Custo (R$)', align: 'right', sort: (m) => m.cost, render: (m) => brl(m.cost) },
    { key: 'total', header: 'Valor em estoque', align: 'right', hideBelow: 'lg', sort: (m) => m.stock * m.cost, render: (m) => brl(m.stock * m.cost) },
    { key: 'supplier', header: 'Fornecedor', hideBelow: 'lg', render: (m) => maps.suppliers.get(m.supplierId ?? '')?.name ?? '—' },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 56,
      render: (m) => (
        <Tooltip title="Movimentar estoque">
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); setMoving(m) }} aria-label="Movimentar">
            <SwapVertIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ),
    },
  ]

  if (loading && !data.materials.length) return <LoadingState />

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Itens cadastrados" value={data.materials.length} icon={<Inventory2Icon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Valor em estoque" value={brl(value)} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Abaixo do mínimo" value={low.length} tone={low.length ? 'error' : 'success'} icon={<WarningAmberIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Sem saldo" value={data.materials.filter((m) => m.active !== false && m.stock <= 0).length} tone="warning" />
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <SearchField value={query} onChange={setQuery} placeholder="Buscar material, código, marca…" />
          <TextField select label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 220 } }}>
            <MenuItem value="">Todas</MenuItem>
            {MATERIAL_CATEGORIES.map((c) => (
              <MenuItem key={c.value} value={c.value}>
                {c.label}
              </MenuItem>
            ))}
          </TextField>
          <FormControlLabel control={<Switch checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />} label="Somente abaixo do mínimo" />
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
            Novo material
          </Button>
        </Stack>
        {rows.length === 0 ? (
          <EmptyState
            icon={<Inventory2Icon />}
            title={data.materials.length ? 'Nenhum material encontrado' : 'Estoque vazio'}
            description={data.materials.length ? 'Ajuste os filtros.' : 'Cadastre materiais ou importe itens do catálogo da Leo Madeiras na aba “Catálogo”.'}
          />
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(m) => m.id} onRowClick={(m) => setEditing(m)} initialSort={{ key: 'name', dir: 'asc' }} />
        )}
      </Paper>

      {editing ? (
        <FormDialog
          open
          title={editing === 'new' ? 'Novo material' : 'Editar material'}
          fields={fields}
          initial={editing === 'new' ? { category: 'chapa', unit: 'chapa', active: true, stock: 0, minStock: 0, cost: 0 } : { ...editing }}
          onClose={() => setEditing(null)}
          extraActions={
            editing !== 'new' ? (
              <Button
                color="error"
                onClick={async () => {
                  if (await confirm({ title: 'Excluir material?', message: editing.name, confirmLabel: 'Excluir', danger: true })) {
                    await removeDoc('materials', editing.id)
                    setEditing(null)
                  }
                }}
              >
                Excluir
              </Button>
            ) : undefined
          }
          onSave={async (values) => {
            const { id, createdAt, updatedAt, ...rest } = values
            void createdAt
            void updatedAt
            if (id) await updateDoc('materials', id, { ...rest, priceSource: rest.priceSource === 'leo_madeiras' && rest.cost === maps.materials.get(id)?.cost ? 'leo_madeiras' : 'manual' })
            else await createDoc('materials', { ...rest, priceSource: 'manual' })
            toast.success('Material salvo.')
          }}
        />
      ) : null}
      {moving ? <MovementDialog material={moving} onClose={() => setMoving(null)} /> : null}
    </Box>
  )
}

function MovementDialog({ material, onClose }: { material: Material; onClose: () => void }) {
  const toast = useToast()
  const [type, setType] = useState<'entry' | 'exit' | 'adjustment'>('entry')
  const [qty, setQty] = useState<number | null>(null)
  const [unitCost, setUnitCost] = useState<number | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (qty === null || (type !== 'adjustment' && qty <= 0)) return toast.error('Informe uma quantidade válida.')
    setBusy(true)
    try {
      await api.post('/inventory/movement', { materialId: material.id, type, quantity: qty, reason, unitCost: type === 'entry' ? unitCost : undefined })
      await Promise.all([refreshCollection('materials'), refreshCollection('inventoryMovements')])
      toast.success('Movimentação registrada.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha na movimentação.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Movimentar estoque</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {material.name}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          Saldo atual: {fmtNumber(material.stock)} {material.unit}
        </Typography>
        <Stack spacing={2}>
          <TextField select label="Tipo" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <MenuItem value="entry">Entrada</MenuItem>
            <MenuItem value="exit">Saída / consumo</MenuItem>
            <MenuItem value="adjustment">Ajuste de inventário (define o saldo)</MenuItem>
          </TextField>
          <NumberField label={type === 'adjustment' ? 'Novo saldo' : 'Quantidade'} value={qty} onChange={setQty} min={0} adornment={material.unit} />
          {type === 'entry' ? <NumberField label="Custo unitário desta compra (opcional)" value={unitCost} onChange={setUnitCost} adornment="R$" decimals={2} min={0} /> : null}
          <TextField label="Motivo / referência" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          Registrar
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ---------------------------------------------------------------- Catálogo
function CatalogTab() {
  const toast = useToast()
  const { can } = useAuth()
  const { data } = useCollections(['materials'] as const)
  const [facets, setFacets] = useState<Facets | null>(null)
  const [kind, setKind] = useState<'chapa' | 'ferragem' | 'fita'>('chapa')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [thickness, setThickness] = useState('')
  const [priced, setPriced] = useState(true)
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<CatalogPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedItems, setSelectedItems] = useState<Map<string, CatalogItem>>(new Map())
  const [moving, setMoving] = useState<Material | null>(null)
  const [purchaseOpen, setPurchaseOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ updated: number; unchanged: number; missing: number; changes: { id: string; name: string; from: number; to: number }[] } | null>(null)

  const importedMaterials = useMemo(() => new Map(data.materials.filter((m) => m.catalogId).map((m) => [m.catalogId as string, m])), [data.materials])
  const imported = useMemo(() => new Set(importedMaterials.keys()), [importedMaterials])

  useEffect(() => {
    api.get<Facets>('/catalog/leo/facets').then(setFacets).catch(() => setFacets(null))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ kind, q, sort, page: String(page), pageSize: '24' })
      if (category) qs.set('category', category)
      if (brand) qs.set('brand', brand)
      if (thickness && kind === 'chapa') qs.set('thickness', thickness)
      if (priced) qs.set('priced', '1')
      setResult(await api.get<CatalogPage>(`/catalog/leo?${qs}`))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao consultar o catálogo.')
    } finally {
      setLoading(false)
    }
  }, [kind, q, category, brand, thickness, priced, sort, page, toast])

  useEffect(() => {
    const t = window.setTimeout(load, 220)
    return () => window.clearTimeout(t)
  }, [load])

  useEffect(() => setPage(1), [kind, q, category, brand, thickness, priced, sort])
  useEffect(() => {
    setCategory('')
    setThickness('')
  }, [kind])

  const addItems = async (ids: string[]) => {
    try {
      const res = await api.post<{ created: Material[]; skipped: string[]; materials: Material[] }>('/catalog/leo/import', { ids })
      await refreshCollection('materials')
      setSelected(new Set())
      setSelectedItems(new Map())
      if (ids.length === 1 && res.created[0]) setMoving(res.created[0])
      toast.success(`${res.created.length} item(ns) adicionados ao estoque${res.skipped.length ? ` · ${res.skipped.length} já existiam` : ''}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar.')
    }
  }

  const sync = async () => {
    setSyncing(true)
    try {
      const res = await api.post<NonNullable<typeof syncResult> & { generatedAt: string | null }>('/catalog/leo/sync-prices?reload=1')
      await refreshCollection('materials')
      setSyncResult(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao atualizar preços.')
    } finally {
      setSyncing(false)
    }
  }

  const kindInfo = facets?.kinds[kind]
  const categories = Object.keys(kindInfo?.categories ?? {}).sort((a, b) => a.localeCompare(b, 'pt-BR'))

  return (
    <Box>
      <Paper variant="outlined" sx={{ mb: 1.5, px: 2, py: 1.25, borderRadius: 2.5 }}>
        <Stack direction="row" spacing={1} alignItems="center">
          <StorefrontIcon color="primary" fontSize="small" />
          <Typography variant="body2">
            Fornecedor de referencia: <strong>{facets?.supplier?.name ?? 'Leo Madeiras'}</strong>
          </Typography>
          <Chip size="small" label="Catalogo para incluir no estoque" color="info" variant="outlined" />
        </Stack>
      </Paper>
      <Alert
        severity="info"
        icon={<StorefrontIcon fontSize="inherit" />}
        sx={{ mb: 2.5 }}
        action={
          <Button color="inherit" size="small" startIcon={<CloudSyncIcon />} onClick={sync} disabled={syncing} sx={{ whiteSpace: 'nowrap' }}>
            {syncing ? 'Atualizando…' : 'Atualizar preços do estoque'}
          </Button>
        }
      >
        Catálogo da <strong>Leo Madeiras</strong> com preços em <strong>reais (R$)</strong>
        {facets?.generatedAt ? ` — base de ${fmtDate(facets.generatedAt)}, ${facets.total.toLocaleString('pt-BR')} itens` : ''}. Itens sem preço publicado aparecem como “sob consulta”.
      </Alert>

      <Tabs value={kind} onChange={(_, v) => setKind(v)} sx={{ mb: 2 }}>
        {(['chapa', 'ferragem', 'fita'] as const).map((k) => (
          <Tab key={k} value={k} label={`${KIND_LABEL[k]}${facets ? ` (${facets.kinds[k]?.priced ?? 0})` : ''}`} />
        ))}
      </Tabs>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <SearchField value={q} onChange={setQ} placeholder="Buscar por nome, código ou cor (ex.: branco ártico 18mm)" width={360} />
        <TextField select label="Categoria" value={category} onChange={(e) => setCategory(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 190 } }}>
          <MenuItem value="">Todas</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c} value={c}>
              {c} ({kindInfo?.categories[c]})
            </MenuItem>
          ))}
        </TextField>
        <TextField select label="Marca" value={brand} onChange={(e) => setBrand(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 160 } }}>
          <MenuItem value="">Todas</MenuItem>
          {(facets?.brands ?? []).map((b) => (
            <MenuItem key={b} value={b}>
              {b}
            </MenuItem>
          ))}
        </TextField>
        {kind === 'chapa' ? (
          <TextField select label="Espessura" value={thickness} onChange={(e) => setThickness(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 130 } }}>
            <MenuItem value="">Todas</MenuItem>
            {(facets?.thickness ?? []).map((t) => (
              <MenuItem key={t} value={String(t)}>
                {t} mm
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <TextField select label="Ordenar" value={sort} onChange={(e) => setSort(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }}>
          <MenuItem value="name">Nome (A–Z)</MenuItem>
          <MenuItem value="price_asc">Menor preço</MenuItem>
          <MenuItem value="price_desc">Maior preço</MenuItem>
        </TextField>
        <FormControlLabel control={<Switch checked={priced} onChange={(e) => setPriced(e.target.checked)} />} label="Somente com preço" />
        <Box sx={{ flex: 1 }} />
        {selected.size ? (
          <Stack direction="row" spacing={1}>
            {can('purchases') ? (
              <Button variant="outlined" startIcon={<ShoppingCartIcon />} onClick={() => setPurchaseOpen(true)}>
                Gerar pedido ({selected.size})
              </Button>
            ) : null}
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => addItems([...selected])}>
              Adicionar {selected.size} ao estoque
            </Button>
          </Stack>
        ) : null}
      </Stack>

      {loading && !result ? (
        <LoadingState />
      ) : !result || result.items.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState icon={<StorefrontIcon />} title="Nenhum item encontrado" description="Tente outros termos ou desative “Somente com preço”." />
        </Paper>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            {result.total.toLocaleString('pt-BR')} itens
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)', xl: 'repeat(4, 1fr)' }, gap: 2, opacity: loading ? 0.6 : 1, transition: 'opacity .15s' }}>
            {result.items.map((it) => {
              const inStock = imported.has(it.id)
              return (
                <Paper key={it.id} variant="outlined" sx={{ p: 1.5, borderRadius: 3, display: 'flex', flexDirection: 'column', borderColor: selected.has(it.id) ? colors.brand : colors.border }}>
                  <Stack direction="row" spacing={1.5}>
                    <Avatar variant="rounded" src={it.image ?? undefined} slotProps={{ img: { loading: 'lazy', referrerPolicy: 'no-referrer' } }} sx={{ width: 76, height: 76, bgcolor: colors.subtle, border: `1px solid ${colors.border}` }}>
                      <ImageIcon sx={{ color: colors.textMuted }} />
                    </Avatar>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: 1.35 }}>
                        {it.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {it.code}
                        {it.brand ? ` · ${it.brand}` : ''}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                        Fornecedor: {result.supplier?.name ?? facets?.supplier?.name ?? 'Leo Madeiras'}
                      </Typography>
                    </Box>
                    {!inStock ? (
                    <Checkbox
                      size="small"
                      checked={selected.has(it.id)}
                      onChange={(e) => {
                        setSelected((s) => {
                          const n = new Set(s)
                          if (e.target.checked) n.add(it.id)
                          else n.delete(it.id)
                          return n
                        })
                        setSelectedItems((items) => {
                          const next = new Map(items)
                          if (e.target.checked) next.set(it.id, it)
                          else next.delete(it.id)
                          return next
                        })
                      }}
                      sx={{ alignSelf: 'flex-start', p: 0.25 }}
                    />
                    ) : null}
                  </Stack>
                  <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mt: 1.5 }}>
                    <Box>
                      {it.price !== null ? (
                        <>
                          <Typography sx={{ fontSize: '1.15rem', fontWeight: 700, color: colors.brand, lineHeight: 1.2 }}>{brl(it.price)}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            por {it.unit}
                            {it.pricePerM2 ? ` · ${brl(it.pricePerM2)}/m²` : ''}
                          </Typography>
                        </>
                      ) : (
                        <Chip size="small" label="Sob consulta" />
                      )}
                      {it.kind === 'chapa' && it.width ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {it.width} × {it.height} mm · {it.thickness} mm
                        </Typography>
                      ) : null}
                      {it.kind === 'fita' && it.width ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {it.width} mm × {it.thickness} mm
                        </Typography>
                      ) : null}
                    </Box>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {it.url ? (
                        <Tooltip title="Ver no site da Leo Madeiras">
                          <IconButton size="small" component="a" href={it.url} target="_blank" rel="noreferrer" aria-label="Abrir no site">
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      {inStock ? (
                        <Stack spacing={0.25} alignItems="flex-end">
                          <Chip size="small" icon={<CheckCircleIcon />} label="No estoque" color="success" variant="outlined" />
                          <Typography variant="caption" color="text.secondary">
                            Saldo: {fmtNumber(importedMaterials.get(it.id)?.stock ?? 0)} {it.unit}
                          </Typography>
                        </Stack>
                      ) : (
                        <Button size="small" variant="outlined" onClick={() => addItems([it.id])}>
                          Incluir e registrar entrada
                        </Button>
                      )}
                    </Stack>
                  </Stack>
                </Paper>
              )
            })}
          </Box>
          <Stack alignItems="center" sx={{ mt: 3 }}>
            <Pagination count={Math.ceil(result.total / result.pageSize)} page={page} onChange={(_, p) => setPage(p)} color="primary" shape="rounded" />
          </Stack>
        </>
      )}

      <Dialog open={Boolean(syncResult)} onClose={() => setSyncResult(null)} fullWidth maxWidth="sm">
        <DialogTitle>Atualização de preços</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid size={4}>
              <StatCard label="Atualizados" value={syncResult?.updated ?? 0} tone="brand" />
            </Grid>
            <Grid size={4}>
              <StatCard label="Sem alteração" value={syncResult?.unchanged ?? 0} />
            </Grid>
            <Grid size={4}>
              <StatCard label="Fora do catálogo" value={syncResult?.missing ?? 0} tone="warning" />
            </Grid>
          </Grid>
          {syncResult?.changes.length ? (
            <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
              {syncResult.changes.map((c) => (
                <Stack key={c.id} direction="row" spacing={1} sx={{ py: 0.75, borderBottom: `1px solid ${colors.border}` }}>
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {c.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                    {brl(c.from)}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: c.to > c.from ? colors.error : colors.success }}>
                    {brl(c.to)}
                  </Typography>
                </Stack>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Os preços do estoque já estão alinhados com o catálogo.
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            Para renovar o catálogo, atualize os preços no IROD-Orça e execute <code>npm run catalog:export</code>; depois clique novamente em “Atualizar preços do estoque”.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSyncResult(null)}>Fechar</Button>
        </DialogActions>
      </Dialog>
      {moving ? <MovementDialog material={moving} onClose={() => setMoving(null)} /> : null}
      {purchaseOpen ? (
        <CatalogPurchaseDialog
          items={[...selectedItems.values()]}
          onClose={() => setPurchaseOpen(false)}
          onCreated={() => {
            setSelected(new Set())
            setSelectedItems(new Map())
          }}
        />
      ) : null}
    </Box>
  )
}

// ------------------------------------------------------------ Movimentações
function CatalogPurchaseDialog({ items, onClose, onCreated }: { items: CatalogItem[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast()
  const [quantities, setQuantities] = useState<Record<string, number>>(() => Object.fromEntries(items.map((item) => [item.id, 1])))
  const [busy, setBusy] = useState(false)
  const subtotal = items.reduce((sum, item) => sum + (quantities[item.id] ?? 0) * (item.price ?? 0), 0)

  const submit = async () => {
    const lines = items.map((item) => ({ id: item.id, quantity: Number(quantities[item.id] ?? 0) })).filter((line) => line.quantity > 0)
    if (!lines.length) return toast.error('Informe ao menos uma quantidade.')
    setBusy(true)
    try {
      const result = await api.post<{ purchase: { code: string }; supplier: { name: string } }>('/catalog/leo/purchase', { items: lines })
      await Promise.all([refreshCollection('materials'), refreshCollection('purchases')])
      toast.success(`Pedido ${result.purchase.code} criado para ${result.supplier.name}.`)
      onCreated()
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao gerar pedido.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Gerar pedido de compra</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          Fornecedor: <strong>Leo Madeiras</strong>. O pedido será criado como rascunho para revisão e aprovação.
        </Alert>
        <Stack spacing={1}>
          {items.map((item) => (
            <Stack key={item.id} direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.75, borderBottom: `1px solid ${colors.border}` }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                  {item.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.code} · {item.price !== null ? brl(item.price) : 'Sob consulta'} / {item.unit}
                </Typography>
              </Box>
              <Box sx={{ width: 120 }}>
                <NumberField label="Qtd." value={quantities[item.id] ?? 0} min={0} onChange={(value) => setQuantities((current) => ({ ...current, [item.id]: value ?? 0 }))} />
              </Box>
              <Typography variant="body2" sx={{ width: 120, textAlign: 'right', fontWeight: 700 }}>
                {brl((quantities[item.id] ?? 0) * (item.price ?? 0))}
              </Typography>
            </Stack>
          ))}
        </Stack>
        <Typography variant="subtitle1" sx={{ textAlign: 'right', mt: 2, fontWeight: 700 }}>
          Subtotal estimado: {brl(subtotal)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Produtos sem preço publicado entram com custo zero e devem ser revisados no pedido.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose} disabled={busy}>Cancelar</Button>
        <Button variant="contained" startIcon={<ShoppingCartIcon />} onClick={submit} disabled={busy}>Criar pedido</Button>
      </DialogActions>
    </Dialog>
  )
}

function MovementsTab() {
  const { data, loading } = useCollections(['inventoryMovements'] as const)
  const [query, setQuery] = useState('')
  const rows = data.inventoryMovements.filter((m) => matches([m.materialName, m.reason, m.userName], query))
  const TYPE: Record<InventoryMovement['type'], { label: string; color: string }> = {
    entry: { label: 'Entrada', color: colors.success },
    exit: { label: 'Saída', color: colors.error },
    adjustment: { label: 'Ajuste', color: colors.info },
    reserve: { label: 'Reserva', color: colors.warning },
  }
  const columns: Column<InventoryMovement>[] = [
    { key: 'at', header: 'Data', sort: (m) => m.occurredAt, render: (m) => fmtDateTime(m.occurredAt) },
    { key: 'material', header: 'Material', sort: (m) => m.materialName, render: (m) => m.materialName },
    { key: 'type', header: 'Tipo', render: (m) => <Chip size="small" label={TYPE[m.type].label} sx={{ bgcolor: alpha(TYPE[m.type].color, 0.12), color: TYPE[m.type].color }} /> },
    { key: 'qty', header: 'Qtd.', align: 'right', sort: (m) => m.quantity, render: (m) => `${fmtNumber(m.quantity)} ${m.unit}` },
    { key: 'bal', header: 'Saldo', align: 'right', hideBelow: 'md', render: (m) => `${fmtNumber(m.stockBefore)} → ${fmtNumber(m.stockAfter)}` },
    { key: 'reason', header: 'Motivo', hideBelow: 'lg', render: (m) => m.reason || '—' },
    { key: 'user', header: 'Usuário', hideBelow: 'md', render: (m) => m.userName },
  ]
  if (loading) return <LoadingState />
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${colors.border}` }}>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar movimentações…" />
      </Box>
      {rows.length === 0 ? <EmptyState icon={<SwapVertIcon />} title="Nenhuma movimentação" description="Entradas, saídas e ajustes aparecem aqui com o saldo antes e depois." /> : <DataTable rows={rows} columns={columns} rowKey={(m) => m.id} initialSort={{ key: 'at', dir: 'desc' }} />}
    </Paper>
  )
}
