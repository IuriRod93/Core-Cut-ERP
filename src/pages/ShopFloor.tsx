import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { CheckCircleIcon, PauseIcon, PlayArrowIcon, PrecisionManufacturingIcon, WarningAmberIcon } from '../components/icons'
import { Dot, EmptyState, LoadingState, PageHeader, ProgressLine } from '../components/ui'
import { orderProgress } from '../components/ProductionTimeline'
import { NumberField } from '../components/forms'
import { useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { createDoc, getCollectionSnapshot, updateDoc, useCollections } from '../lib/store'
import { OP_STATUS, PROJECT_PRIORITIES, optColor, optLabel } from '../domain/constants'
import { daysUntil, fmtClock, fmtDate, fmtDuration, todayISO } from '../lib/format'
import { colors } from '../theme'
import type { OpOperation, ProductionOrder } from '../types'

const PRIORITY_RANK: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 }

export function ShopFloorPage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const projectFilter = params.get('projeto') ?? ''
  const { data, maps, loading } = useCollections(['productionOrders', 'workCenters', 'projects'] as const)
  const [centerId, setCenterId] = useState<string>(() => {
    try {
      return localStorage.getItem('arcoplan.shopfloor.center') ?? ''
    } catch {
      return ''
    }
  })
  const [now, setNow] = useState(Date.now())
  const [issue, setIssue] = useState<{ order: ProductionOrder; op: OpOperation } | null>(null)
  const [finish, setFinish] = useState<{ order: ProductionOrder; op: OpOperation } | null>(null)
  const [issueText, setIssueText] = useState('')
  const [issueKind, setIssueKind] = useState<'retrabalho' | 'refugo' | 'defeito_material'>('retrabalho')
  const [qty, setQty] = useState<number | null>(null)

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const centers = data.workCenters.filter((w) => w.active).sort((a, b) => a.order - b.order)
  const selected = centerId || centers[0]?.id || ''

  const pick = (id: string) => {
    setCenterId(id)
    try {
      localStorage.setItem('arcoplan.shopfloor.center', id)
    } catch {
      /* ignora */
    }
  }

  // projetos que têm produção em andamento (para escolher no seletor)
  const projectsInProduction = useMemo(() => {
    const ids = new Set(data.productionOrders.filter((o) => ['liberada', 'em_producao'].includes(o.status) && o.projectId).map((o) => o.projectId as string))
    return data.projects.filter((p) => ids.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))
  }, [data.productionOrders, data.projects])
  const setProject = (id: string) => {
    if (id) params.set('projeto', id)
    else {
      params.delete('projeto')
      params.delete('op')
    }
    setParams(params, { replace: true })
  }
  const projectOrders = useMemo(() => (projectFilter ? data.productionOrders.filter((o) => o.projectId === projectFilter && o.status !== 'cancelada') : []), [data.productionOrders, projectFilter])

  const queue = useMemo(() => {
    const items: { order: ProductionOrder; op: OpOperation; blocked: boolean }[] = []
    for (const order of data.productionOrders) {
      if (!['liberada', 'em_producao'].includes(order.status)) continue
      if (projectFilter && order.projectId !== projectFilter) continue
      const ops = [...order.operations].sort((a, b) => a.order - b.order)
      ops.forEach((op, i) => {
        // com um projeto escolhido, aparecem as etapas de TODOS os setores dele
        if ((!projectFilter && op.workCenterId !== selected) || op.status === 'concluida') return
        const blocked = ops.slice(0, i).some((p) => p.status !== 'concluida')
        items.push({ order, op, blocked })
      })
    }
    return items.sort(
      (a, b) =>
        Number(b.op.status === 'em_andamento') - Number(a.op.status === 'em_andamento') ||
        Number(a.blocked) - Number(b.blocked) ||
        (PRIORITY_RANK[a.order.priority] ?? 9) - (PRIORITY_RANK[b.order.priority] ?? 9) ||
        (a.order.dueDate ?? '9').localeCompare(b.order.dueDate ?? '9'),
    )
  }, [data.productionOrders, selected, projectFilter])

  const busy = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of data.productionOrders) for (const op of o.operations) if (op.status === 'em_andamento') map.set(op.workCenterId, (map.get(op.workCenterId) ?? 0) + 1)
    return map
  }, [data.productionOrders])

  const elapsed = (op: OpOperation) => op.actualSeconds + (op.runningSince ? Math.max(0, (now - new Date(op.runningSince).getTime()) / 1000) : 0)

  // Sempre parte da versão mais recente da ordem (vários operadores atualizam a mesma OP).
  const mutate = async (orderId: string, opId: string, fn: (op: OpOperation) => Partial<OpOperation>, orderPatch?: (o: ProductionOrder) => Partial<ProductionOrder>) => {
    const fresh = getCollectionSnapshot('productionOrders').find((o) => o.id === orderId)
    if (!fresh) return
    const operations = fresh.operations.map((o) => (o.id === opId ? { ...o, ...fn(o) } : o))
    await updateDoc('productionOrders', orderId, { operations, ...(orderPatch ? orderPatch({ ...fresh, operations }) : {}) })
  }

  const start = (order: ProductionOrder, op: OpOperation) =>
    mutate(
      order.id,
      op.id,
      (o) => ({ status: 'em_andamento', runningSince: new Date().toISOString(), operatorId: user?.id, operatorName: user?.name, startedAt: o.startedAt ?? new Date().toISOString() }),
      (o) => (o.status === 'liberada' ? { status: 'em_producao' } : {}),
    ).then(() => toast.success(`Iniciado: ${order.code}`))

  const accumulate = (o: OpOperation) => o.actualSeconds + (o.runningSince ? Math.max(0, Math.round((Date.now() - new Date(o.runningSince).getTime()) / 1000)) : 0)

  const pause = (order: ProductionOrder, op: OpOperation) => mutate(order.id, op.id, (o) => ({ status: 'pausada', actualSeconds: accumulate(o), runningSince: null }))

  const complete = async () => {
    if (!finish) return
    const { order, op } = finish
    await mutate(
      order.id,
      op.id,
      (o) => ({ status: 'concluida', actualSeconds: accumulate(o), runningSince: null, finishedAt: new Date().toISOString(), quantityDone: qty ?? order.items.reduce((s, i) => s + i.quantity, 0) }),
      (o) => (o.operations.every((x) => x.status === 'concluida') ? { status: 'qualidade' } : {}),
    )
    toast.success('Etapa concluída.')
    setFinish(null)
    setQty(null)
  }

  const reportIssue = async () => {
    if (!issue || !issueText.trim()) return
    await createDoc('qualityRecords', {
      title: `${issueKind === 'refugo' ? 'Refugo' : issueKind === 'defeito_material' ? 'Defeito de material' : 'Retrabalho'} em ${maps.workCenters.get(issue.op.workCenterId)?.name ?? 'setor'} — ${issue.order.code}`,
      kind: issueKind,
      severity: 'media',
      status: 'aberta',
      productionOrderId: issue.order.id,
      projectId: issue.order.projectId,
      workCenterId: issue.op.workCenterId,
      description: issueText.trim(),
      responsibleId: user?.id,
      openedAt: todayISO(),
    })
    toast.success('Ocorrência registrada em Qualidade.')
    setIssue(null)
    setIssueText('')
  }

  if (loading && !data.workCenters.length) return <LoadingState />

  return (
    <Box>
      <PageHeader title="Chão de fábrica" subtitle="Apontamento de produção por setor: inicie, pause e conclua etapas das ordens liberadas." />

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <TextField select size="small" label="Projeto" value={projectFilter} onChange={(e) => setProject(e.target.value)} sx={{ minWidth: 300 }}>
            <MenuItem value="">
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Todos os projetos (por setor)
              </Box>
            </MenuItem>
            {projectsInProduction.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.code ? `${p.code} · ` : ''}
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          {projectFilter ? (
            <>
              <Typography variant="body2" color="text.secondary">
                Mostrando as etapas pendentes deste projeto em todos os setores.
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => navigate(`/projetos/${projectFilter}`)}>
                Abrir projeto
              </Button>
              <Button size="small" color="inherit" onClick={() => setProject('')}>
                Limpar
              </Button>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Escolha um projeto para ver o que falta fazer nele, em qualquer setor.
            </Typography>
          )}
        </Stack>
        {projectOrders.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2, mt: 1.5 }}>
            {projectOrders.map((o) => (
              <Box key={o.id}>
                <Typography variant="caption" color="text.secondary">
                  {o.code} · {o.title} · {optLabel(OP_STATUS, o.status)}
                </Typography>
                <ProgressLine value={orderProgress(o)} label={`${o.operations.filter((x) => x.status === 'concluida').length}/${o.operations.length} etapas`} />
              </Box>
            ))}
          </Box>
        ) : null}
      </Paper>

      <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1.5, mb: 2 }}>
        {centers.map((c) => {
          const active = c.id === selected
          const running = busy.get(c.id) ?? 0
          return (
            <Paper
              key={c.id}
              variant="outlined"
              onClick={() => pick(c.id)}
              sx={{
                px: 2,
                py: 1.5,
                minWidth: 190,
                borderRadius: 3,
                cursor: 'pointer',
                borderColor: active ? colors.brand : colors.border,
                bgcolor: active ? colors.brandTint : '#fff',
                boxShadow: active ? `0 0 0 1px ${colors.brand}` : 'none',
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Dot color={running ? colors.success : colors.borderStrong} size={10} />
                <Typography variant="caption" color="text.secondary">
                  {running ? `${running} em operação` : 'Livre'}
                </Typography>
              </Stack>
              <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
                {c.name}
              </Typography>
            </Paper>
          )
        })}
      </Box>

      {queue.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState
            icon={<PrecisionManufacturingIcon />}
            title={projectFilter ? 'Nada pendente neste projeto' : 'Fila vazia neste setor'}
            description={projectFilter ? 'As ordens do projeto precisam estar liberadas e ter etapas de roteiro. Confira em Ordens de produção.' : 'Quando uma ordem de produção for liberada com etapas para este setor, ela aparecerá aqui.'}
          />
        </Paper>
      ) : (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2 }}>
          {queue.map(({ order, op, blocked }) => {
            const running = op.status === 'em_andamento'
            const planned = op.plannedMinutes * 60
            const over = elapsed(op) > planned && planned > 0
            const d = order.dueDate ? daysUntil(order.dueDate) : null
            return (
              <Paper
                key={`${order.id}-${op.id}`}
                variant="outlined"
                sx={{
                  p: 2.25,
                  borderRadius: 3,
                  borderColor: running ? colors.brand : colors.border,
                  bgcolor: running ? alpha(colors.brand, 0.03) : '#fff',
                  opacity: blocked && !running ? 0.72 : 1,
                  borderLeft: `5px solid ${optColor(PROJECT_PRIORITIES, order.priority)}`,
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="overline" sx={{ color: colors.brand }}>
                      {order.code}
                      {order.batch ? ` · Lote ${order.batch}` : ''}
                    </Typography>
                    <Typography variant="h5">{projectFilter ? op.name || maps.workCenters.get(op.workCenterId)?.name : order.title}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {maps.projects.get(order.projectId ?? '')?.name ?? 'Sem projeto'} · Entrega {fmtDate(order.dueDate, 'dd/MM')}
                    </Typography>
                  </Box>
                  <Stack spacing={0.5} alignItems="flex-end">
                    <Chip size="small" label={optLabel(PROJECT_PRIORITIES, order.priority)} sx={{ bgcolor: alpha(optColor(PROJECT_PRIORITIES, order.priority), 0.14), color: optColor(PROJECT_PRIORITIES, order.priority) }} />
                    {d !== null && d < 0 ? <Chip size="small" color="error" label={`${-d} d atraso`} /> : null}
                  </Stack>
                </Stack>

                <Box sx={{ mt: 1.5, mb: 1.5 }}>
                  {order.items.slice(0, 3).map((it) => (
                    <Typography key={it.id} variant="body2" color="text.secondary" noWrap>
                      • {it.quantity}× {it.name}
                    </Typography>
                  ))}
                  {order.items.length > 3 ? (
                    <Typography variant="caption" color="text.secondary">
                      +{order.items.length - 3} itens
                    </Typography>
                  ) : null}
                </Box>

                <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1.5 }}>
                  <Box>
                    <Typography variant="overline" color="text.secondary">
                      Tempo apontado
                    </Typography>
                    <Typography sx={{ fontSize: '1.7rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: over ? colors.error : running ? colors.brand : colors.text, lineHeight: 1.1 }}>
                      {fmtClock(elapsed(op))}
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="overline" color="text.secondary">
                      Previsto
                    </Typography>
                    <Typography variant="subtitle1">{fmtDuration(planned)}</Typography>
                  </Box>
                  {op.operatorName ? (
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                      {op.operatorName}
                    </Typography>
                  ) : null}
                </Stack>

                {blocked && !running ? (
                  <Typography variant="caption" sx={{ display: 'block', mb: 1, color: colors.warning, fontWeight: 600 }}>
                    Aguardando etapa anterior do roteiro
                  </Typography>
                ) : null}

                <Stack direction="row" spacing={1}>
                  {running ? (
                    <Button size="large" variant="outlined" color="inherit" startIcon={<PauseIcon />} onClick={() => pause(order, op)} sx={{ flex: 1 }}>
                      Pausar
                    </Button>
                  ) : (
                    <Button size="large" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => start(order, op)} sx={{ flex: 1 }}>
                      {op.status === 'pausada' ? 'Retomar' : 'Iniciar'}
                    </Button>
                  )}
                  <Button size="large" variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={() => { setFinish({ order, op }); setQty(order.items.reduce((s, i) => s + i.quantity, 0)) }} sx={{ flex: 1 }}>
                    Concluir
                  </Button>
                  <Button size="large" color="warning" variant="outlined" onClick={() => setIssue({ order, op })} aria-label="Registrar problema" sx={{ minWidth: 56 }}>
                    <WarningAmberIcon />
                  </Button>
                </Stack>
              </Paper>
            )
          })}
        </Box>
      )}

      <Dialog open={Boolean(finish)} onClose={() => setFinish(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Concluir etapa</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {finish?.order.code} · {maps.workCenters.get(finish?.op.workCenterId ?? '')?.name}
          </Typography>
          <NumberField label="Quantidade produzida" value={qty} onChange={setQty} min={0} decimals={0} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setFinish(null)}>
            Cancelar
          </Button>
          <Button variant="contained" color="success" onClick={complete}>
            Confirmar conclusão
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(issue)} onClose={() => setIssue(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Registrar problema</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <ToggleButtonGroup exclusive value={issueKind} onChange={(_, v) => v && setIssueKind(v)} size="small" fullWidth>
              <ToggleButton value="retrabalho">Retrabalho</ToggleButton>
              <ToggleButton value="refugo">Refugo</ToggleButton>
              <ToggleButton value="defeito_material">Defeito de material</ToggleButton>
            </ToggleButtonGroup>
            <TextField multiline minRows={3} label="O que aconteceu?" value={issueText} onChange={(e) => setIssueText(e.target.value)} autoFocus />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setIssue(null)}>
            Cancelar
          </Button>
          <Button variant="contained" onClick={reportIssue} disabled={!issueText.trim()}>
            Registrar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
