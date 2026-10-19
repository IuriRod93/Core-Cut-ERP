import { useMemo, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, AutoAwesomeIcon, CloseIcon, ContentCopyIcon, DeleteIcon, TuneIcon, ViewInArIcon } from '../components/icons'
import { MachiningDialog } from '../components/MachiningDialog'
import { hingeHoles, newMachining, shelfPinHoles } from '../domain/machining'
import { DataTable, EmptyState, LoadingState, PageHeader, SearchField, StatCard, type Column } from '../components/ui'
import { NumberField, RelationSelect } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { createDoc, removeDoc, updateDoc, useCollections } from '../lib/store'
import { bomCost } from '../domain/bom'
import { BOM_CATEGORIES, optLabel } from '../domain/constants'
import { brl, matches, round2, uid } from '../lib/format'
import { colors } from '../theme'
import type { Bom, BomPart } from '../types'

const blank = (): Bom =>
  ({ id: '', createdAt: '', updatedAt: '', name: '', category: 'balcao', width: 800, height: 720, depth: 560, parts: [], hardware: [], routing: [], active: true }) as Bom

export function BomsPage() {
  const { data, maps, loading } = useCollections(['boms', 'materials', 'workCenters'] as const)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Bom | null>(null)
  const [generator, setGenerator] = useState(false)
  const confirm = useConfirm()
  const toast = useToast()

  const costs = useMemo(() => new Map(data.boms.map((b) => [b.id, bomCost(b, maps.materials, maps.workCenters)])), [data.boms, maps.materials, maps.workCenters])
  const rows = data.boms.filter((b) => matches([b.name, b.code, optLabel(BOM_CATEGORIES, b.category)], query))

  const columns: Column<Bom>[] = [
    {
      key: 'name',
      header: 'Ficha técnica',
      sort: (b) => b.name,
      render: (b) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {b.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {b.code} · {optLabel(BOM_CATEGORIES, b.category)}
          </Typography>
        </Box>
      ),
    },
    { key: 'dims', header: 'L × A × P (mm)', hideBelow: 'md', render: (b) => [b.width, b.height, b.depth].filter(Boolean).join(' × ') || '—' },
    { key: 'parts', header: 'Peças', align: 'right', sort: (b) => b.parts.reduce((s, p) => s + p.quantity, 0), render: (b) => b.parts.reduce((s, p) => s + p.quantity, 0) },
    { key: 'area', header: 'Área (m²)', align: 'right', hideBelow: 'md', sort: (b) => costs.get(b.id)?.areaM2, render: (b) => costs.get(b.id)?.areaM2.toFixed(2).replace('.', ',') },
    { key: 'min', header: 'Tempo', align: 'right', hideBelow: 'md', sort: (b) => costs.get(b.id)?.minutes, render: (b) => `${costs.get(b.id)?.minutes ?? 0} min` },
    { key: 'cost', header: 'Custo', align: 'right', sort: (b) => costs.get(b.id)?.total, render: (b) => <strong>{brl(costs.get(b.id)?.total)}</strong> },
    { key: 'price', header: 'Preço de venda', align: 'right', hideBelow: 'lg', sort: (b) => b.salePrice, render: (b) => (b.salePrice ? brl(b.salePrice) : '—') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 90,
      render: (b) => (
        <Stack direction="row" justifyContent="flex-end">
          <IconButton
            size="small"
            aria-label="Duplicar"
            onClick={async (e) => {
              e.stopPropagation()
              const { id: _i, createdAt: _c, updatedAt: _u, code: _code, ...rest } = b
              void _i
              void _c
              void _u
              void _code
              await createDoc('boms', { ...rest, name: `${b.name} (cópia)` })
              toast.success('Ficha duplicada.')
            }}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            aria-label="Excluir"
            onClick={async (e) => {
              e.stopPropagation()
              if (await confirm({ title: 'Excluir ficha técnica?', message: b.name, confirmLabel: 'Excluir', danger: true })) await removeDoc('boms', b.id)
            }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>
      ),
    },
  ]

  if (loading && !data.boms.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Fichas técnicas"
        subtitle="Módulos e produtos padronizados com lista de peças, ferragens e roteiro de produção. Base para orçamento, plano de corte e ordens de produção."
        actions={
          <>
            <Button variant="outlined" color="inherit" startIcon={<AutoAwesomeIcon />} onClick={() => setGenerator(true)}>
              Gerar módulo paramétrico
            </Button>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(blank())}>
              Nova ficha
            </Button>
          </>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Fichas cadastradas" value={data.boms.length} icon={<ViewInArIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Peças catalogadas" value={data.boms.reduce((s, b) => s + b.parts.length, 0)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Custo médio" value={brl(data.boms.length ? [...costs.values()].reduce((s, c) => s + c.total, 0) / data.boms.length : 0)} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Sem material definido" value={data.boms.filter((b) => b.parts.some((p) => !p.materialId)).length} tone="warning" hint="Fichas com peças sem chapa" />
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Box sx={{ p: 2, borderBottom: `1px solid ${colors.border}` }}>
          <SearchField value={query} onChange={setQuery} placeholder="Buscar fichas técnicas…" />
        </Box>
        {rows.length === 0 ? (
          <EmptyState icon={<ViewInArIcon />} title="Nenhuma ficha técnica" description="Cadastre módulos padronizados ou gere um módulo paramétrico a partir das dimensões." />
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(b) => b.id} onRowClick={(b) => setEditing(b)} />
        )}
      </Paper>
      {editing ? <BomEditor bom={editing} onClose={() => setEditing(null)} /> : null}
      {generator ? <Generator onClose={() => setGenerator(false)} onCreate={(b) => { setGenerator(false); setEditing(b) }} /> : null}
    </Box>
  )
}

// ------------------------------------------------------------------ editor
function BomEditor({ bom, onClose }: { bom: Bom; onClose: () => void }) {
  const toast = useToast()
  const { maps } = useCollections(['materials', 'workCenters'] as const)
  const [draft, setDraft] = useState<Bom>(bom)
  const [saving, setSaving] = useState(false)
  const [machiningPart, setMachiningPart] = useState<string | null>(null)
  const set = <K extends keyof Bom>(k: K, v: Bom[K]) => setDraft((d) => ({ ...d, [k]: v }))
  const cost = useMemo(() => bomCost(draft, maps.materials, maps.workCenters), [draft, maps.materials, maps.workCenters])

  const updatePart = (id: string, patch: Partial<BomPart>) => set('parts', draft.parts.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const save = async () => {
    if (!draft.name.trim()) return toast.error('Informe o nome da ficha técnica.')
    setSaving(true)
    try {
      const { id, createdAt, updatedAt, code, ...data } = draft
      void createdAt
      void updatedAt
      void code
      if (id) await updateDoc('boms', id, data)
      else await createDoc('boms', data)
      toast.success('Ficha técnica salva.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  const sectionTitle = (t: string, action?: React.ReactNode) => (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 3, mb: 1 }}>
      <Typography variant="overline" color="primary">
        {t}
      </Typography>
      {action}
    </Stack>
  )

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xl">
      <DialogTitle>{bom.id ? `Ficha técnica · ${bom.code ?? ''}` : 'Nova ficha técnica'}</DialogTitle>
      <DialogContent>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 5 }}>
            <TextField label="Nome" value={draft.name} onChange={(e) => set('name', e.target.value)} required />
          </Grid>
          <Grid size={{ xs: 6, md: 3 }}>
            <TextField select label="Categoria" value={draft.category} onChange={(e) => set('category', e.target.value as Bom['category'])}>
              {BOM_CATEGORIES.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 2 }}>
            <NumberField label="Largura (mm)" value={draft.width} onChange={(v) => set('width', v ?? undefined)} />
          </Grid>
          <Grid size={{ xs: 2 }}>
            <NumberField label="Altura (mm)" value={draft.height} onChange={(v) => set('height', v ?? undefined)} />
          </Grid>
          <Grid size={{ xs: 12, md: 2 }}>
            <NumberField label="Profund. (mm)" value={draft.depth} onChange={(v) => set('depth', v ?? undefined)} />
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <RelationSelect collection="materials" label="Fita de borda padrão" value={draft.edgeMaterialId} onChange={(id) => set('edgeMaterialId', id ?? undefined)} filter={(m) => m.category === 'fita_borda' && m.active !== false} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <NumberField label="Preço de venda (R$)" adornment="R$" value={draft.salePrice} onChange={(v) => set('salePrice', v ?? undefined)} decimals={2} />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <TextField label="Descrição" value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </Grid>
        </Grid>

        {sectionTitle(
          `Peças (${draft.parts.reduce((s, p) => s + p.quantity, 0)})`,
          <Button size="small" startIcon={<AddIcon />} onClick={() => set('parts', [...draft.parts, { id: uid(), name: '', quantity: 1, length: 0, width: 0, grain: true }])}>
            Adicionar peça
          </Button>,
        )}
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 980 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1.6fr 70px 90px 90px 2fr 160px 60px 120px 40px', gap: 1, px: 0.5, pb: 0.5 }}>
              {['Peça', 'Qtd.', 'Comp. (mm)', 'Larg. (mm)', 'Material (chapa)', 'Fita (C1 C2 L1 L2)', 'Veio', 'Usinagens', ''].map((h) => (
                <Typography key={h} variant="overline" color="text.secondary">
                  {h}
                </Typography>
              ))}
            </Box>
            {draft.parts.map((p) => (
              <Box key={p.id} sx={{ display: 'grid', gridTemplateColumns: '1.6fr 70px 90px 90px 2fr 160px 60px 40px', gap: 1, alignItems: 'center', mb: 0.75 }}>
                <TextField value={p.name} placeholder="Ex.: Lateral" onChange={(e) => updatePart(p.id, { name: e.target.value })} />
                <NumberField value={p.quantity} min={1} decimals={0} onChange={(v) => updatePart(p.id, { quantity: v ?? 1 })} />
                <NumberField value={p.length} min={0} onChange={(v) => updatePart(p.id, { length: v ?? 0 })} />
                <NumberField value={p.width} min={0} onChange={(v) => updatePart(p.id, { width: v ?? 0 })} />
                <RelationSelect collection="materials" value={p.materialId} onChange={(id) => updatePart(p.id, { materialId: id ?? undefined })} filter={(m) => m.category === 'chapa' && m.active !== false} placeholder="Selecione a chapa" />
                <Stack direction="row" alignItems="center">
                  {(['edgeTop', 'edgeBottom', 'edgeLeft', 'edgeRight'] as const).map((k) => (
                    <Checkbox key={k} size="small" checked={Boolean(p[k])} onChange={(e) => updatePart(p.id, { [k]: e.target.checked })} sx={{ p: 0.5 }} />
                  ))}
                </Stack>
                <Checkbox size="small" checked={p.grain !== false} onChange={(e) => updatePart(p.id, { grain: e.target.checked })} sx={{ p: 0.5 }} />
                <Button size="small" variant={(p.machining?.length ?? 0) ? 'contained' : 'outlined'} color={(p.machining?.length ?? 0) ? 'primary' : 'inherit'} startIcon={<TuneIcon />} disabled={!(p.length > 0 && p.width > 0)} onClick={() => setMachiningPart(p.id)}>
                  {p.machining?.length ?? 0}
                </Button>
                <IconButton size="small" onClick={() => set('parts', draft.parts.filter((x) => x.id !== p.id))} aria-label="Remover peça">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
            {draft.parts.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                Nenhuma peça cadastrada. Adicione manualmente ou use “Gerar módulo paramétrico”.
              </Typography>
            ) : null}
          </Box>
        </Box>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            {sectionTitle(
              'Ferragens e insumos',
              <Button size="small" startIcon={<AddIcon />} onClick={() => set('hardware', [...draft.hardware, { id: uid(), description: '', quantity: 1 }])}>
                Adicionar
              </Button>,
            )}
            {draft.hardware.map((h) => (
              <Stack key={h.id} direction="row" spacing={1} sx={{ mb: 0.75 }} alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <RelationSelect
                    collection="materials"
                    value={h.materialId}
                    onChange={(id) =>
                      set('hardware', draft.hardware.map((x) => (x.id === h.id ? { ...x, materialId: id ?? undefined, description: id ? (maps.materials.get(id)?.name ?? '') : x.description } : x)))
                    }
                    filter={(m) => ['ferragem', 'insumo', 'outro'].includes(m.category) && m.active !== false}
                    placeholder="Selecione a ferragem"
                  />
                </Box>
                <Box sx={{ width: 90 }}>
                  <NumberField value={h.quantity} min={0} onChange={(v) => set('hardware', draft.hardware.map((x) => (x.id === h.id ? { ...x, quantity: v ?? 0 } : x)))} />
                </Box>
                <IconButton size="small" onClick={() => set('hardware', draft.hardware.filter((x) => x.id !== h.id))} aria-label="Remover ferragem">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            {sectionTitle(
              'Roteiro de produção',
              <Button size="small" startIcon={<AddIcon />} onClick={() => set('routing', [...draft.routing, { id: uid(), workCenterId: '', minutes: 10 }])}>
                Adicionar etapa
              </Button>,
            )}
            {draft.routing.map((r) => (
              <Stack key={r.id} direction="row" spacing={1} sx={{ mb: 0.75 }} alignItems="center">
                <Box sx={{ flex: 1 }}>
                  <RelationSelect collection="workCenters" value={r.workCenterId} onChange={(id) => set('routing', draft.routing.map((x) => (x.id === r.id ? { ...x, workCenterId: id ?? '' } : x)))} placeholder="Setor / máquina" />
                </Box>
                <Box sx={{ width: 110 }}>
                  <NumberField value={r.minutes} min={0} adornment="min" onChange={(v) => set('routing', draft.routing.map((x) => (x.id === r.id ? { ...x, minutes: v ?? 0 } : x)))} />
                </Box>
                <IconButton size="small" onClick={() => set('routing', draft.routing.filter((x) => x.id !== r.id))} aria-label="Remover etapa">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Grid>
        </Grid>

        <Paper variant="outlined" sx={{ mt: 3, p: 2, borderRadius: 3, bgcolor: colors.subtle }}>
          <Grid container spacing={2}>
            {[
              ['Chapas', cost.materials],
              ['Fita de borda', cost.edge],
              ['Ferragens', cost.hardware],
              ['Mão de obra / máquina', cost.labor],
            ].map(([label, value]) => (
              <Grid key={label as string} size={{ xs: 6, md: 2.4 }}>
                <Typography variant="overline" color="text.secondary">
                  {label as string}
                </Typography>
                <Typography variant="subtitle1">{brl(value as number)}</Typography>
              </Grid>
            ))}
            <Grid size={{ xs: 12, md: 2.4 }}>
              <Typography variant="overline" color="primary">
                Custo total
              </Typography>
              <Typography variant="h5" sx={{ color: colors.brand }}>
                {brl(cost.total)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {cost.areaM2.toFixed(2).replace('.', ',')} m² · {cost.edgeMeters.toFixed(1).replace('.', ',')} m de fita · {cost.minutes} min
              </Typography>
            </Grid>
          </Grid>
          {draft.salePrice ? (
            <Typography variant="caption" color="text.secondary">
              Margem bruta sobre o preço de venda: {round2(((draft.salePrice - cost.total) / draft.salePrice) * 100)}%
            </Typography>
          ) : null}
        </Paper>
      </DialogContent>
      {machiningPart && draft.parts.find((x) => x.id === machiningPart) ? (
        <MachiningDialog
          piece={{ ...draft.parts.find((x) => x.id === machiningPart)!, label: draft.parts.find((x) => x.id === machiningPart)!.name }}
          value={draft.parts.find((x) => x.id === machiningPart)!.machining ?? []}
          onClose={() => setMachiningPart(null)}
          onSave={(list) => updatePart(machiningPart, { machining: list })}
        />
      ) : null}
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? 'Salvando…' : 'Salvar ficha'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ------------------------------------------------------ gerador paramétrico
function Generator({ onClose, onCreate }: { onClose: () => void; onCreate: (b: Bom) => void }) {
  const { data } = useCollections(['workCenters'] as const)
  const [v, setV] = useState({
    name: '',
    category: 'balcao' as Bom['category'],
    width: 800,
    height: 720,
    depth: 560,
    thickness: 18,
    doors: 2,
    shelves: 1,
    drawers: 0,
    carcass: null as string | null,
    back: null as string | null,
    front: null as string | null,
    edge: null as string | null,
  })

  const generate = () => {
    const t = v.thickness
    const w = v.width
    const h = v.height
    const d = v.depth
    const edgeAll = { edgeTop: true, edgeBottom: true, edgeLeft: true, edgeRight: true }
    const lateralOps = [...shelfPinHoles(h, d, v.shelves), ...(v.back ? [{ ...newMachining('rasgo_fundo', 10, Math.max(d - 16, 10)), length: Math.max(h - 20, 10) }] : [])]
    const parts: BomPart[] = [
      { id: uid(), name: 'Lateral', quantity: 2, length: h, width: d, materialId: v.carcass ?? undefined, edgeTop: true, grain: true, machining: lateralOps },
      { id: uid(), name: 'Base', quantity: 1, length: w - 2 * t, width: d, materialId: v.carcass ?? undefined, edgeTop: true, grain: true },
    ]
    if (v.category === 'balcao') parts.push({ id: uid(), name: 'Travessa superior', quantity: 2, length: w - 2 * t, width: 100, materialId: v.carcass ?? undefined, edgeTop: true, grain: true })
    else parts.push({ id: uid(), name: 'Tampo', quantity: 1, length: w - 2 * t, width: d, materialId: v.carcass ?? undefined, edgeTop: true, grain: true })
    if (v.shelves > 0) parts.push({ id: uid(), name: 'Prateleira', quantity: v.shelves, length: w - 2 * t - 2, width: d - 20, materialId: v.carcass ?? undefined, edgeTop: true, grain: true })
    parts.push({ id: uid(), name: 'Fundo', quantity: 1, length: h - 10, width: w - 10, materialId: v.back ?? undefined, grain: false })
    if (v.doors > 0) parts.push({ id: uid(), name: 'Porta', quantity: v.doors, length: h - 4, width: Math.round(w / v.doors) - 4, materialId: v.front ?? undefined, ...edgeAll, grain: true, machining: hingeHoles(h - 4, Math.round(w / v.doors) - 4) })
    if (v.drawers > 0) {
      parts.push({ id: uid(), name: 'Frente de gaveta', quantity: v.drawers, length: w - 4, width: Math.round((h - 40) / v.drawers) - 4, materialId: v.front ?? undefined, ...edgeAll, grain: true })
      parts.push({ id: uid(), name: 'Lateral de gaveta', quantity: v.drawers * 2, length: d - 60, width: 120, materialId: v.carcass ?? undefined, edgeTop: true, grain: true })
      parts.push({ id: uid(), name: 'Fundo de gaveta', quantity: v.drawers, length: d - 60, width: w - 2 * t - 50, materialId: v.back ?? undefined, grain: false })
    }
    const minutes: Record<string, number> = { CORTE: 6 + parts.length, BORDA: 4 + parts.filter((p) => p.edgeTop).length * 1.5, CNC: 8 + v.doors * 2 + v.drawers * 4, MONT: 18 + v.doors * 4 + v.drawers * 12, EMB: 6 }
    const routing = data.workCenters
      .filter((wc) => minutes[wc.code])
      .sort((a, b) => a.order - b.order)
      .map((wc) => ({ id: uid(), workCenterId: wc.id, minutes: Math.round(minutes[wc.code]) }))
    const bom = {
      ...blank(),
      name: v.name || `${optLabel(BOM_CATEGORIES, v.category)} ${w}×${h}×${d}`,
      category: v.category,
      width: w,
      height: h,
      depth: d,
      parts,
      hardware: [],
      routing,
      edgeMaterialId: v.edge ?? undefined,
    } as Bom
    onCreate(bom)
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Gerar módulo paramétrico</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Informe as dimensões externas e a composição. O sistema calcula as peças da carcaça, fundo, portas e gavetas, e sugere o roteiro por setor — você revisa antes de salvar.
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 8 }}>
            <TextField label="Nome (opcional)" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <TextField select label="Tipo" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as Bom['category'] })}>
              {BOM_CATEGORIES.filter((c) => ['balcao', 'aereo', 'torre', 'roupeiro', 'gaveteiro'].includes(c.value)).map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          {(
            [
              ['width', 'Largura (mm)'],
              ['height', 'Altura (mm)'],
              ['depth', 'Profundidade (mm)'],
              ['thickness', 'Espessura (mm)'],
              ['doors', 'Portas'],
              ['shelves', 'Prateleiras'],
              ['drawers', 'Gavetas'],
            ] as const
          ).map(([k, label]) => (
            <Grid key={k} size={{ xs: 6, sm: 3 }}>
              <NumberField label={label} value={v[k]} min={0} decimals={0} onChange={(n) => setV({ ...v, [k]: n ?? 0 })} />
            </Grid>
          ))}
          <Grid size={12}>
            <RelationSelect collection="materials" label="Chapa da carcaça" value={v.carcass} onChange={(id) => setV({ ...v, carcass: id })} filter={(m) => m.category === 'chapa' && m.active !== false} />
          </Grid>
          <Grid size={12}>
            <RelationSelect collection="materials" label="Chapa do fundo" value={v.back} onChange={(id) => setV({ ...v, back: id })} filter={(m) => m.category === 'chapa' && m.active !== false} />
          </Grid>
          <Grid size={12}>
            <RelationSelect collection="materials" label="Chapa das frentes" value={v.front} onChange={(id) => setV({ ...v, front: id })} filter={(m) => m.category === 'chapa' && m.active !== false} />
          </Grid>
          <Grid size={12}>
            <RelationSelect collection="materials" label="Fita de borda" value={v.edge} onChange={(id) => setV({ ...v, edge: id })} filter={(m) => m.category === 'fita_borda' && m.active !== false} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={generate}>
          Gerar peças
        </Button>
      </DialogActions>
    </Dialog>
  )
}

