import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, TextField, ToggleButton, ToggleButtonGroup, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { ArticleIcon, BadgeIcon, CheckCircleIcon, PauseIcon, PlayArrowIcon, PrecisionManufacturingIcon, QrCodeScannerIcon, WarningAmberIcon } from '../components/icons'
import { QrScanDialog } from '../components/QrScanDialog'
import { StepDetailsDialog } from '../components/StepDetailsDialog'
import { LabelsDialog } from '../components/LabelsDialog'
import { loadPlan, unitKey, unitsOf } from '../lib/planUnits'
import { buildProductionReportPdf } from '../domain/productionReportPdf'
import { resolveScan } from '../domain/shopfloor'
import { PAUSE_REASONS, type PauseReason } from '../../shared/shopfloor.mjs'
import { Dot, EmptyState, LoadingState, PageHeader, ProgressLine, UserAvatar } from '../components/ui'
import { orderProgress } from '../components/ProductionTimeline'
import { NumberField } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { createDoc, getCollectionSnapshot, patchLocal, refreshCollection, useCollections, useCompany } from '../lib/store'
import { actionPath, enqueue, flushQueue, onQueueChange, queued } from '../lib/shopfloorQueue'
import { applyOperationAction, runningOperationsOf } from '../../backend/lib/shopfloor.mjs'
import { ApiError, api } from '../lib/api'
import { OP_STATUS, PROJECT_PRIORITIES, optColor, optLabel } from '../domain/constants'
import { daysUntil, downloadBlob, fmtClock, fmtDate, fmtDuration, todayISO } from '../lib/format'
import { colors } from '../theme'
import type { OpOperation, ProductionOrder } from '../types'

const PRIORITY_RANK: Record<string, number> = { urgente: 0, alta: 1, media: 2, baixa: 3 }
const OPERATOR_KEY = 'arcoplan.shopfloor.operator'
const OPERATOR_IDLE_MS = 15 * 60_000

type Operator = { ticket: string; id: string; name: string }
type ActionBody = { quantity?: number | null; reason?: PauseReason; note?: string }
type OperatorOption = { id: string; name: string; position: string; hasPin: boolean; team: boolean; photoFileId?: string | null }

const loadOperator = (): Operator | null => {
  try {
    const raw = sessionStorage.getItem(OPERATOR_KEY)
    return raw ? (JSON.parse(raw) as Operator) : null
  } catch {
    return null
  }
}
const saveOperator = (op: Operator | null) => {
  try {
    if (op) sessionStorage.setItem(OPERATOR_KEY, JSON.stringify(op))
    else sessionStorage.removeItem(OPERATOR_KEY)
  } catch {
    /* ignora */
  }
}

