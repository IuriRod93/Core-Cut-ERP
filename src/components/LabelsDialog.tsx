import { useMemo, useState } from 'react'
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogTitle, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material'
import { Stack } from './Stack'
import { EmptyState, LoadingState, ProgressLine } from './ui'
import { CheckCircleIcon } from './icons'
import { useLabelUnits, type LabelUnit } from '../lib/planUnits'
import { colors } from '../theme'
import type { OpOperation, ProductionOrder } from '../types'

const MAX_ROWS = 300

/** A etapa aceita marcar peças: iniciada e ainda não concluída. */
const markable = (op: OpOperation) => Boolean(op.startedAt) && op.status !== 'concluida'

/**
 * Etiquetas das ordens (uma linha por unidade de peça) com uma coluna por etapa do roteiro. Tocar na
 * célula de uma etapa em andamento marca/desmarca aquela peça como feita: o roteiro avança aos poucos.
 */
export function LabelsDialog({
  orders,
  planIdsOf,
  focusOpId,
  title,
  onMark,
  onClose,
}: {
  orders: ProductionOrder[]
  planIdsOf: (order: ProductionOrder) => string[]
  focusOpId?: string
  title: string
  onMark: (order: ProductionOrder, op: OpOperation, keys: string[], done: boolean) => Promise<boolean>
  onClose: () => void
}) {
  // abre na ordem da etapa escolhida ou na primeira que tem etiquetas
  const [tab, setTab] = useState(() => Math.max(0, orders.findIndex((o) => (focusOpId ? o.operations.some((op) => op.id === focusOpId) : planIdsOf(o).length > 0))))
  const order = orders[Math.min(tab, orders.length - 1)]

  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        {title}
        <Typography variant="body2" color="text.secondary">
          Toque na etapa de uma peça para marcar como feita. Só etapas iniciadas aceitam marcação.
        </Typography>
      </DialogTitle>
      <DialogContent>
        {orders.length > 1 ? (
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ mb: 1.5 }}>
            {orders.map((o) => (
              <Tab key={o.id} label={`${o.code} · ${o.title}`} />
            ))}
          </Tabs>
        ) : null}
        {order ? <OrderLabels key={order.id} order={order} planIds={planIdsOf(order)} focusOpId={focusOpId} onMark={onMark} /> : <EmptyState title="Nenhuma ordem em produção" />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}

function OrderLabels({ order, planIds, focusOpId, onMark }: { order: ProductionOrder; planIds: string[]; focusOpId?: string; onMark: (order: ProductionOrder, op: OpOperation, keys: string[], done: boolean) => Promise<boolean> }) {
  const { units, error } = useLabelUnits(planIds)
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState(false)
  const ops = useMemo(() => [...order.operations].sort((a, b) => a.order - b.order), [order.operations])
  const doneSets = useMemo(() => new Map(ops.map((op) => [op.id, new Set(op.piecesDone ?? [])])), [ops])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = units ?? []
    return q ? all.filter((u) => [u.piece.label, u.piece.module, u.piece.environment, u.code].some((v) => v?.toLowerCase().includes(q))) : all
  }, [units, search])

  if (!planIds.length) return <EmptyState title="Sem plano de corte" description="Vincule um plano de corte à ordem para as etiquetas aparecerem aqui." />
  if (error) return <Typography color="error">{error}</Typography>
  if (!units) return <LoadingState label="Carregando etiquetas…" />
  if (!units.length) return <EmptyState title="O plano não tem peças" />

  const mark = async (op: OpOperation, keys: string[], done: boolean) => {
    if (!keys.length || pending) return
    setPending(true)
    try {
      await onMark(order, op, keys, done)
    } finally {
      setPending(false)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${Math.min(ops.length, 4)}, 1fr)` }, gap: 1.5, mb: 1.5 }}>
        {ops.map((op) => {
          const done = doneSets.get(op.id)?.size ?? 0
          const visibleOpen = rows.filter((u) => !doneSets.get(op.id)?.has(u.key)).map((u) => u.key)
          return (
            <Box key={op.id} sx={{ p: 1.25, borderRadius: 2, border: `1px solid ${op.id === focusOpId ? colors.brand : colors.border}` }}>
              <Typography variant="subtitle2" noWrap>
                {op.name}
              </Typography>
              <ProgressLine value={Math.round((done / units.length) * 100)} label={`${done}/${units.length} peças`} color={op.status === 'concluida' ? colors.success : colors.brand} />
              {markable(op) && visibleOpen.length ? (
                <Button size="small" disabled={pending} onClick={() => void mark(op, visibleOpen, true)} sx={{ mt: 0.5, ml: -0.75 }}>
                  Marcar {search ? 'as filtradas' : 'todas'} ({visibleOpen.length})
                </Button>
              ) : null}
            </Box>
          )
        })}
      </Box>

      <TextField size="small" fullWidth label="Buscar peça, módulo ou código da etiqueta" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 1 }} />
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', '& th, & td': { textAlign: 'left', p: 0.6, borderBottom: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap' } }}>
          <thead>
            <tr>
              <th>Etiqueta</th>
              <th>Medidas</th>
              {ops.map((op) => (
                <th key={op.id} style={{ textAlign: 'center', color: op.id === focusOpId ? colors.brand : undefined }}>
                  {op.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, MAX_ROWS).map((u: LabelUnit) => (
              <tr key={u.key}>
                <td>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {u.piece.label} · {u.n}/{u.piece.quantity}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[u.code, u.piece.module || u.piece.environment].filter(Boolean).join(' · ')}
                  </Typography>
                </td>
                <td>
                  {u.piece.length} × {u.piece.width}
                </td>
                {ops.map((op) => {
                  const isDone = doneSets.get(op.id)?.has(u.key) ?? false
                  const can = markable(op)
                  return (
                    <td key={op.id} style={{ textAlign: 'center' }}>
                      <Tooltip title={can ? (isDone ? 'Desmarcar' : 'Marcar como feita') : op.status === 'concluida' ? 'Etapa concluída' : 'Inicie a etapa para marcar'}>
                        <span>
                          <ButtonBase
                            disabled={!can || pending}
                            onClick={() => void mark(op, [u.key], !isDone)}
                            aria-label={`${u.piece.label} ${u.n} em ${op.name}`}
                            sx={{ width: 36, height: 36, borderRadius: '50%', border: `2px solid ${isDone ? colors.success : colors.border}`, bgcolor: isDone ? colors.success : 'transparent', color: '#fff', opacity: can || isDone ? 1 : 0.4 }}
                          >
                            {isDone ? <CheckCircleIcon fontSize="small" /> : null}
                          </ButtonBase>
                        </span>
                      </Tooltip>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </Box>
      </Box>
      {rows.length > MAX_ROWS ? (
        <Stack sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Mostrando {MAX_ROWS} de {rows.length}. Use a busca para achar a peça (os botões “Marcar” valem para as filtradas).
          </Typography>
        </Stack>
      ) : null}
    </Box>
  )
}
