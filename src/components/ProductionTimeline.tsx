import { useNavigate } from 'react-router-dom'
import { Box, Button, Chip, Typography } from '@mui/material'
import { Stack } from './Stack'
import { CheckCircleIcon, PrecisionManufacturingIcon } from './icons'
import { ProgressLine } from './ui'
import { useCollections } from '../lib/store'
import { OP_STATUS, optColor, optLabel } from '../domain/constants'
import { fmtDateTime, fmtDuration } from '../lib/format'
import { colors } from '../theme'
import type { OpOperation, ProductionOrder } from '../types'

const STEP_LABEL: Record<string, string> = { pendente: 'Aguardando', em_andamento: 'Em andamento', pausada: 'Pausada', concluida: 'Concluída' }
const STEP_COLOR: Record<string, string> = { pendente: '#8b8f98', em_andamento: colors.brand, pausada: '#b9852e', concluida: '#2e7d4f' }

/** Percentual de avanço da ordem pelos minutos previstos de cada etapa (em andamento conta metade). */
export function orderProgress(order: Pick<ProductionOrder, 'operations' | 'status'>) {
  if (!order.operations?.length) return order.status === 'concluida' ? 100 : 0
  const weight = order.operations.reduce((s, o) => s + Math.max(o.plannedMinutes, 1), 0)
  const done = order.operations.reduce((s, o) => s + Math.max(o.plannedMinutes, 1) * (o.status === 'concluida' ? 1 : o.status === 'em_andamento' ? 0.5 : 0), 0)
  return Math.round((done / weight) * 100)
}

/**
 * Início e percurso da produção de uma ordem: etapas na sequência do roteiro, com quem fez,
 * quando começou/terminou e tempo previsto × real. A execução acontece no Chão de fábrica.
 */
export function ProductionTimeline({ order, workCenterName, compact = false }: { order: ProductionOrder; workCenterName: (id: string) => string; compact?: boolean }) {
  const navigate = useNavigate()
  const steps = [...(order.operations ?? [])].sort((a, b) => a.order - b.order)
  const planned = steps.reduce((s, o) => s + o.plannedMinutes * 60, 0)
  const actual = steps.reduce((s, o) => s + o.actualSeconds, 0)
  const firstStart = steps.map((o) => o.startedAt).filter(Boolean).sort()[0]
  const lastEnd = steps.every((o) => o.status === 'concluida') ? steps.map((o) => o.finishedAt).filter(Boolean).sort().at(-1) : undefined
  const currentIndex = steps.findIndex((o) => o.status !== 'concluida')

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.75, mb: 1 }}>
        <PrecisionManufacturingIcon sx={{ color: colors.brand }} fontSize="small" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {order.code} · {order.title}
        </Typography>
        <Chip size="small" label={optLabel(OP_STATUS, order.status)} sx={{ bgcolor: `${optColor(OP_STATUS, order.status)}22`, color: optColor(OP_STATUS, order.status), fontWeight: 600 }} />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={() => navigate(`/chao-de-fabrica?projeto=${order.projectId ?? ''}&op=${order.id}`)}>
          Abrir no Chão de fábrica
        </Button>
      </Stack>

      <ProgressLine value={orderProgress(order)} label={`${steps.filter((o) => o.status === 'concluida').length} de ${steps.length} etapas`} />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, mb: 1.5 }}>
        {firstStart ? `Início ${fmtDateTime(firstStart)}` : 'Produção ainda não iniciada'}
        {lastEnd ? ` · Fim ${fmtDateTime(lastEnd)}` : ''}
        {planned ? ` · Previsto ${fmtDuration(planned)} · Apontado ${fmtDuration(actual)}` : ''}
      </Typography>

      {steps.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Esta ordem ainda não tem etapas de roteiro. Cadastre o roteiro na ficha técnica para ela aparecer no Chão de fábrica.
        </Typography>
      ) : (
        <Box>
          {steps.map((op: OpOperation, index) => {
            const isCurrent = index === currentIndex
            const color = STEP_COLOR[op.status] ?? colors.textMuted
            return (
              <Stack key={op.id} direction="row" spacing={1.5} sx={{ position: 'relative', pb: index === steps.length - 1 ? 0 : 1.5 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22, flex: 'none' }}>
                  {op.status === 'concluida' ? (
                    <CheckCircleIcon sx={{ color, fontSize: 22 }} />
                  ) : (
                    <Box sx={{ width: 16, height: 16, mt: 0.25, borderRadius: '50%', border: `3px solid ${color}`, bgcolor: isCurrent ? color : '#fff' }} />
                  )}
                  {index < steps.length - 1 ? <Box sx={{ flex: 1, width: 2, bgcolor: op.status === 'concluida' ? color : colors.border, mt: 0.5 }} /> : null}
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {op.name || workCenterName(op.workCenterId)}
                    </Typography>
                    <Chip size="small" label={STEP_LABEL[op.status] ?? op.status} sx={{ height: 20, bgcolor: `${color}1f`, color, fontWeight: 600 }} />
                  </Stack>
                  {!compact ? (
                    <Typography variant="caption" color="text.secondary" component="div">
                      {workCenterName(op.workCenterId)}
                      {op.operatorName ? ` · ${op.operatorName}` : ''}
                      {op.startedAt ? ` · início ${fmtDateTime(op.startedAt)}` : ''}
                      {op.finishedAt ? ` · fim ${fmtDateTime(op.finishedAt)}` : ''}
                    </Typography>
                  ) : null}
                  <Typography variant="caption" color="text.secondary">
                    previsto {fmtDuration(op.plannedMinutes * 60)}
                    {op.actualSeconds ? ` · real ${fmtDuration(op.actualSeconds)}` : ''}
                  </Typography>
                </Box>
              </Stack>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

/** Busca a ordem e os setores sozinha: para telas que só têm o id da ordem (ex.: gaveta da tarefa). */
export function ProductionTimelineById({ orderId, compact }: { orderId: string; compact?: boolean }) {
  const { maps } = useCollections(['productionOrders', 'workCenters'] as const)
  const order = maps.productionOrders.get(orderId)
  if (!order) return null
  return <ProductionTimeline order={order} compact={compact} workCenterName={(id) => maps.workCenters.get(id)?.name ?? 'Setor'} />
}
