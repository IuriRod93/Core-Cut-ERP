import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  LinearProgress,
  MenuItem,
  Pagination,
  Paper,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from '../components/Stack'
import {
  AddIcon,
  ArrowBackIcon,
  AutoAwesomeIcon,
  CloseIcon,
  ContentCutIcon,
  ContentPasteIcon,
  DeleteIcon,
  DownloadIcon,
  PictureAsPdfIcon,
  SaveIcon,
  TuneIcon,
  UploadFileIcon,
} from '../components/icons'
import { DataTable, EmptyState, LoadingState, PageHeader, Panel, SearchField, StatCard, StatusChip, UserAvatar, type Column } from '../components/ui'
import { NumberField, RelationSelect } from '../components/forms'
import { MaterialPicker } from '../components/MaterialPicker'
import { MachiningDialog } from '../components/MachiningDialog'
import { PromobImportDialog, type PromobApply } from '../components/PromobImportDialog'
import { PlanFlowPanel } from '../components/PlanFlowPanel'
import { api } from '../lib/api'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { createDoc, refreshCollection, removeDoc, updateDoc, useCollections, useCompany } from '../lib/store'
import { isGuillotine, planGroups, type OffcutSpec, type SheetSpec } from '../domain/cutting'
import { analyzeSheet, describeCut, usableLeftovers, type CutStep, type Leftover } from '../domain/cutSequence'
import { DEFAULT_GCODE, PLAN_STATUS, computeCosts, totalsOf } from '../domain/cutPlan'
import { generateGcode } from '../domain/gcode'
import { buildLabelsPdf, buildPlanPdf } from '../domain/cutPlanPdf'
import { logoPng } from '../domain/pdf'
import { countByMethod, edgeMetersOf, edgeSegments, methodLabel, pieceToSheet } from '../domain/machining'
import { makeZip } from '../lib/zip.mjs'
import { brl, downloadBlob, fmtDate, matches, num, round2, uid } from '../lib/format'
import { chartPalette, colors } from '../theme'
import type { CutPiece, CutPlan, CutPlanGroup, CutPlanStatus, GcodeParams, Machining } from '../types'

/** Linhas de peça desenhadas por vez: planos importados do Promob têm milhares de linhas e não cabem todas no DOM. */
const PIECES_PER_PAGE = 40

const emptyPiece = (): CutPiece => ({ id: uid(), label: '', length: 0, width: 0, quantity: 1, rotate: false })
const statusOpts = PLAN_STATUS.map((s) => ({ value: s.value, label: s.label, color: s.color }))

interface Draft {
  id?: string
  code?: string
  title: string
  status: CutPlanStatus
  projectId?: string
  productionOrderId?: string
  responsibleId?: string
  mode: 'seccionadora' | 'cnc'
  kerf: number
  trim: number
  defaultMaterialId?: string
  edgeMaterialId?: string
  pieces: CutPiece[]
  hardware: CutPlan['hardware']
  gcode: GcodeParams
  notes: string
  imports: NonNullable<CutPlan['imports']>
}