export function ShopFloorPage() {
  const { user, can } = useAuth()
  const company = useCompany()
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const projectFilter = params.get('projeto') ?? ''
  const { data, maps, loading } = useCollections(['productionOrders', 'workCenters', 'projects', 'cutPlans', 'clients', 'qualityRecords', 'qualityInspections'] as const)
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
  const [pausing, setPausing] = useState<{ order: ProductionOrder; op: OpOperation } | null>(null)
  const [details, setDetails] = useState<{ order: ProductionOrder; op: OpOperation } | null>(null)
  const [labels, setLabels] = useState<{ orderIds: string[]; focusOpId?: string; title: string } | null>(null)
  // planos da ordem; sem vínculo, os planos do projeto
  const planIdsOf = (order: ProductionOrder) => (order.cutPlanIds?.length ? order.cutPlanIds : data.cutPlans.filter((p) => order.projectId && p.projectId === order.projectId).map((p) => p.id))
  const [pauseNote, setPauseNote] = useState('')
  const [issueText, setIssueText] = useState('')
  const [issueKind, setIssueKind] = useState<'retrabalho' | 'refugo' | 'defeito_material'>('retrabalho')
  const [qty, setQty] = useState<number | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [scanned, setScanned] = useState<{ orderIds: string[]; label: string } | null>(null)
  // tablet compartilhado: quem aponta é o operador identificado por PIN (ou o usuário logado)
  const [operator, setOperatorState] = useState<Operator | null>(loadOperator)
  const [operatorDialog, setOperatorDialog] = useState(false)
  const [operatorOptions, setOperatorOptions] = useState<OperatorOption[]>([])
  const [operatorPick, setOperatorPick] = useState('')
  const [pin, setPin] = useState('')
  const setOperator = (op: Operator | null) => {
    saveOperator(op)
    setOperatorState(op)
  }
  /** Operador sai: o tíquete é invalidado no servidor (menos se ainda houver apontamento dele na fila offline). */
  const signOutOperator = (reason?: string) => {
    if (!operator) return
    if (!queued().some((q) => q.operatorTicket === operator.ticket)) void api.del('/shopfloor/operator', { 'X-Operator': operator.ticket }).catch(() => undefined)
    setOperator(null)
    if (reason) toast.info(reason)
  }

  // tablet compartilhado: sem nenhum toque por um tempo, o próximo a usar precisa se identificar de novo
  const lastTouch = useRef(Date.now())
  useEffect(() => {
    if (!operator) return
    const touch = () => (lastTouch.current = Date.now())
    touch()
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    const id = window.setInterval(() => {
      if (Date.now() - lastTouch.current > OPERATOR_IDLE_MS) signOutOperator(`${operator.name} saiu do tablet por inatividade. Informe o PIN para continuar apontando.`)
    }, 30_000)
    return () => {
      window.removeEventListener('pointerdown', touch)
      window.removeEventListener('keydown', touch)
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operator?.ticket])

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
  // projetos com plano de corte gerado ou com ordem de produção, e em que pé cada um está
  const projectOptions = useMemo(() => {
    const RANK: Record<string, number> = { em_producao: 0, liberada: 1, qualidade: 2, planejada: 3, sem_ordem: 4, concluida: 5 }
    const LABEL: Record<string, string> = { em_producao: 'em produção', liberada: 'liberada', qualidade: 'na qualidade', planejada: 'ordem planejada', sem_ordem: 'sem ordem de produção', concluida: 'concluída' }
    const withPlans = new Set(data.cutPlans.map((p) => p.projectId).filter(Boolean) as string[])
    const out: { project: (typeof data.projects)[number]; state: string; label: string; plans: number }[] = []
    for (const project of data.projects) {
      const orders = data.productionOrders.filter((o) => o.projectId === project.id && o.status !== 'cancelada')
      if (!orders.length && !withPlans.has(project.id)) continue
      const state = orders.length ? orders.map((o) => o.status).sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9))[0] : 'sem_ordem'
      out.push({ project, state, label: LABEL[state] ?? state, plans: data.cutPlans.filter((p) => p.projectId === project.id).length })
    }
    return out.sort((a, b) => (RANK[a.state] ?? 9) - (RANK[b.state] ?? 9) || a.project.name.localeCompare(b.project.name))
  }, [data.productionOrders, data.projects, data.cutPlans])
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
      if (scanned && !scanned.orderIds.includes(order.id)) continue
      const ops = [...order.operations].sort((a, b) => a.order - b.order)
      ops.forEach((op, i) => {
        // com um projeto escolhido (ou uma etiqueta lida), aparecem as etapas de TODOS os setores
        if ((!projectFilter && !scanned && op.workCenterId !== selected) || op.status === 'concluida') return
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
  }, [data.productionOrders, selected, projectFilter, scanned])

  const busy = useMemo(() => {
    const map = new Map<string, number>()
    for (const o of data.productionOrders) for (const op of o.operations) if (op.status === 'em_andamento') map.set(op.workCenterId, (map.get(op.workCenterId) ?? 0) + 1)
    return map
  }, [data.productionOrders])

  const elapsed = (op: OpOperation) => op.actualSeconds + (op.runningSince ? Math.max(0, (now - new Date(op.runningSince).getTime()) / 1000) : 0)

  // fila de apontamentos feitos sem internet (enviada sozinha quando a conexão volta)
  const pendingQueue = useSyncExternalStore(onQueueChange, queued)
  const sendQueue = async () => {
    const { sent, failed } = await flushQueue()
    if (sent || failed.length) await refreshCollection('productionOrders')
    if (sent) toast.success(`${sent} apontamento(s) guardado(s) no aparelho enviado(s).`)
    for (const f of failed) toast.error(`${f.label}: ${f.message}`)
  }
  useEffect(() => {
    if (!queued().length) return
    void sendQueue()
    const id = window.setInterval(() => queued().length && void sendQueue(), 15_000)
    window.addEventListener('online', sendQueue)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('online', sendQueue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingQueue.length > 0])

  /** Sem internet: valida com as mesmas regras do servidor, mostra na tela e guarda para enviar depois. */
  const actOffline = (order: ProductionOrder, op: OpOperation, action: 'start' | 'pause' | 'finish', body: ActionBody) => {
    const who = operator ?? (user ? { id: user.id, name: user.name } : null)
    if (!who) return null
    const fresh = getCollectionSnapshot('productionOrders')
    const current = fresh.find((o) => o.id === order.id) ?? order
    try {
      const result = applyOperationAction(current, op.id, action, { user: who, quantity: body.quantity, reason: body.reason, note: body.note, running: action === 'start' ? runningOperationsOf(fresh, who.id) : [] })
      patchLocal('productionOrders', order.id, { operations: result.operations, ...(result.status ? { status: result.status } : {}) })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Apontamento inválido.')
      return null
    }
    enqueue({ orderId: order.id, opId: op.id, action, body: { ...body }, operatorTicket: operator?.ticket, label: `${order.code} · ${op.name || 'etapa'}` })
    toast.info('Sem internet: apontamento guardado neste aparelho. Ele será enviado quando a conexão voltar.')
    return { inspection: null }
  }

  // O servidor altera só a etapa apontada, com o relógio dele: operadores na mesma OP não se sobrescrevem.
  const [sending, setSending] = useState(false)
  const act = async (order: ProductionOrder, op: OpOperation, action: 'start' | 'pause' | 'finish', body: ActionBody = {}) => {
    // há apontamentos guardados: este entra na fila para manter a ordem dos acontecimentos
    if (queued().length) {
      const res = actOffline(order, op, action, body)
      void sendQueue()
      return res
    }
    setSending(true)
    try {
      const res = await api.post<{ inspection: unknown; consumed?: boolean; consumeError?: string | null }>(actionPath(order.id, op.id, action), body, operator ? { 'X-Operator': operator.ticket } : undefined)
      await refreshCollection('productionOrders')
      return res
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) return actOffline(order, op, action, body)
      if (operator && error instanceof ApiError && /identificação do operador/.test(error.message)) {
        setOperator(null)
        setOperatorDialog(true)
      }
      toast.error(error instanceof Error ? error.message : 'Não foi possível registrar o apontamento.')
      void refreshCollection('productionOrders')
      return null
    } finally {
      setSending(false)
    }
  }

  const start = async (order: ProductionOrder, op: OpOperation) => {
    if (await act(order, op, 'start')) toast.success(`Iniciado: ${order.code}`)
  }

  const pause = async (reason: PauseReason) => {
    if (!pausing) return
    if (await act(pausing.order, pausing.op, 'pause', { reason, note: pauseNote })) {
      setPausing(null)
      setPauseNote('')
    }
  }

  const complete = async () => {
    if (!finish) return
    const res = await act(finish.order, finish.op, 'finish', { quantity: qty })
    if (!res) return
    toast.success(res.inspection ? 'Etapa concluída. Roteiro completo: a ordem foi para a inspeção de qualidade.' : 'consumed' in res && res.consumed ? 'Corte concluído: as chapas do plano saíram do estoque.' : 'Etapa concluída.')
    if ('consumeError' in res && res.consumeError) toast.warning(`Etapa concluída, mas o estoque não foi baixado: ${res.consumeError} Ajuste em Estoque ou em Ordens de produção.`)
    setFinish(null)
    setQty(null)
  }

  const reportIssue = async () => {
    if (!issue || !issueText.trim()) return
    try {
      await createDoc('qualityRecords', {
        title: `${issueKind === 'refugo' ? 'Refugo' : issueKind === 'defeito_material' ? 'Defeito de material' : 'Retrabalho'} em ${maps.workCenters.get(issue.op.workCenterId)?.name ?? 'setor'} — ${issue.order.code}`,
        kind: issueKind,
        severity: 'media',
        status: 'aberta',
        productionOrderId: issue.order.id,
        projectId: issue.order.projectId,
        workCenterId: issue.op.workCenterId,
        description: issueText.trim(),
        responsibleId: operator?.id ?? user?.id,
        openedAt: todayISO(),
      })
    } catch (error) {
      return toast.error(error instanceof Error ? error.message : 'Não foi possível registrar a ocorrência.')
    }
    if (issue.op.status === 'em_andamento') await act(issue.order, issue.op, 'pause', { reason: 'problema_qualidade', note: issueText.trim().slice(0, 200) })
    toast.success('Ocorrência registrada em Qualidade e encarregado avisado.')
    setIssue(null)
    setIssueText('')
  }

  // ---- projeto escolhido: liberar/criar a ordem e o relatório técnico
  const [projectBusy, setProjectBusy] = useState(false)
  const projectPlanIds = data.cutPlans.filter((p) => projectFilter && p.projectId === projectFilter).map((p) => p.id)

  const releaseOrder = async (order: ProductionOrder) => {
    setProjectBusy(true)
    try {
      // a ordem leva os planos de corte do projeto (etiquetas e peças no chão de fábrica)
      if (!order.cutPlanIds?.length && projectPlanIds.length) await api.put(`/data/productionOrders/${order.id}`, { cutPlanIds: projectPlanIds })
      await api.post(`/production-orders/${order.id}/release`)
      await refreshCollection('productionOrders')
      toast.success(`${order.code} liberada: as chapas do plano de corte foram reservadas e as etapas já aparecem nos setores.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível liberar a ordem.'
      // falta material: oferece gerar a solicitação de compra do que falta
      if (/insuficiente/i.test(message) && can('purchases')) {
        const ok = await confirm({ title: 'Falta material para liberar', message: `${message} Gerar a solicitação de compra do que falta para esta ordem?`, confirmLabel: 'Gerar solicitação de compra' })
        if (ok) {
          try {
            const res = await api.post<{ purchase: { code?: string }; existing: boolean }>(`/production-orders/${order.id}/purchase`, {})
            toast.success(res.existing ? `Já existe a solicitação ${res.purchase.code ?? ''} para esta ordem.` : `Solicitação de compra ${res.purchase.code ?? ''} criada em Compras.`)
          } catch (purchaseError) {
            toast.error(purchaseError instanceof Error ? purchaseError.message : 'Não foi possível gerar a compra.')
          }
        }
      } else toast.error(message)
    } finally {
      setProjectBusy(false)
    }
  }

  /** Ordem sem roteiro: uma etapa por setor ativo. */
  const addSteps = async (order: ProductionOrder) => {
    if (!centers.length) return toast.error('Cadastre os setores em Configurações → Setores e máquinas.')
    setProjectBusy(true)
    try {
      const operations = centers.map((center, index) => ({ id: crypto.randomUUID(), workCenterId: center.id, name: center.name, order: index + 1, plannedMinutes: 0, actualSeconds: 0, status: 'pendente' as const, quantityDone: 0 }))
      await api.put(`/data/productionOrders/${order.id}`, { operations, ...(!order.cutPlanIds?.length && projectPlanIds.length ? { cutPlanIds: projectPlanIds } : {}) })
      await refreshCollection('productionOrders')
      toast.success(order.status === 'planejada' ? 'Etapas criadas. Agora libere a ordem para a produção.' : 'Etapas criadas: já aparecem nos setores.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar as etapas.')
    } finally {
      setProjectBusy(false)
    }
  }

  const createOrder = async () => {
    const project = data.projects.find((p) => p.id === projectFilter)
    if (!project) return
    if (!centers.length) return toast.error('Cadastre os setores em Configurações → Setores e máquinas antes de criar a ordem.')
    setProjectBusy(true)
    try {
      await createDoc('productionOrders', {
        title: `Produção — ${project.name}`,
        projectId: project.id,
        clientId: project.clientId,
        status: 'planejada',
        priority: project.priority ?? 'media',
        startDate: todayISO(),
        dueDate: project.dueDate,
        items: [],
        operations: centers.map((center, index) => ({ id: crypto.randomUUID(), workCenterId: center.id, name: center.name, order: index + 1, plannedMinutes: 0, actualSeconds: 0, status: 'pendente' as const, quantityDone: 0 })),
        materialsPosted: false,
        cutPlanIds: projectPlanIds,
        notes: 'Ordem criada pelo Chão de fábrica a partir dos planos de corte do projeto.',
      })
      toast.success('Ordem de produção criada. Libere para as etapas aparecerem nos setores.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar a ordem.')
    } finally {
      setProjectBusy(false)
    }
  }

  const exportReport = async () => {
    const project = data.projects.find((p) => p.id === projectFilter)
    if (!project) return
    setProjectBusy(true)
    try {
      const orders = projectOrders
      const unitsByOrder = new Map<string, ReturnType<typeof unitsOf>>()
      for (const order of orders) unitsByOrder.set(order.id, unitsOf(await Promise.all(planIdsOf(order).map(loadPlan))))
      const blob = await buildProductionReportPdf({
        company,
        project,
        client: data.clients.find((c) => c.id === project.clientId),
        orders,
        workCenters: maps.workCenters,
        unitsOf: (order) => unitsByOrder.get(order.id) ?? [],
        quality: data.qualityRecords.filter((q) => q.projectId === project.id || orders.some((o) => o.id === q.productionOrderId)),
        inspections: data.qualityInspections.filter((i) => orders.some((o) => o.id === i.productionOrderId)),
      })
      downloadBlob(blob, `relatorio-producao-${(project.code ?? project.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível gerar o relatório.')
    } finally {
      setProjectBusy(false)
    }
  }

  /** Total de etiquetas da ordem (pelo resumo dos planos, sem baixar as peças). */
  const unitsTotal = (order: ProductionOrder) => planIdsOf(order).reduce((sum, id) => sum + (data.cutPlans.find((p) => p.id === id)?.pieceCount ?? 0), 0)

  /** Marca/desmarca etiquetas feitas numa etapa (em lotes, para planos muito grandes). */
  const markUnits = async (order: ProductionOrder, op: OpOperation, keys: string[], done: boolean) => {
    try {
      let last: { done: number; total: number } | null = null
      for (let i = 0; i < keys.length; i += 2000)
        last = await api.post<{ done: number; total: number }>(actionPath(order.id, op.id, 'pieces'), { keys: keys.slice(i, i + 2000), done }, operator ? { 'X-Operator': operator.ticket } : undefined)
      await refreshCollection('productionOrders')
      return last
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível marcar as etiquetas.')
      void refreshCollection('productionOrders')
      return null
    }
  }

  const onScan = async (text: string) => {
    const found = resolveScan(text, data.productionOrders, data.cutPlans)
    if (found.kind === 'none') return toast.error(found.message)
    setScanned({ orderIds: found.orderIds, label: found.label })
    // código de ordem/plano fecha o leitor; etiqueta de peça mantém aberto para ler a próxima
    if (!found.unit && !found.unitRef) return setScanOpen(false)
    let unit = found.unit
    if (!unit && found.unitRef) {
      // código curto digitado: localiza a peça pelo número dela no plano
      const ref = found.unitRef
      const piece = (await loadPlan(ref.planId).catch(() => null))?.pieces?.[ref.pieceIndex]
      if (!piece || ref.n > piece.quantity) return toast.error('Etiqueta não encontrada no plano de corte.')
      unit = { planId: ref.planId, pieceId: piece.id, n: ref.n }
    }
    if (!unit) return
    // etiqueta de peça: marca como feita na etapa em andamento (de preferência a deste setor / deste operador)
    const who = operator?.id ?? user?.id
    const running = data.productionOrders
      .filter((o) => found.orderIds.includes(o.id))
      .flatMap((order) => order.operations.filter((op) => op.status === 'em_andamento').map((op) => ({ order, op })))
    const target = running.find((r) => r.op.workCenterId === selected) ?? running.find((r) => r.op.operatorId === who) ?? (running.length === 1 ? running[0] : undefined)
    if (!target) return toast.info('Etiqueta lida. Inicie a etapa deste setor para marcar a peça como feita.')
    const key = unitKey(unit.planId, unit.pieceId, unit.n)
    if (target.op.piecesDone?.includes(key)) return toast.info(`Esta peça já estava marcada em ${target.op.name}.`)
    const res = await markUnits(target.order, target.op, [key], true)
    if (res) toast.success(`Peça ${unit.n} marcada em ${target.op.name} · ${res.done}/${res.total}`)
  }

  const openOperatorDialog = async () => {
    setPin('')
    setOperatorPick('')
    setOperatorOptions([])
    setOperatorDialog(true)
    try {
      setOperatorOptions(await api.get<OperatorOption[]>(`/shopfloor/operators${projectFilter ? `?projeto=${encodeURIComponent(projectFilter)}` : ''}`))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível carregar a equipe.')
    }
  }
  /** Pessoa da equipe do projeto: um toque basta. Fora da equipe: confirma com o PIN. */
  const confirmOperator = async (teamId?: string) => {
    try {
      const res = await api.post<{ ticket: string; operator: { id: string; name: string } }>('/shopfloor/operator', teamId ? { userId: teamId, projectId: projectFilter || undefined } : { userId: operatorPick, pin })
      setOperator({ ticket: res.ticket, ...res.operator })
      setOperatorDialog(false)
      toast.success(`Operador: ${res.operator.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'PIN incorreto.')
    } finally {
      setPin('')
    }
  }

  if (loading && !data.workCenters.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Chão de fábrica"
        subtitle="Apontamento de produção por setor: inicie, pause e conclua etapas das ordens liberadas."
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <Button variant="outlined" color="inherit" startIcon={<BadgeIcon />} onClick={openOperatorDialog}>
              {operator ? `Operador: ${operator.name}` : `Operador: ${user?.name ?? '—'}`}
            </Button>
            {operator ? (
              <Button color="inherit" onClick={() => signOutOperator()}>
                Sair
              </Button>
            ) : null}
            <Button color="inherit" onClick={() => navigate(selected ? `/chao-de-fabrica/painel?setor=${selected}` : '/chao-de-fabrica/painel')}>
              Painel TV
            </Button>
            <Button size="large" variant="contained" startIcon={<QrCodeScannerIcon />} onClick={() => setScanOpen(true)}>
              Ler etiqueta
            </Button>
          </Stack>
        }
      />

      {/* como usar, em três toques (some quando já há projeto e operador escolhidos) */}
      {!projectFilter || !operator ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5, mb: 2 }}>
          {[
            { n: 1, title: 'Escolha o projeto', text: 'Na lista aparecem os projetos com plano de corte. Se a ordem estiver planejada, toque em Liberar.', done: Boolean(projectFilter) },
            { n: 2, title: 'Toque no seu nome', text: 'Em “Operador”, escolha quem está trabalhando: a equipe do projeto aparece com um toque.', done: Boolean(operator) },
            { n: 3, title: 'Inicie e conclua', text: 'Na etapa do seu setor: Iniciar, marque as peças (ou leia as etiquetas) e Concluir. No fim, gere o Relatório técnico.', done: false },
          ].map((step) => (
            <Paper key={step.n} variant="outlined" sx={{ p: 1.5, borderRadius: 3, display: 'flex', gap: 1.5, alignItems: 'flex-start', borderColor: step.done ? colors.success : colors.border, bgcolor: step.done ? alpha(colors.success, 0.05) : '#fff' }}>
              <Box sx={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center', fontWeight: 700, color: '#fff', bgcolor: step.done ? colors.success : colors.brand }}>{step.done ? '✓' : step.n}</Box>
              <Box>
                <Typography variant="subtitle2">{step.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {step.text}
                </Typography>
                {step.n === 2 && !operator ? (
                  <Button size="small" onClick={openOperatorDialog} sx={{ mt: 0.5, ml: -0.75 }}>
                    Escolher quem está trabalhando
                  </Button>
                ) : null}
              </Box>
            </Paper>
          ))}
        </Box>
      ) : null}

      {pendingQueue.length ? (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2, borderColor: colors.warning, bgcolor: alpha(colors.warning, 0.08) }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <WarningAmberIcon sx={{ color: colors.warning }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {pendingQueue.length} apontamento(s) guardado(s) neste aparelho, aguardando conexão.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Não feche o navegador nem limpe os dados do aparelho até enviar.
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => void sendQueue()}>
              Enviar agora
            </Button>
          </Stack>
        </Paper>
      ) : null}

      {scanned ? (
        <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2, borderColor: colors.brand, bgcolor: colors.brandTint }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <QrCodeScannerIcon sx={{ color: colors.brand }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {scanned.label}:{' '}
              {scanned.orderIds
                .map((id) => data.productionOrders.find((o) => o.id === id)?.code)
                .filter(Boolean)
                .join(', ')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Etapas pendentes desta leitura em todos os setores.
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setLabels({ orderIds: scanned.orderIds, title: `Etiquetas — ${scanned.label}` })}>
              Ver etiquetas
            </Button>
            <Button size="small" onClick={() => setScanOpen(true)}>
              Ler outra
            </Button>
            <Button size="small" color="inherit" onClick={() => setScanned(null)}>
              Limpar
            </Button>
          </Stack>
        </Paper>
      ) : null}

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <TextField select size="small" label="Projeto" value={projectFilter} onChange={(e) => setProject(e.target.value)} sx={{ minWidth: 300 }}>
            <MenuItem value="">
              <Box component="span" sx={{ color: 'text.secondary' }}>
                Todos os projetos (por setor)
              </Box>
            </MenuItem>
            {projectOptions.map(({ project: p, label, plans }) => (
              <MenuItem key={p.id} value={p.id}>
                {p.code ? `${p.code} · ` : ''}
                {p.name}
                <Box component="span" sx={{ color: 'text.secondary', ml: 1, fontSize: '0.85em' }}>
                  · {label}
                  {plans ? ` · ${plans} plano${plans > 1 ? 's' : ''} de corte` : ''}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          {projectFilter ? (
            <>
              <Typography variant="body2" color="text.secondary">
                Mostrando as etapas pendentes deste projeto em todos os setores.
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Button
                size="small"
                variant="contained"
                startIcon={<QrCodeScannerIcon />}
                disabled={!projectOrders.some((o) => ['liberada', 'em_producao'].includes(o.status))}
                onClick={() => setLabels({ orderIds: projectOrders.filter((o) => ['liberada', 'em_producao'].includes(o.status)).map((o) => o.id), title: `Etiquetas — ${data.projects.find((p) => p.id === projectFilter)?.name ?? 'projeto'}` })}
              >
                Etiquetas do projeto
              </Button>
              <Button size="small" variant="outlined" startIcon={<ArticleIcon />} disabled={projectBusy || !projectOrders.length} onClick={() => void exportReport()}>
                Relatório técnico (PDF)
              </Button>
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
                {!o.operations.length ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography variant="body2" sx={{ color: colors.warning, fontWeight: 600 }}>
                      Esta ordem não tem etapas.
                    </Typography>
                    {['planejada', 'liberada', 'em_producao'].includes(o.status) ? (
                      <Button size="small" variant="contained" disabled={projectBusy} onClick={() => void addSteps(o)}>
                        Criar etapas pelos setores
                      </Button>
                    ) : (
                      <Button size="small" variant="contained" disabled={projectBusy} onClick={() => void createOrder()}>
                        Nova ordem de produção
                      </Button>
                    )}
                  </Stack>
                ) : null}
                {o.status === 'planejada' && o.operations.length ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
                    <Typography variant="body2" sx={{ color: colors.warning, fontWeight: 600 }}>
                      Ordem planejada: libere para as etapas aparecerem nos setores.
                    </Typography>
                    {can('production') ? (
                      <Button size="small" variant="contained" disabled={projectBusy || !o.operations.length} onClick={() => void releaseOrder(o)}>
                        Liberar para produção
                      </Button>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Peça ao PCP para liberar.
                      </Typography>
                    )}
                  </Stack>
                ) : null}
              </Box>
            ))}
          </Box>
        ) : null}
        {projectFilter && projectOrders.length && projectOrders.every((o) => o.status === 'concluida') && projectOrders.some((o) => o.operations.length) ? (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="body2" color="text.secondary">
              A produção deste projeto foi concluída. Precisa produzir de novo (reposição, segundo lote)?
            </Typography>
            <Button size="small" variant="outlined" disabled={projectBusy} onClick={() => void createOrder()}>
              Nova ordem de produção
            </Button>
          </Stack>
        ) : null}
        {projectFilter && !projectOrders.length ? (
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="body2" sx={{ color: colors.warning, fontWeight: 600 }}>
              Este projeto tem {projectPlanIds.length} plano(s) de corte, mas ainda não tem ordem de produção.
            </Typography>
            <Button size="small" variant="contained" disabled={projectBusy} onClick={() => void createOrder()}>
              Criar ordem de produção
            </Button>
          </Stack>
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
                    <Typography variant="h5">{projectFilter || scanned ? op.name || maps.workCenters.get(op.workCenterId)?.name : order.title}</Typography>
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
                  <Button size="small" startIcon={<ArticleIcon />} onClick={() => setDetails({ order, op })} sx={{ mt: 0.5, ml: -0.75 }}>
                    Peças, desenhos e observações
                  </Button>
                  {(() => {
                    const total = unitsTotal(order)
                    if (!total) return null
                    const done = op.piecesDone?.length ?? 0
                    return (
                      <Box sx={{ mt: 1 }}>
                        <ProgressLine value={Math.round((done / total) * 100)} label={`Etiquetas feitas nesta etapa: ${done}/${total}`} />
                        <Button size="small" startIcon={<QrCodeScannerIcon />} onClick={() => setLabels({ orderIds: [order.id], focusOpId: op.id, title: `${order.code} · ${op.name}` })} sx={{ mt: 0.5, ml: -0.75 }}>
                          Etiquetas
                        </Button>
                      </Box>
                    )
                  })()}
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
                {(() => {
                  const open = op.status === 'pausada' ? op.pauses?.find((p) => !p.end) : undefined
                  if (!open) return null
                  const label = PAUSE_REASONS.find((r) => r.value === open.reason)?.label ?? open.reason
                  return (
                    <Typography variant="caption" sx={{ display: 'block', mb: 1, color: colors.warning, fontWeight: 600 }}>
                      Pausada: {label} · há {fmtDuration((now - Date.parse(open.start)) / 1000)}
                      {open.note ? ` · ${open.note}` : ''}
                    </Typography>
                  )
                })()}

                <Stack direction="row" spacing={1}>
                  {running ? (
                    <Button size="large" variant="outlined" color="inherit" startIcon={<PauseIcon />} onClick={() => setPausing({ order, op })} disabled={sending} sx={{ flex: 1 }}>
                      Pausar
                    </Button>
                  ) : (
                    <Button size="large" variant="contained" startIcon={<PlayArrowIcon />} onClick={() => start(order, op)} disabled={sending || blocked} sx={{ flex: 1 }}>
                      {op.status === 'pausada' ? 'Retomar' : 'Iniciar'}
                    </Button>
                  )}
                  <Button size="large" variant="contained" color="success" startIcon={<CheckCircleIcon />} onClick={() => { setFinish({ order, op }); setQty(order.items.reduce((s, i) => s + i.quantity, 0)) }} disabled={sending || op.status === 'pendente'} sx={{ flex: 1 }}>
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
          {(() => {
            if (!finish) return null
            const total = unitsTotal(finish.order)
            const done = finish.op.piecesDone?.length ?? 0
            return total && done < total ? (
              <Typography variant="body2" sx={{ mb: 2, color: colors.warning, fontWeight: 600 }}>
                Faltam {total - done} de {total} etiquetas marcadas nesta etapa. Conclua só se todas as peças passaram por aqui.
              </Typography>
            ) : null
          })()}
          <NumberField label="Quantidade produzida" value={qty} onChange={setQty} min={0} decimals={0} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setFinish(null)}>
            Cancelar
          </Button>
          <Button variant="contained" color="success" onClick={complete} disabled={sending}>
            Confirmar conclusão
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(pausing)} onClose={() => setPausing(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Por que está pausando?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {pausing?.order.code} · {pausing ? pausing.op.name || maps.workCenters.get(pausing.op.workCenterId)?.name : ''}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 2 }}>
            {PAUSE_REASONS.map((r) => (
              <Button key={r.value} variant="outlined" color={r.planned ? 'inherit' : 'warning'} onClick={() => pause(r.value)} disabled={sending} sx={{ py: 1.5, lineHeight: 1.2 }}>
                {r.label}
              </Button>
            ))}
          </Box>
          <TextField fullWidth size="small" label="Observação (opcional)" value={pauseNote} onChange={(e) => setPauseNote(e.target.value.slice(0, 200))} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setPausing(null)}>
            Cancelar
          </Button>
        </DialogActions>
      </Dialog>

      {labels ? (
        <LabelsDialog
          orders={data.productionOrders.filter((o) => labels.orderIds.includes(o.id))}
          planIdsOf={planIdsOf}
          focusOpId={labels.focusOpId}
          title={labels.title}
          onMark={async (order, op, keys, done) => Boolean(await markUnits(order, op, keys, done))}
          onClose={() => setLabels(null)}
        />
      ) : null}

      {details ? <StepDetailsDialog order={details.order} op={details.op} planIds={planIdsOf(details.order)} onClose={() => setDetails(null)} /> : null}

      <QrScanDialog open={scanOpen} onClose={() => setScanOpen(false)} onResult={onScan} />

      <Dialog open={operatorDialog} onClose={() => setOperatorDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          Quem está trabalhando?
          <Typography variant="body2" color="text.secondary">
            {projectFilter ? `Equipe do projeto ${data.projects.find((p) => p.id === projectFilter)?.name ?? ''}` : 'Equipe dos projetos em produção'} · toque no seu nome
          </Typography>
        </DialogTitle>
        <DialogContent>
          {operatorOptions.some((o) => o.team) ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 1.25, mb: 2 }}>
              {operatorOptions
                .filter((o) => o.team)
                .map((o) => (
                  <Button
                    key={o.id}
                    variant={operator?.id === o.id ? 'contained' : 'outlined'}
                    color="inherit"
                    onClick={() => void confirmOperator(o.id)}
                    sx={{ py: 1.5, flexDirection: 'column', gap: 0.75, textTransform: 'none', borderColor: colors.border }}
                  >
                    <UserAvatar user={{ id: o.id, name: o.name, photoFileId: o.photoFileId ?? null }} size={44} />
                    <Typography variant="subtitle2" sx={{ lineHeight: 1.2 }}>
                      {o.name}
                    </Typography>
                    {o.position ? (
                      <Typography variant="caption" color="text.secondary">
                        {o.position}
                      </Typography>
                    ) : null}
                  </Button>
                ))}
            </Box>
          ) : (
            <Typography color="text.secondary" sx={{ mb: 2 }}>
              {operatorOptions.length || !operatorDialog
                ? 'Ninguém na equipe deste projeto ainda. Inclua as pessoas em Projetos → editar projeto → Equipe do projeto.'
                : 'Carregando a equipe…'}
            </Typography>
          )}

          {operatorOptions.some((o) => !o.team && o.hasPin) ? (
            <Box sx={{ pt: 1.5, borderTop: `1px solid ${colors.border}` }}>
              <Typography variant="overline" color="text.secondary">
                Outra pessoa (com PIN)
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 0.5 }}>
                <TextField select size="small" label="Pessoa" value={operatorPick} onChange={(e) => setOperatorPick(e.target.value)} sx={{ flex: 1 }}>
                  {operatorOptions
                    .filter((o) => !o.team && o.hasPin)
                    .map((o) => (
                      <MenuItem key={o.id} value={o.id}>
                        {o.name}
                        {o.position ? ` · ${o.position}` : ''}
                      </MenuItem>
                    ))}
                </TextField>
                <TextField
                  size="small"
                  label="PIN"
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) => e.key === 'Enter' && operatorPick && pin.length >= 4 && confirmOperator()}
                  slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'off' } }}
                  sx={{ width: { sm: 120 } }}
                />
                <Button variant="contained" onClick={() => void confirmOperator()} disabled={!operatorPick || pin.length < 4}>
                  Entrar
                </Button>
              </Stack>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setOperatorDialog(false)}>
            Fechar
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