// -------------------------------------------------------------------------- SVG
function SheetSvg({
  group,
  sheetIndex,
  pieces,
  showHoles,
  showEdges,
  trim,
  cuts,
  leftovers,
  fit = false,
}: {
  group: CutPlanGroup
  sheetIndex: number
  pieces: Map<string, CutPiece>
  showHoles: boolean
  showEdges: boolean
  trim: number
  /** sequência de cortes da serra (linhas numeradas sobre o mapa) */
  cuts?: CutStep[]
  /** sobras aproveitáveis (hachuradas) */
  leftovers?: Leftover[]
  /** cabe na altura da tela (mapa compacto) em vez de ocupar a largura inteira */
  fit?: boolean
}) {
  const sheet = group.sheets[sheetIndex]
  const { sheetWidth: W, sheetHeight: H } = group
  const order = new Map<string, number>()
  sheet.placements.forEach((p) => !order.has(p.pieceId) && order.set(p.pieceId, order.size))
  const fs = Math.max(Math.min(W, H) / (fit ? 40 : 58), 11)
  return (
    <svg viewBox={`-20 ${-Math.round(fs * 1.7)} ${W + 40} ${H + Math.round(fs * 1.7) + 20}`} style={fit ? { height: 'min(540px, calc(100vh - 330px))', minHeight: 300, width: 'auto', maxWidth: '100%', display: 'block', margin: '0 auto', background: '#fff' } : { width: '100%', height: 'auto', display: 'block', background: '#fff' }} role="img" aria-label={`Chapa ${sheet.index}`}>
      <rect x={0} y={0} width={W} height={H} fill="#f4f1ec" stroke="#8c8279" strokeWidth={3} />
      <rect x={trim} y={trim} width={W - trim * 2} height={H - trim * 2} fill="none" stroke="#c9c1b8" strokeDasharray="14 10" strokeWidth={2} />
      {sheet.placements.map((pl, i) => {
        const color = chartPalette[(order.get(pl.pieceId) ?? 0) % chartPalette.length]
        const piece = pieces.get(pl.pieceId)
        const small = pl.w < fs * 5 || pl.h < fs * 2.4
        return (
          <g key={i}>
            <rect x={pl.x} y={pl.y} width={pl.w} height={pl.h} fill={color} fillOpacity={0.2} stroke={color} strokeWidth={2.2} />
            {showEdges && piece
              ? edgeSegments(piece).map(([x1, y1, x2, y2], k) => {
                  const a = pieceToSheet(pl, piece, x1, y1)
                  const b = pieceToSheet(pl, piece, x2, y2)
                  return <line key={k} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.brand} strokeWidth={7} />
                })
              : null}
            {showHoles && piece
              ? (piece.machining ?? []).map((m) => {
                  if (m.face !== 'topo') return null
                  if (m.kind === 'furo') {
                    const c = pieceToSheet(pl, piece, m.x, m.y)
                    return <circle key={m.id} cx={c.x} cy={c.y} r={Math.max((m.diameter ?? 5) / 2, 4)} fill="#fff" stroke={colors.text} strokeWidth={1.6} />
                  }
                  const a = pieceToSheet(pl, piece, m.x, m.y)
                  const b = pieceToSheet(pl, piece, m.x + (m.length ?? 0), m.y + (m.kind === 'recorte' ? (m.width ?? 0) : 0))
                  return <line key={m.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={colors.brand} strokeWidth={Math.max(m.width ?? 6, 5)} strokeOpacity={0.35} />
                })
              : null}
            {!small ? (
              <>
                <text x={pl.x + pl.w / 2} y={pl.y + pl.h / 2 - fs * 0.1} textAnchor="middle" fontSize={fs} fontWeight={700} fill="#1e1a19">
                  {pl.label.length > Math.floor(pl.w / (fs * 0.6)) ? `${pl.label.slice(0, Math.max(Math.floor(pl.w / (fs * 0.6)) - 1, 3))}…` : pl.label}
                </text>
                <text x={pl.x + pl.w / 2} y={pl.y + pl.h / 2 + fs * 1.15} textAnchor="middle" fontSize={fs * 0.88} fill="#4a4340">
                  {Math.round(pl.w)} × {Math.round(pl.h)}
                  {pl.rotated ? ' (girada)' : ''}
                </text>
              </>
            ) : null}
          </g>
        )
      })}
      {(leftovers ?? []).map((l, i) => (
        <g key={`s${i}`}>
          <rect x={l.x} y={l.y} width={l.w} height={l.h} fill="#2e7d4f" fillOpacity={0.1} stroke="#2e7d4f" strokeWidth={2} strokeDasharray="10 8" />
          {l.w > fs * 7 && l.h > fs * 2.6 ? (
            <text x={l.x + l.w / 2} y={l.y + l.h / 2 + fs * 0.35} textAnchor="middle" fontSize={fs * 0.95} fontWeight={700} fill="#2e7d4f">
              Sobra {Math.round(l.w)} × {Math.round(l.h)}
            </text>
          ) : null}
        </g>
      ))}
      {(cuts ?? []).map((c) => {
        const vertical = c.axis === 'vertical'
        const x1 = vertical ? c.at : c.from
        const y1 = vertical ? c.from : c.at
        const x2 = vertical ? c.at : c.to
        const y2 = vertical ? c.to : c.at
        const r = fs * 0.95
        return (
          <g key={`c${c.n}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1d4ed8" strokeWidth={3} strokeDasharray="22 10" />
            <circle cx={vertical ? x1 : x1 + r * 1.2} cy={vertical ? y1 + r * 1.2 : y1} r={r} fill="#1d4ed8" />
            <text x={vertical ? x1 : x1 + r * 1.2} y={(vertical ? y1 + r * 1.2 : y1) + fs * 0.34} textAnchor="middle" fontSize={fs * 0.9} fontWeight={700} fill="#fff">
              {c.n}
            </text>
          </g>
        )
      })}
      <text x={0} y={-fs * 0.45} fontSize={fs * 1.05} fill="#6a625d">
        {W} mm
      </text>
    </svg>
  )
}

// ----------------------------------------------------------------------- página
export function CutPlanPage() {
  const [params, setParams] = useSearchParams()
  const plano = params.get('plano')
  const [full, setFull] = useState<{ id: string; plan: CutPlan | null } | null>(null)
  // a listagem traz só o resumo do plano: o editor busca o plano completo (peças e mapas de corte)
  useEffect(() => {
    if (!plano || plano === 'novo') return
    let alive = true
    api
      .get<CutPlan>(`/data/cutPlans/${plano}`)
      .then((p) => alive && setFull({ id: plano, plan: p }))
      .catch(() => alive && setFull({ id: plano, plan: null }))
    return () => {
      alive = false
    }
  }, [plano])
  const plan = full?.id === plano ? full.plan : undefined
  const loading = Boolean(plano && plano !== 'novo' && full?.id !== plano)

  const open = (id: string) => {
    params.set('plano', id)
    setParams(params)
  }
  const back = () => {
    params.delete('plano')
    setParams(params)
  }

  if (plano === 'novo') return <PlanEditor key="novo" onBack={back} onSaved={open} />
  if (plano) {
    if (loading) return <LoadingState />
    if (!plan) return <EmptyState title="Plano não encontrado" action={<Button onClick={back}>Voltar aos planos</Button>} />
    return <PlanEditor key={plan.id} initial={plan} onBack={back} onSaved={open} />
  }
  return <PlanList onOpen={open} onNew={() => open('novo')} />
}

// ----------------------------------------------------------------------- lista
function PlanList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const confirm = useConfirm()
  const { data, maps, loading } = useCollections(['cutPlans', 'projects', 'users'] as const)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [project, setProject] = useState('')
  const [owner, setOwner] = useState('')

  const rows = data.cutPlans.filter(
    (p) =>
      (!status || p.status === status) &&
      (!project || p.projectId === project) &&
      (!owner || p.responsibleId === owner) &&
      matches([p.code, p.title, maps.projects.get(p.projectId ?? '')?.name], query),
  )
  // planos antigos (formato anterior) não possuem `groups`
  const sheets = (p: CutPlan) => p.sheetCount ?? (p.groups ?? []).reduce((s, g) => s + g.sheets.length, 0)

  const columns: Column<CutPlan>[] = [
    {
      key: 'code',
      header: 'Plano',
      sort: (p) => p.code,
      render: (p) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {p.code}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {p.title}
          </Typography>
          {p.pendingReview ? <Chip size="small" color="info" label="Aguardando revisão" sx={{ ml: 1, height: 20 }} /> : null}
        </Box>
      ),
    },
    { key: 'project', header: 'Projeto', sort: (p) => maps.projects.get(p.projectId ?? '')?.name, render: (p) => maps.projects.get(p.projectId ?? '')?.name ?? '—' },
    {
      key: 'owner',
      header: 'Responsável',
      hideBelow: 'md',
      sort: (p) => maps.users.get(p.responsibleId ?? '')?.name,
      render: (p) => {
        const u = maps.users.get(p.responsibleId ?? '')
        return u ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <UserAvatar user={u} size={26} />
            <span>{u.name}</span>
          </Stack>
        ) : (
          '—'
        )
      },
    },
    { key: 'mode', header: 'Método', hideBelow: 'lg', render: (p) => (p.mode === 'cnc' ? 'Router CNC' : 'Seccionadora') },
    { key: 'sheets', header: 'Chapas', align: 'right', sort: sheets, render: (p) => sheets(p) },
    { key: 'util', header: 'Aproveit.', align: 'right', hideBelow: 'md', sort: (p) => p.utilization, render: (p) => `${p.utilization ?? 0}%` },
    { key: 'cost', header: 'Custo total', align: 'right', sort: (p) => p.costs?.total, render: (p) => <strong>{brl(p.costs?.total)}</strong> },
    { key: 'status', header: 'Situação', sort: (p) => p.status, render: (p) => <StatusChip options={statusOpts} value={p.status} /> },
    { key: 'date', header: 'Criado', hideBelow: 'lg', sort: (p) => p.createdAt, render: (p) => fmtDate(p.createdAt) },
    {
      key: 'del',
      header: '',
      width: 52,
      align: 'right',
      render: (p) => (
        <IconButton
          size="small"
          aria-label="Excluir plano"
          onClick={async (e) => {
            e.stopPropagation()
            if (await confirm({ title: 'Excluir plano de corte?', message: p.code, confirmLabel: 'Excluir', danger: true })) await removeDoc('cutPlans', p.id)
          }}
        >
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ]

  if (loading && !data.cutPlans.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Plano de corte"
        subtitle="Otimização multi-material com fitagem, usinagens, custo em R$ pelo catálogo Leo Madeiras e geração de G-code por chapa — vinculado a projeto e responsável."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={onNew}>
            Novo plano de corte
          </Button>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Planos" value={data.cutPlans.length} icon={<ContentCutIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Em corte" value={data.cutPlans.filter((p) => p.status === 'em_corte').length} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Aproveitamento médio" value={data.cutPlans.length ? `${round2(data.cutPlans.reduce((s, p) => s + (p.utilization ?? 0), 0) / data.cutPlans.length)}%` : '—'} tone="success" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Custo total planejado" value={brl(data.cutPlans.reduce((s, p) => s + (p.costs?.total ?? 0), 0))} />
        </Grid>
      </Grid>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <SearchField value={query} onChange={setQuery} placeholder="Buscar plano ou projeto…" />
          <TextField select label="Projeto" value={project} onChange={(e) => setProject(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 230 } }}>
            <MenuItem value="">Todos</MenuItem>
            {data.projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 200 } }}>
            <MenuItem value="">Todos</MenuItem>
            {data.users
              .filter((u) => u.active !== false)
              .map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name}
                </MenuItem>
              ))}
          </TextField>
          <TextField select label="Situação" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 160 } }}>
            <MenuItem value="">Todas</MenuItem>
            {PLAN_STATUS.map((s) => (
              <MenuItem key={s.value} value={s.value}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {rows.length === 0 ? (
          <EmptyState
            icon={<ContentCutIcon />}
            title="Nenhum plano de corte"
            description="Crie um plano vinculado a um projeto, informe peças com fitas e usinagens e gere o G-code por chapa."
            action={
              <Button variant="contained" startIcon={<AddIcon />} onClick={onNew}>
                Novo plano de corte
              </Button>
            }
          />
        ) : (
          <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} onRowClick={(p) => onOpen(p.id)} initialSort={{ key: 'code', dir: 'desc' }} />
        )}
      </Paper>
    </Box>
  )
}

// --------------------------------------------------------------------- editor
function PlanEditor({ initial, onBack, onSaved }: { initial?: CutPlan; onBack: () => void; onSaved: (id: string) => void }) {
  const toast = useToast()
  const company = useCompany()
  const { user } = useAuth()
  const { data, maps } = useCollections(['materials', 'projects', 'clients', 'users', 'productionOrders', 'boms', 'workCenters', 'offcuts'] as const)

  const [d, setD] = useState<Draft>(() =>
    initial
      ? {
          id: initial.id,
          code: initial.code,
          title: initial.title,
          status: initial.status,
          projectId: initial.projectId,
          productionOrderId: initial.productionOrderId,
          responsibleId: initial.responsibleId,
          mode: initial.mode ?? 'seccionadora',
          kerf: initial.kerf ?? 3,
          trim: initial.trim ?? 10,
          defaultMaterialId: initial.defaultMaterialId,
          edgeMaterialId: initial.edgeMaterialId,
          pieces: initial.pieces?.length ? initial.pieces : [emptyPiece()],
          hardware: initial.hardware ?? [],
          gcode: { ...DEFAULT_GCODE, ...(initial.gcode ?? {}) },
          notes: initial.notes ?? '',
          imports: initial.imports ?? [],
        }
      : { title: '', status: 'rascunho', responsibleId: user?.id, mode: 'seccionadora', kerf: 3, trim: 10, pieces: [emptyPiece()], hardware: [], gcode: DEFAULT_GCODE, notes: '', imports: [] },
  )
  const [result, setResult] = useState<{ groups: CutPlanGroup[]; unresolved: CutPiece[] } | null>(initial?.groups?.length ? { groups: initial.groups, unresolved: [] } : null)
  const [stale, setStale] = useState(false)
  const [tab, setTab] = useState(initial?.groups?.length ? 1 : 0)
  const [saving, setSaving] = useState(false)
  const [paste, setPaste] = useState(false)
  const [promob, setPromob] = useState(false)
  const [labelLayout, setLabelLayout] = useState<'completa' | 'compacta'>('completa')
  const [pasteText, setPasteText] = useState('')
  const [machining, setMachining] = useState<string | null>(null)
  const [importOp, setImportOp] = useState<string | null>(null)
  const [importBom, setImportBom] = useState<{ id: string | null; qty: number | null }>({ id: null, qty: 1 })
  const [groupKey, setGroupKey] = useState<string | null>(initial?.groups?.[0]?.key ?? null)
  const [sheetIdx, setSheetIdx] = useState(0)
  const [showHoles, setShowHoles] = useState(true)
  const [showEdges, setShowEdges] = useState(true)
  const [pieceQuery, setPieceQuery] = useState('')
  const [labelProgress, setLabelProgress] = useState<{ done: number; total: number } | null>(null)
  const labelAbort = useRef<AbortController | null>(null)
  const [piecePage, setPiecePage] = useState(0)
  const [useOffcuts, setUseOffcuts] = useState(true)
  const [showCuts, setShowCuts] = useState(true)
  const [showLeftovers, setShowLeftovers] = useState(true)
  const [mapFit, setMapFit] = useState<'ajustado' | 'ampliado'>('ajustado')
  const [savedLeftovers, setSavedLeftovers] = useState<Set<string>>(new Set())

  const set =<K extends keyof Draft>(k: K, v: Draft[K], layout = false) => {
    setD((s) => ({ ...s, [k]: v }))
    if (layout && result) setStale(true)
  }
  const setPieces = (fn: (l: CutPiece[]) => CutPiece[]) => {
    setD((s) => ({ ...s, pieces: fn(s.pieces) }))
    if (result) setStale(true)
  }
  const patchPiece = (id: string, patch: Partial<CutPiece>) => setPieces((l) => l.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const pieceTerm = pieceQuery.trim().toLowerCase()
  const listedPieces = useMemo(
    () => (pieceTerm ? d.pieces.filter((p) => `${p.label} ${p.module ?? ''}`.toLowerCase().includes(pieceTerm)) : d.pieces),
    [d.pieces, pieceTerm],
  )
  const piecePages = Math.max(1, Math.ceil(listedPieces.length / PIECES_PER_PAGE))
  const pageIndex = Math.min(piecePage, piecePages - 1)
  const pageItems = useMemo(() => listedPieces.slice(pageIndex * PIECES_PER_PAGE, (pageIndex + 1) * PIECES_PER_PAGE), [listedPieces, pageIndex])

  // planos calculados antes do corte de ponta a ponta podem ter chapas que a seccionadora não executa
  const nonGuillotineSheets = useMemo(() => {
    if (!result || d.mode !== 'seccionadora') return 0
    let count = 0
    for (const g of result.groups) for (const sheet of g.sheets) if (!isGuillotine(sheet.placements.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })), d.kerf + 0.5)) count += 1
    return count
  }, [result, d.mode, d.kerf])

  const validPieces = useMemo(() => d.pieces.filter((p) => p.length > 0 && p.width > 0 && p.quantity > 0), [d.pieces])
  const pieceMap = useMemo(() => new Map(d.pieces.map((p) => [p.id, p])), [d.pieces])
  const totals = useMemo(() => totalsOf(validPieces), [validPieces])
  const project = maps.projects.get(d.projectId ?? '')
  const client = maps.clients.get(project?.clientId ?? '')
  const responsible = maps.users.get(d.responsibleId ?? '')
  const edgeMat = maps.materials.get(d.edgeMaterialId ?? '')

  const costs = useMemo(
    () =>
      result
        ? computeCosts({ pieces: validPieces, groups: result.groups, hardware: d.hardware, mode: d.mode, edgeMaterialId: d.edgeMaterialId, gcode: d.gcode }, maps.materials, data.workCenters)
        : null,
    [result, validPieces, d.hardware, d.mode, d.edgeMaterialId, d.gcode, maps.materials, data.workCenters],
  )

  const resolve = (p: CutPiece): SheetSpec | null => {
    const m = maps.materials.get(p.materialId ?? d.defaultMaterialId ?? '')
    if (!m || !m.sheetWidth || !m.sheetHeight) return null
    return { key: m.id, materialId: m.id, materialName: m.name, thickness: m.thickness ?? 0, sheetWidth: m.sheetWidth, sheetHeight: m.sheetHeight, sheetCost: m.cost }
  }

  // retalhos livres + os que este plano já tinha reservado (recalcular não pode "perdê-los")
  const availableOffcuts = useMemo<OffcutSpec[]>(
    () =>
      data.offcuts
        .filter((o) => o.status === 'disponivel' || (o.status === 'reservado' && o.usedInPlanId === d.id))
        .map((o) => ({ id: o.id, code: o.code, materialId: o.materialId, thickness: o.thickness, width: o.width, height: o.height })),
    [data.offcuts, d.id],
  )

  const calculate = () => {
    if (!validPieces.length) return toast.error('Adicione ao menos uma peça com medidas e quantidade.')
    // seccionadora: só cortes de ponta a ponta (o mapa precisa ser executável na serra); CNC pode encaixar livremente
    const r = planGroups(validPieces, resolve, d.kerf, d.trim, { guillotine: d.mode === 'seccionadora', offcuts: useOffcuts ? availableOffcuts : [] })
    if (!r.groups.length) return toast.error('Defina a chapa padrão (ou o material de cada peça) para calcular.')
    setResult(r)
    setStale(false)
    setGroupKey(r.groups[0].key)
    setSheetIdx(0)
    setTab(1)
    const fromStock = r.groups.filter((g) => g.offcutId).length
    const sheets = r.groups.reduce((s, g) => s + (g.offcutId ? 0 : g.sheets.length), 0)
    if (r.unresolved.length) toast.warning(`${r.unresolved.length} peça(s) sem chapa definida ficaram de fora.`)
    else toast.success(`${sheets} chapa(s) em ${r.groups.length - fromStock} material(is)${fromStock ? ` e ${fromStock} retalho(s) do estoque reaproveitado(s)` : ''}.`)
  }

  const changeMode = (mode: 'seccionadora' | 'cnc') => {
    setD((s) => ({ ...s, mode, kerf: mode === 'cnc' ? Math.max(s.kerf, s.gcode.toolDiameter + 1) : s.kerf > 6 ? 3 : s.kerf }))
    if (result) setStale(true)
  }

  // ------------------------------------------------------------- importações
  const withNewIds = (list: Machining[] | undefined) => (list ?? []).map((m) => ({ ...m, id: uid() }))
  const piecesFromBom = (bomId: string, qty: number, prefix?: string): CutPiece[] => {
    const bom = maps.boms.get(bomId)
    if (!bom) return []
    return bom.parts.map((p) => ({
      id: uid(),
      label: `${prefix ?? bom.name} · ${p.name}`,
      module: prefix ?? bom.name,
      length: p.length,
      width: p.width,
      quantity: p.quantity * qty,
      rotate: p.grain === false,
      materialId: p.materialId,
      edgeTop: p.edgeTop,
      edgeBottom: p.edgeBottom,
      edgeLeft: p.edgeLeft,
      edgeRight: p.edgeRight,
      machining: withNewIds(p.machining),
    }))
  }
  const applyImport = (list: CutPiece[], edge?: string) => {
    if (!list.length) return toast.warning('Nenhuma peça encontrada para importar.')
    setPieces((l) => [...l.filter((p) => p.length > 0 || p.label), ...list])
    if (edge && !d.edgeMaterialId) set('edgeMaterialId', edge)
    toast.success(`${list.length} linhas de peças importadas.`)
  }
  const importFromOp = (id: string | null) => {
    setImportOp(id)
    const op = id ? maps.productionOrders.get(id) : undefined
    if (!op) return
    const list = op.items.flatMap((it) => (it.bomId ? piecesFromBom(it.bomId, it.quantity, it.name) : []))
    setD((s) => ({ ...s, productionOrderId: op.id, projectId: s.projectId ?? op.projectId, title: s.title || `Plano ${op.code}` }))
    const edge = op.items.map((it) => (it.bomId ? maps.boms.get(it.bomId)?.edgeMaterialId : undefined)).find(Boolean)
    applyImport(list, edge)
  }
  const importFromBom = () => {
    if (!importBom.id) return
    const bom = maps.boms.get(importBom.id)
    applyImport(piecesFromBom(importBom.id, importBom.qty ?? 1), bom?.edgeMaterialId)
  }

  const applyPaste = () => {
    const parsed = pasteText
      .split(/\r?\n/)
      .map((l) => l.split(/[;\t]/).map((c) => c.trim()))
      .filter((c) => c.length >= 3)
      .map((c) => {
        const hasLabel = Number.isNaN(Number(c[0].replace(',', '.')))
        const [label, l, w, q, e] = hasLabel ? [c[0], c[1], c[2], c[3], c[4]] : ['Peça', c[0], c[1], c[2], c[3]]
        const tags = (e ?? '').toUpperCase()
        const all = /TODAS|4/.test(tags)
        return {
          id: uid(),
          label,
          length: num(l),
          width: num(w),
          quantity: Math.max(Math.round(num(q) || 1), 1),
          rotate: false,
          edgeTop: all || /C1/.test(tags),
          edgeBottom: all || /C2/.test(tags),
          edgeLeft: all || /L1/.test(tags),
          edgeRight: all || /L2/.test(tags),
        } as CutPiece
      })
      .filter((p) => p.length > 0 && p.width > 0)
    if (!parsed.length) return toast.error('Nenhuma linha válida. Use: nome ; comprimento ; largura ; quantidade ; fitas (opcional)')
    setPieces((l) => [...l.filter((p) => p.length > 0 || p.label), ...parsed])
    setPaste(false)
    setPasteText('')
    toast.success(`${parsed.length} peças importadas.`)
  }

  const applyPromob = (r: PromobApply) => {
    setD((s) => ({
      ...s,
      pieces: r.replace ? r.pieces : [...s.pieces.filter((p) => p.length > 0 || p.label), ...r.pieces],
      hardware: [...(r.replace ? [] : s.hardware), ...r.hardware],
      edgeMaterialId: s.edgeMaterialId ?? r.edgeMaterialId,
      defaultMaterialId: s.defaultMaterialId ?? r.defaultMaterialId,
      title: s.title || (r.info.client ? `Plano — ${r.info.client}` : s.title),
      imports: [...s.imports, ...r.imports],
    }))
    if (result) setStale(true)
    setPromob(false)
  }

  // --------------------------------------------------------------- salvar
  const save = async () => {
    if (!d.title.trim()) return toast.error('Informe o título do plano.')
    if (!d.projectId) return toast.error('Vincule o plano a um projeto.')
    if (!result || !costs) return toast.error('Calcule o plano antes de salvar.')
    setSaving(true)
    try {
      const payload = {
        title: d.title.trim(),
        status: d.status,
        projectId: d.projectId,
        productionOrderId: d.productionOrderId,
        responsibleId: d.responsibleId,
        mode: d.mode,
        kerf: d.kerf,
        trim: d.trim,
        defaultMaterialId: d.defaultMaterialId,
        edgeMaterialId: d.edgeMaterialId,
        pieces: validPieces,
        hardware: d.hardware,
        groups: result.groups,
        costs,
        utilization: round2(result.groups.reduce((s, g) => s + g.utilization, 0) / Math.max(result.groups.length, 1)),
        gcode: d.gcode,
        notes: d.notes,
        imports: d.imports,
        pendingReview: false,
      } as Partial<CutPlan>
      let id = d.id
      if (id) await updateDoc('cutPlans', id, payload)
      else {
        const created = await createDoc('cutPlans', payload)
        id = created.id
        setD((s) => ({ ...s, id: created.id, code: created.code }))
      }
      if (d.productionOrderId) {
        const op = maps.productionOrders.get(d.productionOrderId)
        if (op) {
          const cutPlanIds = [...new Set([...(op.cutPlanIds ?? []), id])]
          const items = op.items?.length
            ? op.items
            : validPieces.map((piece) => ({
                id: piece.id,
                name: piece.label || piece.module || 'Peça do plano de corte',
                quantity: piece.quantity,
                notes: `${piece.length} × ${piece.width} mm${piece.materialId ? ` · ${maps.materials.get(piece.materialId)?.name ?? 'material'}` : ''}`,
              }))
          await updateDoc('productionOrders', op.id, { cutPlanIds, items })
        }
      }
      toast.success('Plano de corte salvo.')
      setStale(false)
      // soma o custo do plano ao orçamento do projeto (não bloqueia o salvamento)
      try {
        const sync = await api.post<{ budget: { code?: string }; created: boolean; cost: number }>(`/cut-plans/${id}/sync-budget`, {})
        await refreshCollection('budgets')
        toast.info(`${brl(sync.cost)} somados ao orçamento ${sync.budget.code ?? ''} do projeto.`)
      } catch {
        /* sem permissão ou sem projeto: o painel "Orçamento e compras" permite repetir manualmente */
      }
      if (!d.id) onSaved(id)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  const exportPdf = async () => {
    if (!result || !costs) return toast.error('Calcule o plano antes de exportar.')
    let logo: Awaited<ReturnType<typeof logoPng>> | undefined
    try {
      logo = await logoPng(240, company)
    } catch {
      logo = undefined
    }
    const blob = buildPlanPdf({
      logo,
      notes: d.notes,
      sources: d.imports.map((i) => i.fileName),
      code: d.code,
      title: d.title || 'Plano de corte',
      projectName: project?.name,
      clientName: client?.name,
      responsibleName: responsible?.name,
      mode: d.mode,
      kerf: d.kerf,
      trim: d.trim,
      groups: result.groups,
      pieces: validPieces,
      costs,
      hardware: d.hardware,
      edgeName: edgeMat?.name,
    })
    downloadBlob(blob, `${(d.code ?? 'plano-de-corte').toLowerCase()}.pdf`)
  }

  const exportLabels = async () => {
    if (!result) return toast.error('Calcule o plano para gerar as etiquetas.')
    const names = new Map(data.materials.map((m) => [m.id, m.name]))
    let logo: Awaited<ReturnType<typeof logoPng>> | undefined
    try {
      logo = await logoPng(200, company)
    } catch {
      logo = undefined
    }
    const abort = new AbortController()
    labelAbort.current = abort
    setLabelProgress({ done: 0, total: piecesCount })
    let blob: Blob
    try {
      blob = await buildLabelsPdf({
      signal: abort.signal,
      onProgress: (done, total) => setLabelProgress({ done, total }),
      logo,
      baseUrl: window.location.origin,
      planId: d.id,
      layout: labelLayout,
      clientName: client?.name,
      responsibleName: responsible?.name,
      code: d.code,
      projectName: project?.name,
      groups: result.groups,
      pieces: validPieces,
      defaultMaterialName: maps.materials.get(d.defaultMaterialId ?? '')?.name,
      materialNames: names,
      })
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(e instanceof Error ? e.message : 'Não foi possível gerar as etiquetas.')
      return
    } finally {
      labelAbort.current = null
      setLabelProgress(null)
    }
    downloadBlob(blob, `etiquetas-${(d.code ?? 'plano').toLowerCase()}.pdf`)
  }

  // ---------------------------------------------------------------- render
  const group = result?.groups.find((g) => g.key === groupKey) ?? result?.groups[0]
  const safeSheet = group ? Math.min(sheetIdx, Math.max(group.sheets.length - 1, 0)) : 0
  const piecesCount = validPieces.reduce((s, p) => s + p.quantity, 0)
  const machiningPiece = machining ? pieceMap.get(machining) : undefined

  // ordem dos cortes da serra e sobras da chapa que está na tela
  const sheetAnalysis = useMemo(() => {
    const sheet = group?.sheets[safeSheet]
    if (!group || !sheet) return null
    const t = group.offcutId ? 0 : d.trim
    return analyzeSheet(sheet.placements, { x: t, y: t, w: group.sheetWidth - t * 2, h: group.sheetHeight - t * 2 }, d.kerf)
  }, [group, safeSheet, d.trim, d.kerf])
  const leftoverList = useMemo(() => (sheetAnalysis?.guillotine ? usableLeftovers(sheetAnalysis.leftovers) : []), [sheetAnalysis])
  const leftoverKey = (l: Leftover) => `${group?.key}:${group?.sheets[safeSheet]?.index}:${l.x}:${l.y}`
  const saveLeftovers = async (list: Leftover[]) => {
    if (!group) return
    const sheet = group.sheets[safeSheet]
    const fresh = list.filter((l) => !savedLeftovers.has(leftoverKey(l)))
    if (!fresh.length) return toast.info('Estas sobras já foram guardadas no estoque.')
    try {
      for (const l of fresh) {
        await createDoc('offcuts', {
          materialId: group.materialId,
          materialName: group.materialName.replace(/\s·\sretalho.*$/, ''),
          thickness: group.thickness || undefined,
          width: Math.round(l.w),
          height: Math.round(l.h),
          status: 'disponivel',
          sourcePlanId: d.id,
          sourceSheet: sheet?.index,
          projectId: d.projectId,
        } as never)
      }
      setSavedLeftovers((s) => new Set([...s, ...fresh.map(leftoverKey)]))
      await refreshCollection('offcuts')
      toast.success(`${fresh.length} retalho(s) guardado(s) no estoque.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível guardar os retalhos.')
    }
  }

  const gcodeCtx = { title: d.title, code: d.code, projectName: project?.name, responsibleName: responsible?.name, mode: d.mode, kerf: d.kerf }
  const gcodePreview = useMemo(() => {
    if (!group || !group.sheets[safeSheet]) return null
    return generateGcode(gcodeCtx, group, safeSheet, validPieces, d.gcode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group, safeSheet, validPieces, d.gcode, d.mode, d.kerf, d.title, d.code, project?.name, responsible?.name])

  const downloadAllGcode = () => {
    if (!result) return
    const files: { name: string; content: string }[] = []
    for (const g of result.groups)
      g.sheets.forEach((_, i) => {
        const out = generateGcode(gcodeCtx, g, i, validPieces, d.gcode)
        files.push({ name: out.filename, content: out.code })
      })
    downloadBlob(makeZip(files), `${(d.code ?? 'plano').toLowerCase()}-gcode.zip`)
  }

  const addSuggestedHardware = () => {
    const counts = countByMethod(validPieces)
    const rows: CutPlan['hardware'] = []
    const add = (method: Machining['method'], description: string, divisor = 1) => {
      const c = counts.get(method)
      if (c && !d.hardware.some((h) => h.description === description)) rows.push({ id: uid(), description, quantity: Math.ceil(c / divisor), unitCost: 0 })
    }
    add('dobradica_35', 'Dobradiça caneco 35 mm')
    add('minifix_15', 'Minifix (tambor + parafuso)')
    add('cavilha_8', 'Cavilha 8 mm')
    add('confirmat_5', 'Parafuso confirmat 5 × 50')
    add('puxador_5', 'Puxador', 2)
    add('pino_5', 'Pino de prateleira')
    if (!rows.length) toast.info('Nenhuma usinagem sugere ferragens novas.')
    else setD((s) => ({ ...s, hardware: [...s.hardware, ...rows] }))
  }

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Button size="small" color="inherit" startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ color: 'text.secondary' }}>
          Planos de corte
        </Button>
        {d.code ? (
          <Typography variant="caption" color="text.secondary">
            {d.code}
          </Typography>
        ) : null}
      </Stack>
      <PageHeader
        title={d.id ? d.title || 'Plano de corte' : 'Novo plano de corte'}
        subtitle="Peças, fitas e usinagens → otimização por material → custo em R$ → G-code por chapa."
        actions={
          <>
            <Button variant="outlined" color="inherit" startIcon={<PictureAsPdfIcon />} onClick={exportPdf} disabled={!result}>
              Relatório PDF
            </Button>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving || !result}>
              {saving ? 'Salvando…' : 'Salvar plano'}
            </Button>
          </>
        }
      />

      <Panel title="Dados do plano" sx={{ mb: 2.5 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 5 }}>
            <TextField label="Título do plano" value={d.title} onChange={(e) => set('title', e.target.value)} required placeholder="Ex.: Cozinha Silva — carcaças e frentes" />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <RelationSelect
              collection="projects"
              label="Projeto"
              value={d.projectId}
              required
              onChange={(id) => {
                const projectId = id ?? undefined
                const projectOrders = projectId ? data.productionOrders.filter((order) => order.projectId === projectId && order.status !== 'cancelada') : []
                setD((current) => ({
                  ...current,
                  projectId,
                  productionOrderId: projectOrders.length === 1 ? projectOrders[0].id : projectId === current.projectId ? current.productionOrderId : undefined,
                }))
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 3 }}>
            <RelationSelect collection="users" label="Responsável pelo plano" value={d.responsibleId} onChange={(id) => set('responsibleId', id ?? undefined)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <RelationSelect
              collection="productionOrders"
              label="Ordem de produção (opcional)"
              value={d.productionOrderId}
              onChange={(id) => set('productionOrderId', id ?? undefined)}
              filter={(o) => !d.projectId || o.projectId === d.projectId}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <MaterialPicker label="Chapa padrão" category="chapa" value={d.defaultMaterialId} onChange={(id) => set('defaultMaterialId', id ?? undefined, true)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <MaterialPicker label="Fita de borda padrão" category="fita_borda" value={d.edgeMaterialId} onChange={(id) => set('edgeMaterialId', id ?? undefined)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Método de corte
            </Typography>
            <ToggleButtonGroup size="small" exclusive fullWidth value={d.mode} onChange={(_, v) => v && changeMode(v)}>
              <ToggleButton value="seccionadora">Seccionadora</ToggleButton>
              <ToggleButton value="cnc">Router CNC</ToggleButton>
            </ToggleButtonGroup>
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <NumberField label={d.mode === 'cnc' ? 'Folga entre peças (mm)' : 'Disco de corte (mm)'} value={d.kerf} min={0} onChange={(v) => set('kerf', v ?? 0, true)} />
          </Grid>
          <Grid size={{ xs: 6, md: 2 }}>
            <NumberField label="Refilo (mm)" value={d.trim} min={0} onChange={(v) => set('trim', v ?? 0, true)} />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField select label="Situação" value={d.status} onChange={(e) => set('status', e.target.value as CutPlanStatus)}>
              {PLAN_STATUS.map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minHeight: 40 }}>
              {responsible ? <UserAvatar user={responsible} size={36} ring /> : null}
              <Typography variant="body2" color="text.secondary">
                {responsible ? `Responsável: ${responsible.name}` : 'Defina o responsável'}
              </Typography>
            </Stack>
          </Grid>
        </Grid>
      </Panel>

      {initial?.pendingReview ? (
        <Alert severity="info" sx={{ mb: 2 }}>
          Plano criado automaticamente de um arquivo anexado a uma tarefa do projeto. Confira as chapas e fitas de cada material, depois calcule e salve para liberar o plano.
        </Alert>
      ) : null}

      {nonGuillotineSheets > 0 && !stale ? (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={calculate}>
              Recalcular
            </Button>
          }
        >
          {nonGuillotineSheets} chapa(s) deste mapa têm encaixes que a seccionadora não consegue cortar de ponta a ponta. Recalcule: o novo cálculo só gera cortes executáveis na serra.
        </Alert>
      ) : null}

      {stale ? (
        <Alert
          severity="warning"
          sx={{ mb: 2 }}
          action={
            <Button color="inherit" size="small" onClick={calculate}>
              Recalcular
            </Button>
          }
        >
          O plano foi alterado depois do último cálculo. Recalcule para atualizar mapas, custos e G-code.
        </Alert>
      ) : null}

      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2, borderBottom: `1px solid ${colors.border}` }}>
        <Tab label={`Peças (${piecesCount})`} />
        <Tab label="Mapa de corte" />
        <Tab label="Custos e ferragens" />
        <Tab label="G-code" />
        <Tab label="Etiquetas" />
      </Tabs>

      {/* ------------------------------------------------------------ PEÇAS */}
      {tab === 0 ? (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Button size="small" variant="contained" startIcon={<UploadFileIcon />} onClick={() => setPromob(true)}>
                Importar do Promob
              </Button>
              <Button size="small" startIcon={<ContentPasteIcon />} onClick={() => setPaste(true)}>
                Colar lista
              </Button>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => {
                  setPieces((l) => [...l, emptyPiece()])
                  setPieceQuery('')
                  setPiecePage(Number.MAX_SAFE_INTEGER)
                }}
              >
                Peça
              </Button>
              <Box sx={{ width: 280 }}>
                <RelationSelect collection="productionOrders" label="Importar peças de uma OP" value={importOp} onChange={importFromOp} filter={(o) => o.status !== 'cancelada'} />
              </Box>
              <Box sx={{ width: 260 }}>
                <RelationSelect collection="boms" label="Importar de uma ficha técnica" value={importBom.id} onChange={(id) => setImportBom((s) => ({ ...s, id }))} />
              </Box>
              <Box sx={{ width: 84 }}>
                <NumberField label="Qtd." value={importBom.qty} min={1} decimals={0} onChange={(v) => setImportBom((s) => ({ ...s, qty: v }))} />
              </Box>
              <Button size="small" variant="outlined" disabled={!importBom.id} onClick={importFromBom}>
                Importar
              </Button>
              <Box sx={{ flex: 1 }} />
              <Button size="small" color="inherit" onClick={() => setPieces((l) => l.map((p) => ({ ...p, edgeTop: true, edgeBottom: true, edgeLeft: true, edgeRight: true })))}>
                Fitar 4 lados em todas
              </Button>
              <Button size="small" color="inherit" onClick={() => setPieces((l) => l.map((p) => ({ ...p, edgeTop: false, edgeBottom: false, edgeLeft: false, edgeRight: false })))}>
                Limpar fitas
              </Button>
            </Stack>
          </Paper>

          {d.pieces.length > PIECES_PER_PAGE || pieceTerm ? (
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <SearchField
                value={pieceQuery}
                onChange={(v) => {
                  setPieceQuery(v)
                  setPiecePage(0)
                }}
                placeholder="Buscar peça ou módulo…"
                width={300}
              />
              <Typography variant="body2" color="text.secondary">
                {listedPieces.length
                  ? `Linhas ${pageIndex * PIECES_PER_PAGE + 1}–${Math.min((pageIndex + 1) * PIECES_PER_PAGE, listedPieces.length)} de ${listedPieces.length}${pieceTerm ? ' encontradas' : ''}`
                  : 'Nenhuma peça encontrada'}
              </Typography>
              <Box sx={{ flex: 1 }} />
              {piecePages > 1 ? <Pagination count={piecePages} page={pageIndex + 1} onChange={(_, v) => setPiecePage(v - 1)} size="small" color="primary" siblingCount={1} boundaryCount={1} /> : null}
            </Stack>
          ) : null}

          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'auto' }}>
            <Box sx={{ minWidth: 1100, p: 2 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) minmax(240px, 1.7fr) 84px 84px 64px 56px 176px 128px 32px', gap: 1, pb: 0.5 }}>
                {['Peça', 'Chapa (vazio = padrão)', 'Comp.', 'Larg.', 'Qtd.', 'Girar', 'Fitas (C1 C2 L1 L2)', 'Usinagens', ''].map((h) => (
                  <Typography key={h} variant="overline" color="text.secondary">
                    {h}
                  </Typography>
                ))}
              </Box>
              {pageItems.map((p) => {
                const ops = p.machining?.length ?? 0
                return (
                  <Box key={p.id} sx={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1.4fr) minmax(240px, 1.7fr) 84px 84px 64px 56px 176px 128px 32px', gap: 1, mb: 0.75, alignItems: 'center' }}>
                    <TextField value={p.label} placeholder="Nome da peça" onChange={(e) => patchPiece(p.id, { label: e.target.value })} />
                    <MaterialPicker category="chapa" value={p.materialId} placeholder="Padrão do plano" onChange={(id) => patchPiece(p.id, { materialId: id ?? undefined })} />
                    <NumberField value={p.length || null} min={0} onChange={(v) => patchPiece(p.id, { length: v ?? 0 })} />
                    <NumberField value={p.width || null} min={0} onChange={(v) => patchPiece(p.id, { width: v ?? 0 })} />
                    <NumberField value={p.quantity} min={1} decimals={0} onChange={(v) => patchPiece(p.id, { quantity: v ?? 1 })} />
                    <Checkbox checked={p.rotate} onChange={(e) => patchPiece(p.id, { rotate: e.target.checked })} size="small" />
                    <Stack direction="row" spacing={0.5}>
                      {(
                        [
                          ['edgeTop', 'C1', 'Fita na aresta superior do comprimento'],
                          ['edgeBottom', 'C2', 'Fita na aresta inferior do comprimento'],
                          ['edgeLeft', 'L1', 'Fita na aresta esquerda da largura'],
                          ['edgeRight', 'L2', 'Fita na aresta direita da largura'],
                        ] as const
                      ).map(([k, label, tip]) => (
                        <Tooltip key={k} title={tip}>
                          <Chip
                            size="small"
                            label={label}
                            onClick={() => patchPiece(p.id, { [k]: !p[k] })}
                            sx={{
                              height: 28,
                              minWidth: 38,
                              fontWeight: 700,
                              bgcolor: p[k] ? colors.brand : '#fff',
                              color: p[k] ? '#fff' : colors.textSecondary,
                              border: `1px solid ${p[k] ? colors.brand : colors.borderStrong}`,
                              '&:hover': { bgcolor: p[k] ? colors.brandDark : colors.brandTint },
                            }}
                          />
                        </Tooltip>
                      ))}
                    </Stack>
                    <Button
                      size="small"
                      variant={ops ? 'contained' : 'outlined'}
                      color={ops ? 'primary' : 'inherit'}
                      startIcon={<TuneIcon />}
                      onClick={() => setMachining(p.id)}
                      disabled={!(p.length > 0 && p.width > 0)}
                    >
                      {ops ? `${ops} ${ops > 1 ? 'usinagens' : 'usinagem'}` : 'Usinagens'}
                    </Button>
                    <IconButton size="small" onClick={() => setPieces((l) => (l.length > 1 ? l.filter((x) => x.id !== p.id) : [emptyPiece()]))} aria-label="Remover peça">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )
              })}
            </Box>
          </Paper>

          <Grid container spacing={2}>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatCard label="Peças" value={piecesCount} hint={`${validPieces.length} linha(s)`} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatCard label="Fita de borda" value={`${totals.edgeMeters.toFixed(1).replace('.', ',')} m`} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatCard label="Furos" value={totals.holes} />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <StatCard label="Rasgos e recortes" value={totals.grooves} />
            </Grid>
          </Grid>

          {availableOffcuts.length ? (
            <FormControlLabel
              control={<Checkbox checked={useOffcuts} onChange={(e) => { setUseOffcuts(e.target.checked); if (result) setStale(true) }} />}
              label={`Usar retalhos do estoque (${availableOffcuts.length} ${availableOffcuts.length === 1 ? 'disponível' : 'disponíveis'}) antes de abrir chapa nova`}
            />
          ) : null}
          <Button fullWidth variant="contained" size="large" startIcon={<ContentCutIcon />} onClick={calculate}>
            Calcular plano de corte
          </Button>
          <Typography variant="caption" color="text.secondary">
            “Girar” permite rotacionar a peça 90° (materiais sem veio). Peças com chapa diferente da padrão são otimizadas em grupos separados. Coordenadas de usinagem partem do canto inferior esquerdo da peça; C1 = aresta superior do comprimento, C2 = inferior, L1 = esquerda, L2 = direita.
          </Typography>
        </Stack>
      ) : null}

      {/* ------------------------------------------------------------ MAPA */}
      {tab === 1 ? (
        !result || !group ? (
          <Paper variant="outlined" sx={{ borderRadius: 3 }}>
            <EmptyState
              icon={<ContentCutIcon />}
              title="Nenhum plano calculado"
              description="Informe as peças e clique em “Calcular plano de corte”."
              action={
                <Button variant="contained" onClick={calculate}>
                  Calcular agora
                </Button>
              }
            />
          </Paper>
        ) : (
          <Stack spacing={2.5}>
            <Grid container spacing={2}>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard
                  label="Chapas"
                  value={result.groups.reduce((s, g) => s + (g.offcutId ? 0 : g.sheets.length), 0)}
                  tone="brand"
                  hint={`${result.groups.filter((g) => !g.offcutId).length} material(is)${result.groups.some((g) => g.offcutId) ? ` + ${result.groups.filter((g) => g.offcutId).length} retalho(s)` : ''}`}
                />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard label="Aproveitamento (grupo)" value={`${group.utilization}%`} tone={group.utilization >= 80 ? 'success' : group.utilization >= 65 ? 'warning' : 'error'} />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard label="Custo de chapas" value={brl(costs?.sheets)} />
              </Grid>
              <Grid size={{ xs: 6, md: 3 }}>
                <StatCard label="Custo total do plano" value={brl(costs?.total)} tone="brand" />
              </Grid>
            </Grid>
            {result.unresolved.length ? (
              <Alert severity="error">
                Peças sem chapa definida (ou chapa sem dimensões): {result.unresolved.slice(0, 5).map((u) => u.label || 'sem nome').join(', ')}
                {result.unresolved.length > 5 ? '…' : ''}
              </Alert>
            ) : null}
            {group.unplaced.length ? (
              <Alert severity="error">Peças maiores que a área útil da chapa: {group.unplaced.slice(0, 5).map((u) => `${u.label} (${u.length}×${u.width})`).join(', ')}</Alert>
            ) : null}
            <Panel
              padded={false}
              title={group.materialName}
              subtitle={`${group.sheetWidth} × ${group.sheetHeight} mm${group.thickness ? ` · ${group.thickness} mm` : ''} · ${group.offcutId ? 'retalho do estoque, sem custo' : `${brl(group.sheetCost)} por chapa`}`}
              actions={
                <>
                  <FormControlLabel control={<Checkbox size="small" checked={showEdges} onChange={(e) => setShowEdges(e.target.checked)} />} label={<Typography variant="caption">Fitas</Typography>} />
                  <FormControlLabel control={<Checkbox size="small" checked={showHoles} onChange={(e) => setShowHoles(e.target.checked)} />} label={<Typography variant="caption">Usinagens</Typography>} />
                  <FormControlLabel control={<Checkbox size="small" checked={showCuts} onChange={(e) => setShowCuts(e.target.checked)} />} label={<Typography variant="caption">Ordem dos cortes</Typography>} />
                  <FormControlLabel control={<Checkbox size="small" checked={showLeftovers} onChange={(e) => setShowLeftovers(e.target.checked)} />} label={<Typography variant="caption">Sobras</Typography>} />
                </>
              }
            >
              {result.groups.length > 1 ? (
                <Stack direction="row" spacing={1} sx={{ p: 1.5, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
                  {result.groups.map((g) => (
                    <Chip
                      key={g.key}
                      label={`${g.thickness ? `${g.thickness} mm · ` : ''}${g.materialName.replace(/^MDF\s+/i, '').slice(0, 30)} · ${g.offcutId ? 'retalho' : `${g.sheets.length} ch.`}`}
                      onClick={() => {
                        setGroupKey(g.key)
                        setSheetIdx(0)
                      }}
                      color={g.key === group.key ? 'primary' : 'default'}
                      variant={g.key === group.key ? 'filled' : 'outlined'}
                    />
                  ))}
                </Stack>
              ) : null}
              <Tabs value={safeSheet} onChange={(_, v) => setSheetIdx(v)} variant="scrollable" scrollButtons="auto" sx={{ px: 1, borderBottom: `1px solid ${colors.border}` }}>
                {group.sheets.map((s, i) => (
                  <Tab key={s.index} value={i} label={`Chapa ${s.index} · ${s.utilization}%`} />
                ))}
              </Tabs>
              {group.sheets[safeSheet] ? (
                <Box sx={{ p: 2 }}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
                    <Typography variant="body2" color="text.secondary">
                      Chapa {group.sheets[safeSheet].index} · {group.sheetWidth} × {group.sheetHeight} mm · aproveitamento {group.sheets[safeSheet].utilization}%
                    </Typography>
                    <ToggleButtonGroup size="small" exclusive value={mapFit} onChange={(_, v) => v && setMapFit(v)} aria-label="Tamanho do mapa">
                      <ToggleButton value="ajustado">Ajustado à tela</ToggleButton>
                      <ToggleButton value="ampliado">Ampliado</ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                  <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 2, bgcolor: '#fff', p: { xs: 0.5, sm: 1.5 }, overflow: 'auto', mb: 1 }}>
                    <SheetSvg
                      group={group}
                      sheetIndex={safeSheet}
                      pieces={pieceMap}
                      showEdges={showEdges}
                      showHoles={showHoles}
                      trim={group.offcutId ? 0 : d.trim}
                      cuts={showCuts && d.mode === 'seccionadora' && sheetAnalysis?.guillotine ? sheetAnalysis.steps : undefined}
                      leftovers={showLeftovers && sheetAnalysis?.guillotine ? leftoverList : undefined}
                      fit={mapFit === 'ajustado'}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {group.sheets[safeSheet].placements.length} peças · área usada {round2(group.sheets[safeSheet].usedArea / 1_000_000)} m² · tracejado = refilo · linhas vinho = fita de borda · círculos = furos · azul = ordem dos cortes · verde = sobra aproveitável
                  </Typography>
                  {sheetAnalysis?.guillotine ? (
                    <Grid container spacing={2} sx={{ mt: 1 }}>
                      {d.mode === 'seccionadora' ? (
                        <Grid size={{ xs: 12, md: 7 }}>
                          <Typography variant="overline" color="primary">
                            Sequência de cortes na serra ({sheetAnalysis.steps.length})
                          </Typography>
                          <Box component="ol" sx={{ m: 0, pl: 3, maxHeight: 220, overflow: 'auto', fontSize: 13, columnGap: 3, columnCount: { xs: 1, sm: 2 } }}>
                            {sheetAnalysis.steps.map((c) => (
                              <li key={c.n}>{describeCut(c)}</li>
                            ))}
                          </Box>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                            Siga a ordem numerada: cada corte atravessa a faixa inteira. As posições são medidas a partir do canto superior esquerdo da chapa, no centro do disco.
                          </Typography>
                        </Grid>
                      ) : null}
                      <Grid size={{ xs: 12, md: d.mode === 'seccionadora' ? 5 : 12 }}>
                        <Typography variant="overline" color="primary">
                          Sobras aproveitáveis ({leftoverList.length})
                        </Typography>
                        {leftoverList.length === 0 ? (
                          <Typography variant="body2" color="text.secondary">
                            Nenhuma sobra grande o bastante (mínimo 250 mm de lado e 0,1 m²) nesta chapa.
                          </Typography>
                        ) : (
                          <Stack spacing={0.75}>
                            {leftoverList.map((l) => {
                              const saved = savedLeftovers.has(leftoverKey(l))
                              return (
                                <Stack key={leftoverKey(l)} direction="row" spacing={1} alignItems="center">
                                  <Typography variant="body2" sx={{ flex: 1 }}>
                                    {Math.round(l.w)} × {Math.round(l.h)} mm · {round2(l.area / 1_000_000)} m²
                                  </Typography>
                                  <Button size="small" variant={saved ? 'text' : 'outlined'} disabled={saved} onClick={() => saveLeftovers([l])}>
                                    {saved ? 'Guardado' : 'Guardar'}
                                  </Button>
                                </Stack>
                              )
                            })}
                            {leftoverList.length > 1 ? (
                              <Box>
                                <Button size="small" onClick={() => saveLeftovers(leftoverList)}>
                                  Guardar todas no estoque
                                </Button>
                              </Box>
                            ) : null}
                          </Stack>
                        )}
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          Guarde depois de cortar a chapa. Os próximos planos do mesmo material usam o retalho antes de abrir chapa nova.
                        </Typography>
                      </Grid>
                    </Grid>
                  ) : d.mode === 'seccionadora' ? null : (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                      A sequência de cortes e as sobras aparecem no modo seccionadora (cortes de ponta a ponta).
                    </Typography>
                  )}
                </Box>
              ) : null}
            </Panel>
          </Stack>
        )
      ) : null}

      {/* ------------------------------------------------------------ CUSTOS */}
      {tab === 2 ? (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 7 }}>
            <Panel
              title="Ferragens do plano"
              subtitle="Escolha no estoque ou direto do catálogo Leo Madeiras (preços em R$)"
              actions={
                <>
                  <Button size="small" startIcon={<AutoAwesomeIcon />} onClick={addSuggestedHardware}>
                    Sugerir pela usinagem
                  </Button>
                  <Button size="small" startIcon={<AddIcon />} onClick={() => setD((s) => ({ ...s, hardware: [...s.hardware, { id: uid(), description: '', quantity: 1, unitCost: 0 }] }))}>
                    Item
                  </Button>
                </>
              }
            >
              {d.hardware.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nenhuma ferragem. Use “Sugerir pela usinagem” para listar dobradiças, minifix e pinos conforme os furos das peças.
                </Typography>
              ) : (
                d.hardware.map((h) => (
                  <Stack key={h.id} direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 1 }}>
                    <Box sx={{ flex: 1.6 }}>
                      <MaterialPicker
                        category="ferragem"
                        value={h.materialId}
                        placeholder={h.description || 'Selecione a ferragem'}
                        onChange={(id) => {
                          const m = id ? maps.materials.get(id) : undefined
                          setD((s) => ({ ...s, hardware: s.hardware.map((x) => (x.id === h.id ? { ...x, materialId: id ?? undefined, description: m?.name ?? x.description, unitCost: m?.cost ?? x.unitCost } : x)) }))
                        }}
                      />
                      {h.description ? (
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                          {h.description}
                        </Typography>
                      ) : null}
                    </Box>
                    <Box sx={{ width: 90 }}>
                      <NumberField value={h.quantity} min={0} decimals={0} onChange={(v) => setD((s) => ({ ...s, hardware: s.hardware.map((x) => (x.id === h.id ? { ...x, quantity: v ?? 0 } : x)) }))} />
                    </Box>
                    <Box sx={{ width: 130 }}>
                      <NumberField value={h.unitCost} adornment="R$" min={0} decimals={2} onChange={(v) => setD((s) => ({ ...s, hardware: s.hardware.map((x) => (x.id === h.id ? { ...x, unitCost: v ?? 0 } : x)) }))} />
                    </Box>
                    <IconButton size="small" onClick={() => setD((s) => ({ ...s, hardware: s.hardware.filter((x) => x.id !== h.id) }))} aria-label="Remover ferragem">
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))
              )}
            </Panel>
          </Grid>
          <Grid size={{ xs: 12, lg: 5 }}>
            <Stack spacing={2.5}>
            <Panel title="Composição do custo">
              {!costs ? (
                <Typography variant="body2" color="text.secondary">
                  Calcule o plano para ver os custos.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {result?.groups.map((g) => (
                    <Stack key={g.key} direction="row" justifyContent="space-between">
                      <Typography variant="body2" sx={{ pr: 1 }}>
                        {g.sheets.length} × {g.materialName.slice(0, 44)}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {brl(g.cost)}
                      </Typography>
                    </Stack>
                  ))}
                  {(
                    [
                      [`Fita de borda · ${costs.edgeMeters.toFixed(1).replace('.', ',')} m (+10% perda)${edgeMat ? '' : ' — defina a fita padrão'}`, costs.edge],
                      ['Ferragens', costs.hardware],
                      [`Usinagem, corte e fitagem · ${costs.minutes} min`, costs.machining],
                    ] as [string, number][]
                  ).map(([k, v]) => (
                    <Stack key={k} direction="row" justifyContent="space-between">
                      <Typography variant="body2" sx={{ pr: 1 }}>
                        {k}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {brl(v)}
                      </Typography>
                    </Stack>
                  ))}
                  <Box sx={{ borderTop: `1px solid ${colors.borderStrong}`, pt: 1.5, mt: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography variant="subtitle1">Custo total</Typography>
                      <Typography variant="h4" sx={{ color: colors.brand }}>
                        {brl(costs.total)}
                      </Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {piecesCount ? `${brl(costs.total / piecesCount)} por peça` : ''}
                    </Typography>
                  </Box>
                </Stack>
              )}
            </Panel>
            {result && costs ? (
              <PlanFlowPanel
                saved={Boolean(d.id) && !stale}
                plan={{ id: d.id, code: d.code, title: d.title, projectId: d.projectId, groups: result.groups, hardware: d.hardware, costs, edgeMaterialId: d.edgeMaterialId }}
              />
            ) : null}
            </Stack>
          </Grid>
        </Grid>
      ) : null}

      {/* ------------------------------------------------------------ G-CODE */}
      {tab === 3 ? (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, lg: 4 }}>
            <Panel title="Parâmetros de usinagem" subtitle="Padrão ISO (Mach3, Syntec, Weihong e similares)">
              <Grid container spacing={1.5}>
                {(
                  [
                    ['toolDiameter', 'Fresa Ø (mm)'],
                    ['spindleRpm', 'Rotação (rpm)'],
                    ['feedCut', 'Avanço de corte (mm/min)'],
                    ['feedPlunge', 'Avanço de mergulho'],
                    ['feedDrill', 'Avanço de furação'],
                    ['safeZ', 'Z de segurança (mm)'],
                    ['passDepth', 'Profundidade por passe'],
                    ['overcut', 'Sobrecorte (mm)'],
                    ['peck', 'Passo de furação (mm)'],
                  ] as [keyof GcodeParams, string][]
                ).map(([k, label]) => (
                  <Grid key={k} size={6}>
                    <NumberField label={label} value={d.gcode[k] as number} min={0} onChange={(v) => set('gcode', { ...d.gcode, [k]: v ?? 0 })} />
                  </Grid>
                ))}
                <Grid size={6}>
                  <TextField select label="Troca de ferramenta" value={d.gcode.toolChange} onChange={(e) => set('gcode', { ...d.gcode, toolChange: e.target.value as 'm6' | 'm0' })}>
                    <MenuItem value="m6">Automática (T M6)</MenuItem>
                    <MenuItem value="m0">Manual (pausa M0)</MenuItem>
                  </TextField>
                </Grid>
                <Grid size={6}>
                  <FormControlLabel control={<Checkbox checked={d.gcode.tabs} onChange={(e) => set('gcode', { ...d.gcode, tabs: e.target.checked })} />} label="Pontes de fixação" />
                </Grid>
                {d.gcode.tabs ? (
                  <>
                    <Grid size={6}>
                      <NumberField label="Largura da ponte" value={d.gcode.tabWidth} min={0} onChange={(v) => set('gcode', { ...d.gcode, tabWidth: v ?? 0 })} />
                    </Grid>
                    <Grid size={6}>
                      <NumberField label="Altura da ponte" value={d.gcode.tabHeight} min={0} onChange={(v) => set('gcode', { ...d.gcode, tabHeight: v ?? 0 })} />
                    </Grid>
                  </>
                ) : null}
              </Grid>
              <Alert severity="info" sx={{ mt: 2 }}>
                Ordem do programa: furações por diâmetro → rasgos e recortes → contornos. Origem X0 Y0 no canto inferior esquerdo da chapa e Z0 na face superior. Valide o pós-processador na sua máquina antes de produzir.
              </Alert>
            </Panel>
          </Grid>
          <Grid size={{ xs: 12, lg: 8 }}>
            {!result || !group ? (
              <Paper variant="outlined" sx={{ borderRadius: 3 }}>
                <EmptyState icon={<ContentCutIcon />} title="Calcule o plano primeiro" description="O G-code é gerado por chapa a partir do mapa de corte." />
              </Paper>
            ) : (
              <Panel
                title="Programa da chapa"
                actions={
                  <>
                    <Button
                      size="small"
                      startIcon={<DownloadIcon />}
                      disabled={!gcodePreview}
                      onClick={() => gcodePreview && downloadBlob(new Blob([gcodePreview.code], { type: 'text/plain;charset=us-ascii' }), gcodePreview.filename)}
                    >
                      Baixar chapa (.nc)
                    </Button>
                    <Button size="small" variant="contained" startIcon={<DownloadIcon />} onClick={downloadAllGcode}>
                      Todas (.zip)
                    </Button>
                  </>
                }
              >
                <Stack direction="row" spacing={1.5} sx={{ mb: 2, flexWrap: 'wrap' }}>
                  <TextField
                    select
                    label="Material"
                    value={group.key}
                    onChange={(e) => {
                      setGroupKey(e.target.value)
                      setSheetIdx(0)
                    }}
                    sx={{ width: { xs: 'calc(50% - 6px)', sm: 300 } }}
                  >
                    {result.groups.map((g) => (
                      <MenuItem key={g.key} value={g.key}>
                        {g.materialName.slice(0, 50)}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField select label="Chapa" value={safeSheet} onChange={(e) => setSheetIdx(Number(e.target.value))} sx={{ width: { xs: 'calc(50% - 6px)', sm: 140 } }}>
                    {group.sheets.map((s, i) => (
                      <MenuItem key={s.index} value={i}>
                        Chapa {s.index}
                      </MenuItem>
                    ))}
                  </TextField>
                </Stack>
                {gcodePreview ? (
                  <>
                    {gcodePreview.warnings.map((w) => (
                      <Alert key={w} severity="warning" sx={{ mb: 1 }}>
                        {w}
                      </Alert>
                    ))}
                    <Stack direction="row" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }}>
                      <Chip size="small" label={`${gcodePreview.holes} furos`} />
                      <Chip size="small" label={`${gcodePreview.grooves} rasgos/recortes`} />
                      <Chip size="small" label={`${gcodePreview.contours} contornos`} />
                      <Chip size="small" label={`≈ ${gcodePreview.minutes} min de máquina`} color="primary" variant="outlined" />
                      {gcodePreview.tools.map((t) => (
                        <Chip key={t.name} size="small" variant="outlined" label={`${t.name}: ${t.uses}`} />
                      ))}
                    </Stack>
                    <Box
                      component="pre"
                      sx={{ m: 0, p: 2, maxHeight: 460, overflow: 'auto', bgcolor: '#1e1a19', color: '#e9e3dc', borderRadius: 2, fontSize: 12, lineHeight: 1.55, fontFamily: '"Cascadia Mono", Consolas, monospace' }}
                    >
                      {gcodePreview.code}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {gcodePreview.code.split('\n').length} linhas · {gcodePreview.filename}
                    </Typography>
                  </>
                ) : null}
              </Panel>
            )}
          </Grid>
        </Grid>
      ) : null}

      {/* ----------------------------------------------------------- ETIQUETAS */}
      {tab === 4 ? (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
          <Typography variant="h5" sx={{ mb: 0.5 }}>
            Etiquetas de peças
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 640 }}>
            Uma etiqueta adesiva por unidade com a logo, o <strong>QR Code</strong> (abre o plano na peça), projeto, medidas, material, fitas e usinagens. No layout completo cada etiqueta traz o
            desenho da peça com furos, rasgos e fitas e a <strong>miniatura da chapa otimizada</strong> com a posição do corte.
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <ToggleButtonGroup size="small" exclusive value={labelLayout} onChange={(_, v) => v && setLabelLayout(v)}>
              <ToggleButton value="completa">Completa · 2 × 4 por folha</ToggleButton>
              <ToggleButton value="compacta">Compacta · 3 × 8 por folha</ToggleButton>
            </ToggleButtonGroup>
            <Button variant="contained" startIcon={<PictureAsPdfIcon />} onClick={exportLabels} disabled={!result || Boolean(labelProgress)}>
              {labelProgress ? 'Gerando…' : `Gerar etiquetas (${piecesCount})`}
            </Button>
            {labelProgress ? (
              <Button color="inherit" onClick={() => labelAbort.current?.abort()}>
                Cancelar
              </Button>
            ) : null}
            {!result ? (
              <Typography variant="caption" color="text.secondary">
                Calcule o plano para habilitar.
              </Typography>
            ) : null}
          </Stack>
          {labelProgress ? (
            <Box sx={{ mt: 2, maxWidth: 520 }}>
              <LinearProgress variant="determinate" value={labelProgress.total ? (labelProgress.done / labelProgress.total) * 100 : 0} />
              <Typography variant="caption" color="text.secondary">
                Etiqueta {labelProgress.done.toLocaleString('pt-BR')} de {labelProgress.total.toLocaleString('pt-BR')} — você pode continuar usando o sistema.
              </Typography>
            </Box>
          ) : null}
          <Box sx={{ mt: 3, display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            {validPieces.slice(0, 6).map((p) => (
              <Box key={p.id} sx={{ border: `1px solid ${colors.borderStrong}`, borderLeft: `5px solid ${colors.brand}`, borderRadius: 1.5, p: 1.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {d.code ?? 'PLC'} · {project?.name ?? ''}
                </Typography>
                <Typography variant="subtitle2" sx={{ color: colors.brand }}>
                  {p.label || 'Peça'}
                </Typography>
                <Typography variant="h6">
                  {p.length} × {p.width}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Fita: {[p.edgeTop && 'C1', p.edgeBottom && 'C2', p.edgeLeft && 'L1', p.edgeRight && 'L2'].filter(Boolean).join(' ') || '—'}
                  {(p.machining ?? []).length ? ` · ${(p.machining ?? []).slice(0, 2).map((m) => methodLabel(m.method)).join(', ')}` : ''}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', color: alpha(colors.text, 0.6) }}>
                  {edgeMetersOf(p) ? `${edgeMetersOf(p).toFixed(2).replace('.', ',')} m de fita` : ''}
                </Typography>
              </Box>
            ))}
          </Box>
        </Paper>
      ) : null}

      {/* ------------------------------------------------------------ DIÁLOGOS */}
      {machiningPiece ? (
        <MachiningDialog piece={machiningPiece} value={machiningPiece.machining ?? []} onClose={() => setMachining(null)} onSave={(list) => patchPiece(machiningPiece.id, { machining: list })} />
      ) : null}

      {promob ? <PromobImportDialog hasPieces={validPieces.length > 0} onClose={() => setPromob(false)} onApply={applyPromob} /> : null}

      <Dialog open={paste} onClose={() => setPaste(false)} fullWidth maxWidth="sm">
        <DialogTitle>Colar lista de peças</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Uma peça por linha, separada por ponto e vírgula ou tabulação (copie do Excel): <strong>nome ; comprimento ; largura ; quantidade ; fitas</strong>. Nome e fitas são opcionais; em fitas use C1, C2, L1, L2 ou “todas”.
          </Typography>
          <TextField multiline minRows={8} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'Lateral;720;560;2;C1\nPorta;716;396;2;todas\n600;300;4'} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setPaste(false)}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={applyPaste}>
            Importar peças
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
