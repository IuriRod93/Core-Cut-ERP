import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyOperationAction, forgottenTimers, nextWallTime, runningOperationsOf } from '../lib/shopfloor.mjs'
import { labelCode, parseLabelCode, productivity, resolveScan, stopsByReason } from '../../src/domain/shopfloor.ts'
import { stopServer } from './helpers.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = 7100 + Math.floor(Math.random() * 300) // faixa só deste arquivo (outros testes usam 4300–7000)
const base = `http://127.0.0.1:${port}/api`
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-shopfloor-'))
let child
let token

const call = async (method, path, { body, headers = {} } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* vazio */
  }
  return { status: res.status, json }
}

const user = { id: 'u1', name: 'Marcos' }
const T0 = Date.parse('2026-10-20T08:00:00Z')
const makeOrder = (overrides = {}) => ({
  id: 'o1',
  code: 'OP-1',
  status: 'liberada',
  items: [{ id: 'i1', name: 'Armário', quantity: 4 }],
  operations: ['Corte', 'Coladeira'].map((name, i) => ({ id: `op-${i}`, workCenterId: `wc-${i}`, name, order: i + 1, plannedMinutes: 30, actualSeconds: 0, status: 'pendente', runningSince: null, quantityDone: 0 })),
  ...overrides,
})
const withOps = (order, result) => ({ ...order, operations: result.operations, status: result.status ?? order.status })

test('regras do apontamento: tempo pelo relógio informado, roteiro, uma etapa por operador e quantidade', () => {
  let order = makeOrder()
  assert.throws(() => applyOperationAction(order, 'op-1', 'start', { user, now: T0 }), /Aguardando a etapa anterior/)
  assert.throws(() => applyOperationAction(order, 'op-0', 'finish', { user, now: T0 }), /Inicie a etapa/)
  assert.throws(() => applyOperationAction(order, 'op-0', 'start', { user, now: T0, running: [{ orderId: 'x', opId: 'y', label: 'OP-9 · Montagem' }] }), /OP-9 · Montagem/)

  let r = applyOperationAction(order, 'op-0', 'start', { user, now: T0 })
  assert.equal(r.status, 'em_producao')
  order = withOps(order, r)
  assert.equal(order.operations[0].operatorId, 'u1')
  assert.ok(applyOperationAction(order, 'op-0', 'start', { user, now: T0 }).unchanged)

  assert.throws(() => applyOperationAction(order, 'op-0', 'pause', { user, now: T0 + 600_000 }), /motivo da pausa/)
  r = applyOperationAction(order, 'op-0', 'pause', { user, now: T0 + 600_000, reason: 'falta_material', note: 'Sem fita branca' })
  order = withOps(order, r)
  assert.equal(order.operations[0].actualSeconds, 600)
  assert.deepEqual(order.operations[0].pauses.map((p) => [p.reason, p.end, p.note]), [['falta_material', null, 'Sem fita branca']])
  assert.equal(order.operations[0].segments[0].seconds, 600)
  assert.throws(() => applyOperationAction(order, 'op-0', 'pause', { user, now: T0, reason: 'ajuste' }), /não está em andamento/)

  // outra pessoa retoma: a pausa fecha (100 s) e o trecho seguinte é dela
  order = withOps(order, applyOperationAction(order, 'op-0', 'start', { user: { id: 'u2', name: 'Ana' }, now: T0 + 700_000 }))
  assert.equal(order.operations[0].pauses[0].seconds, 100)
  assert.throws(() => applyOperationAction(order, 'op-0', 'finish', { user, now: T0 + 760_000, quantity: 5 }), /não pode passar do total/)
  assert.throws(() => applyOperationAction(order, 'op-0', 'finish', { user, now: T0 + 760_000, quantity: 1.5 }), /número inteiro/)
  r = applyOperationAction(order, 'op-0', 'finish', { user, now: T0 + 760_000 })
  assert.equal(r.finished, false)
  order = withOps(order, r)
  assert.equal(order.operations[0].actualSeconds, 660)
  assert.equal(order.operations[0].quantityDone, 4)
  assert.deepEqual(order.operations[0].segments.map((s) => [s.operatorName, s.seconds]), [['Marcos', 600], ['Ana', 60]])

  // previsto (30 min) repartido na proporção do tempo de cada operador
  const lines = productivity([order], (id) => (id === 'wc-0' ? 'Corte' : ''), { from: '2026-10-01', to: '2026-10-31' })
  const corte = lines.find((l) => l.kind === 'setor')
  assert.deepEqual([corte.name, corte.steps, corte.plannedSeconds, corte.actualSeconds], ['Corte', 1, 1800, 660])
  const marcos = lines.find((l) => l.name === 'Marcos')
  assert.equal(Math.round(marcos.plannedSeconds), Math.round((1800 * 600) / 660))
  assert.equal(lines.find((l) => l.name === 'Ana').actualSeconds, 60)
  assert.equal(productivity([order], () => 'Corte', { from: '2026-11-01', to: '2026-11-30' }).length, 0)

  const stops = stopsByReason([order], () => 'Corte', { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(stops.map((x) => [x.reason, x.count, x.seconds, x.planned, x.topSector]), [['falta_material', 1, 100, false, 'Corte']])
  assert.throws(() => applyOperationAction(order, 'op-0', 'start', { user, now: T0 }), /já foi concluída/)

  assert.throws(() => applyOperationAction({ ...order, status: 'planejada' }, 'op-1', 'start', { user, now: T0 }), /liberada ou em produção/)
  assert.deepEqual(runningOperationsOf([order], 'u1'), [])
})

before(async () => {
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir, ARCOPLAN_SCHEDULER_MS: '0' },
    stdio: 'pipe',
  })
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const login = await call('POST', '/auth/login', { body: { login: 'admin', password: 'arcoplan123' } })
  token = login.json.token
  assert.equal((await call('POST', '/auth/change-password', { body: { currentPassword: 'arcoplan123', newPassword: 'Senha-Forte-123' } })).status, 200)
})

after(async () => {
  await stopServer(child)
  rmSync(dataDir, { recursive: true, force: true })
})

test('chão de fábrica: concluir a última etapa leva a ordem para a qualidade e operadores não se sobrescrevem', async () => {
  const { id, code, ...draft } = makeOrder({ status: 'planejada' })
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'Armário', priority: 'media', ...draft } })).json
  assert.equal((await call('POST', `/production-orders/${order.id}/release`)).status, 200)
  const path = (opId, action) => `/production-orders/${order.id}/operations/${opId}/${action}`

  assert.equal((await call('POST', path('op-1', 'start'))).status, 409)
  const started = await call('POST', path('op-0', 'start'))
  assert.equal(started.status, 200, JSON.stringify(started.json))
  assert.equal(started.json.productionOrder.status, 'em_producao')

  assert.equal((await call('POST', path('op-0', 'pause'), { body: {} })).status, 400)
  const paused = await call('POST', path('op-0', 'pause'), { body: { reason: 'maquina_parada', note: 'Serra sem fio' } })
  assert.equal(paused.status, 200, JSON.stringify(paused.json))
  assert.equal(paused.json.productionOrder.operations[0].pauses[0].reason, 'maquina_parada')
  assert.equal((await call('POST', path('op-0', 'start'))).status, 200)

  // outro cliente grava uma cópia antiga da ordem só com observações: o apontamento continua lá
  await call('PUT', `/data/productionOrders/${order.id}`, { body: { notes: 'Conferir puxadores' } })
  const done0 = await call('POST', path('op-0', 'finish'), { body: { quantity: 4 } })
  assert.equal(done0.status, 200, JSON.stringify(done0.json))
  assert.equal(done0.json.inspection, null)

  assert.equal((await call('POST', path('op-1', 'start'))).status, 200)
  const done1 = await call('POST', path('op-1', 'finish'), { body: {} })
  assert.equal(done1.status, 200, JSON.stringify(done1.json))
  assert.equal(done1.json.productionOrder.status, 'qualidade')
  assert.equal(done1.json.productionOrder.qualityStatus, 'pending')
  assert.equal(done1.json.inspection.status, 'pending')
  assert.ok(done1.json.productionOrder.operations.every((op) => op.status === 'concluida'))

  assert.equal((await call('POST', path('op-1', 'pause'))).status, 409)
  assert.equal((await call('POST', path('op-0', 'restart'))).status, 404)
})

test('leitura: link da etiqueta acha a ordem pelo plano (ou pelo projeto) e o código da OP é aceito', () => {
  const orders = [
    { id: 'a', code: 'OP-2026-0001', status: 'em_producao', projectId: 'p1', cutPlanIds: ['pl1'], items: [], operations: [] },
    { id: 'b', code: 'OP-2026-0002', status: 'liberada', projectId: 'p2', cutPlanIds: [], items: [], operations: [] },
    { id: 'c', code: 'OP-2026-0003', status: 'concluida', projectId: 'p2', cutPlanIds: [], items: [], operations: [] },
  ]
  const plans = [{ id: 'pl1', projectId: 'p1', code: 'PLC-1' }, { id: 'pl2', projectId: 'p2', code: 'PLC-2' }, { id: 'pl3', code: 'PLC-3' }]
  assert.deepEqual(resolveScan('https://x.com/plano-de-corte?plano=pl1&peca=z&un=1', orders, plans).orderIds, ['a'])
  assert.deepEqual(resolveScan('https://x.com/plano-de-corte?plano=pl2&peca=z&un=1', orders, plans).orderIds, ['b'])
  assert.equal(resolveScan('https://x.com/plano-de-corte?plano=pl3', orders, plans).kind, 'none')
  assert.deepEqual(resolveScan(' op-2026-0002 ', orders, plans).orderIds, ['b'])
  assert.equal(resolveScan('OP-2026-0003', orders, plans).kind, 'none')
  assert.deepEqual(resolveScan('PLC-1', orders, plans).orderIds, ['a'])
})

test('PIN do operador: hash nunca sai do servidor, PIN errado é recusado e o apontamento vai para o operador', async () => {
  const created = await call('POST', '/data/users', { body: { name: 'Joana Corte', email: 'joana@fabrica.test', role: 'producao', password: 'Fabrica-Forte-9', shopfloorPin: '4821' } })
  assert.equal(created.status, 201, JSON.stringify(created.json))
  assert.equal(created.json.shopfloorPinHash, undefined)
  assert.equal(created.json.hasShopfloorPin, true)
  assert.equal((await call('POST', '/data/users', { body: { name: 'X', email: 'x@fabrica.test', role: 'producao', password: 'Fabrica-Forte-9', shopfloorPin: '12a' } })).status, 400)
  assert.ok((await call('GET', '/data/users')).json.every((u) => u.shopfloorPinHash === undefined))

  const operators = (await call('GET', '/shopfloor/operators')).json
  assert.ok(operators.some((o) => o.id === created.json.id && o.hasPin))
  assert.equal((await call('POST', '/shopfloor/operator', { body: { userId: created.json.id, pin: '0000' } })).status, 401)
  const ok = await call('POST', '/shopfloor/operator', { body: { userId: created.json.id, pin: '4821' } })
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.equal(ok.json.operator.name, 'Joana Corte')

  const { id, code, ...draft } = makeOrder({ status: 'planejada' })
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'Gaveteiro', priority: 'media', ...draft } })).json
  await call('POST', `/production-orders/${order.id}/release`)
  const bad = await call('POST', `/production-orders/${order.id}/operations/op-0/start`, { headers: { 'X-Operator': 'invalido' } })
  assert.equal(bad.status, 409)
  const started = await call('POST', `/production-orders/${order.id}/operations/op-0/start`, { headers: { 'X-Operator': ok.json.ticket } })
  assert.equal(started.status, 200, JSON.stringify(started.json))
  const op = started.json.productionOrder.operations.find((o) => o.id === 'op-0')
  assert.equal(op.operatorId, created.json.id)
  assert.equal(op.operatorName, 'Joana Corte')

  // Sair: o tíquete deixa de valer; remover o PIN impede nova identificação
  assert.equal((await call('DELETE', '/shopfloor/operator', { headers: { 'X-Operator': ok.json.ticket } })).status, 200)
  assert.equal((await call('POST', `/production-orders/${order.id}/operations/op-0/pause`, { body: { reason: 'intervalo' }, headers: { 'X-Operator': ok.json.ticket } })).status, 409)
  const removed = await call('PUT', `/data/users/${created.json.id}`, { body: { shopfloorPin: '' } })
  assert.equal(removed.json.hasShopfloorPin, false)
  assert.equal((await call('POST', '/shopfloor/operator', { body: { userId: created.json.id, pin: '4821' } })).status, 401)
})

test('ao vivo: o canal avisa só o nome da coleção alterada, sem dados', async () => {
  const anon = await fetch(`${base}/events`)
  assert.equal(anon.status, 401)
  await anon.text()

  const abort = new AbortController()
  const res = await fetch(`${base}/events`, { headers: { Authorization: `Bearer ${token}` }, signal: abort.signal })
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/event-stream/)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  const messages = []
  const until = async (fn) => {
    let buffer = ''
    while (!fn()) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const line = buffer.slice(0, cut).split('\n').find((l) => l.startsWith('data: '))
        buffer = buffer.slice(cut + 2)
        if (line) messages.push(JSON.parse(line.slice(6)))
      }
    }
  }
  await until(() => messages.some((m) => m.hello))
  await call('POST', '/data/clients', { body: { name: 'Cliente ao vivo' } })
  await until(() => messages.some((m) => m.changed))
  const changed = messages.find((m) => m.changed)
  assert.ok(changed.changed.includes('clients'))
  assert.deepEqual(Object.keys(changed), ['changed'])
  abort.abort()
})

test('roteiro de fábrica de ponta a ponta: orçamento aprovado → ordem → apontamentos → qualidade → concluída', async () => {
  // setores e ficha técnica com roteiro
  const corte = (await call('POST', '/data/workCenters', { body: { name: 'Corte E2E', active: true, order: 1, hourlyCost: 60 } })).json
  const montagem = (await call('POST', '/data/workCenters', { body: { name: 'Montagem E2E', active: true, order: 2, hourlyCost: 50 } })).json
  const bom = (await call('POST', '/data/boms', { body: { name: 'Armário E2E', category: 'outro', parts: [], hardware: [], routing: [{ workCenterId: corte.id, minutes: 20 }, { workCenterId: montagem.id, minutes: 30 }], active: true } })).json
  const client = (await call('POST', '/data/clients', { body: { name: 'Cliente E2E', email: 'cliente@e2e.test' } })).json
  const budget = (await call('POST', '/data/budgets', { body: { title: 'Armário da lavanderia', clientId: client.id, status: 'enviado', marginPercent: 30, items: [{ id: 'b1', bomId: bom.id, description: 'Armário E2E', quantity: 2, unitCost: 500 }] } })).json

  // aprovação cria o projeto e a ordem planejada com uma etapa por setor do roteiro (× quantidade)
  const approved = await call('POST', `/budgets/${budget.id}/approve`, { body: {} })
  assert.equal(approved.status, 200, JSON.stringify(approved.json))
  const order = approved.json.productionOrder
  assert.equal(order.status, 'planejada')
  assert.deepEqual(order.operations.map((o) => [o.workCenterId, o.plannedMinutes]), [[corte.id, 40], [montagem.id, 60]])
  const [op1, op2] = order.operations
  const path = (opId, action) => `/production-orders/${order.id}/operations/${opId}/${action}`

  // sem liberar, o chão de fábrica não aponta
  assert.equal((await call('POST', path(op1.id, 'start'))).status, 409)
  assert.equal((await call('POST', `/production-orders/${order.id}/release`)).status, 200)

  // líder de PCP recebe o aviso de problema
  const pcp = (await call('POST', '/data/users', { body: { name: 'Paula PCP', email: 'paula@e2e.test', role: 'pcp', password: 'Fabrica-Forte-9' } })).json

  // corte: inicia, para por falta de material, retoma, registra problema e conclui
  assert.equal((await call('POST', path(op1.id, 'start'))).status, 200)
  assert.equal((await call('POST', path(op1.id, 'pause'), { body: { reason: 'falta_material' } })).status, 200)
  assert.equal((await call('POST', path(op1.id, 'start'))).status, 200)
  const issue = await call('POST', '/data/qualityRecords', { body: { title: 'Retrabalho em Corte E2E', kind: 'retrabalho', severity: 'media', status: 'aberta', productionOrderId: order.id, projectId: order.projectId, workCenterId: corte.id, description: 'Lascou a borda' } })
  assert.equal(issue.status, 201, JSON.stringify(issue.json))
  assert.equal((await call('POST', path(op1.id, 'finish'), { body: { quantity: 2 } })).status, 200)

  // montagem: conclui e a ordem vai sozinha para a qualidade
  assert.equal((await call('POST', path(op2.id, 'start'))).status, 200)
  const last = await call('POST', path(op2.id, 'finish'), { body: { quantity: 2 } })
  assert.equal(last.json.productionOrder.status, 'qualidade')

  // tarefas do projeto acompanham o chão de fábrica
  const tasks = (await call('GET', '/data/tasks')).json.filter((t) => t.productionOrderId === order.id)
  assert.equal(tasks.length, 3)
  assert.ok(tasks.filter((t) => t.parentId).every((t) => t.status === 'done'))

  // qualidade aprova e a ordem é concluída
  const ok = await call('POST', `/production-orders/${order.id}/quality/approve`, { body: {} })
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.equal(ok.json.productionOrder.status, 'concluida')

  // a entrega já nasce agendada (dia útil a partir de amanhã), o projeto vai para expedição
  const delivery = ok.json.delivery
  assert.ok(delivery, 'entrega não foi agendada')
  assert.equal(delivery.kind, 'entrega')
  assert.equal(delivery.status, 'agendada')
  assert.equal(delivery.productionOrderId, order.id)
  assert.equal(delivery.clientId, client.id)
  assert.ok(delivery.date > new Date().toISOString().slice(0, 10))
  assert.ok(![0, 6].includes(new Date(`${delivery.date}T12:00:00`).getDay()), 'entrega caiu no fim de semana')
  assert.equal(delivery.checklist.length, 3)
  assert.equal((await call('GET', `/data/projects/${order.projectId}`)).json.stageId, 'expedicao')
  // aprovar de novo não duplica a entrega
  assert.equal((await call('GET', '/data/installations')).json.filter((i) => i.productionOrderId === order.id).length, 1)

  // relatórios: previsto x realizado e paradas
  const saved = (await call('GET', `/data/productionOrders/${order.id}`)).json
  const today = new Date().toISOString().slice(0, 10)
  const names = new Map([[corte.id, 'Corte E2E'], [montagem.id, 'Montagem E2E']])
  const lines = productivity([saved], (id) => names.get(id) ?? '', { from: today, to: today })
  assert.deepEqual(lines.filter((l) => l.kind === 'setor').map((l) => [l.name, l.steps, l.plannedSeconds]).sort(), [['Corte E2E', 1, 2400], ['Montagem E2E', 1, 3600]])
  assert.equal(stopsByReason([saved], (id) => names.get(id) ?? '', { from: today, to: today })[0].reason, 'falta_material')

  // aviso do problema chegou para a Paula (PCP)
  const login = await call('POST', '/auth/login', { body: { login: 'paula@e2e.test', password: 'Fabrica-Forte-9' } })
  const paulaToken = login.json.token
  const asPaula = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { Authorization: `Bearer ${paulaToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    return r.json()
  }
  await asPaula('POST', '/auth/change-password', { currentPassword: 'Fabrica-Forte-9', newPassword: 'Serra-Coladeira-77' })
  const notes = await asPaula('GET', '/notifications')
  assert.ok(notes.items.some((n) => n.userId === pcp.id && n.kind === 'quality' && /Lascou a borda/.test(n.body)), JSON.stringify(notes).slice(0, 300))
  assert.ok(notes.items.some((n) => n.title === 'Entrega para agendar'), 'PCP não foi avisado da entrega')
})

test('cronômetro esquecido: corte no fim do expediente (no fuso da empresa) ou no limite de horas', () => {
  const tz = 'America/Sao_Paulo' // UTC-3
  const at = (iso) => Date.parse(iso)
  // começou 16:00 em SP (19:00 UTC); fim do expediente 18:00 SP = 21:00 UTC no mesmo dia
  assert.equal(new Date(nextWallTime(at('2026-10-20T19:00:00Z'), '18:00', tz)).toISOString(), '2026-10-20T21:00:00.000Z')
  // começou 19:30 em SP: o próximo 18:00 é no dia seguinte
  assert.equal(new Date(nextWallTime(at('2026-10-20T22:30:00Z'), '18:00', tz)).toISOString(), '2026-10-21T21:00:00.000Z')

  const running = (since) => ({ id: 'o', code: 'OP-1', status: 'em_producao', items: [], operations: [{ id: 'a', order: 1, status: 'em_andamento', runningSince: since, actualSeconds: 0, plannedMinutes: 10 }] })
  const order = running('2026-10-20T19:00:00Z')
  assert.equal(forgottenTimers([order], { shiftEnd: '18:00', maxRunHours: 10, timeZone: tz }, at('2026-10-20T20:59:00Z')).length, 0)
  const [cut] = forgottenTimers([order], { shiftEnd: '18:00', maxRunHours: 10, timeZone: tz }, at('2026-10-21T08:00:00Z'))
  assert.deepEqual([cut.reason, new Date(cut.at).toISOString()], ['fim_turno', '2026-10-20T21:00:00.000Z'])
  // sem expediente configurado: vale o limite de horas
  const [byLimit] = forgottenTimers([order], { shiftEnd: '', maxRunHours: 10, timeZone: tz }, at('2026-10-21T08:00:00Z'))
  assert.deepEqual([byLimit.reason, new Date(byLimit.at).toISOString()], ['outro', '2026-10-21T05:00:00.000Z'])
  assert.equal(forgottenTimers([order], { shiftEnd: '', maxRunHours: 0, timeZone: tz }, at('2026-10-25T08:00:00Z')).length, 0)
})

test('agendador pausa a etapa esquecida no horário do corte e avisa o operador', async () => {
  const { id, code, ...draft } = makeOrder({ status: 'planejada' })
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'Esquecida', priority: 'media', ...draft } })).json
  await call('POST', `/production-orders/${order.id}/release`)
  const started = await call('POST', `/production-orders/${order.id}/operations/op-0/start`)
  assert.equal(started.status, 200, JSON.stringify(started.json))
  const since = Date.parse(started.json.productionOrder.operations[0].runningSince)

  const run = await call('POST', '/admin/scheduler/run', { body: { now: new Date(since + 11 * 3_600_000).toISOString() } })
  assert.equal(run.status, 200, JSON.stringify(run.json))
  assert.ok(run.json.autoPaused >= 1)
  const op = (await call('GET', `/data/productionOrders/${order.id}`)).json.operations[0]
  assert.equal(op.status, 'pausada')
  assert.equal(op.actualSeconds, 10 * 3600) // conta só até o limite de 10 h, não as 11 h
  assert.match(op.pauses.at(-1).note, /Pausa automática/)
  const notes = (await call('GET', '/notifications')).json.items
  assert.ok(notes.some((n) => n.kind === 'shopfloor' && n.body.includes('OP')))
})

test('etiquetas: a etapa avança peça por peça; só etiquetas dos planos da ordem e com a etapa iniciada', async () => {
  const pieces = [
    { id: 'lat', label: 'Lateral', length: 720, width: 560, quantity: 2, rotate: false },
    { id: 'base', label: 'Base', length: 764, width: 560, quantity: 1, rotate: false },
  ]
  const plan = (await call('POST', '/data/cutPlans', { body: { title: 'Plano etiquetas', status: 'rascunho', pieces, groups: [] } })).json
  const { id, code, ...draft } = makeOrder({ status: 'planejada', cutPlanIds: [plan.id] })
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'Etiquetas', priority: 'media', ...draft } })).json
  await call('POST', `/production-orders/${order.id}/release`)
  const marks = (opId, keys, done = true) => call('POST', `/production-orders/${order.id}/operations/${opId}/pieces`, { body: { keys, done } })
  const k = (pieceId, n) => `${plan.id}:${pieceId}:${n}`

  assert.equal((await marks('op-0', [k('lat', 1)])).status, 409) // etapa não iniciada
  assert.equal((await call('POST', `/production-orders/${order.id}/operations/op-0/start`)).status, 200)
  assert.equal((await marks('op-0', [k('lat', 3)])).status, 400) // a lateral só tem 2 unidades
  assert.equal((await marks('op-0', ['outro-plano:lat:1'])).status, 400)

  let r = await marks('op-0', [k('lat', 1), k('lat', 2)])
  assert.equal(r.status, 200, JSON.stringify(r.json))
  assert.deepEqual([r.json.done, r.json.total], [2, 3])
  r = await marks('op-0', [k('lat', 2)], false)
  assert.deepEqual([r.json.done, r.json.total], [1, 3])
  r = await marks('op-0', [k('lat', 1), k('base', 1)]) // repetir não duplica
  assert.deepEqual(r.json.productionOrder.operations.find((o) => o.id === 'op-0').piecesDone.sort(), [k('base', 1), k('lat', 1)].sort())
})

test('leitura: o QR da etiqueta traz plano, peça e unidade', () => {
  const orders = [{ id: 'a', code: 'OP-1', status: 'em_producao', projectId: 'p1', cutPlanIds: ['pl1'], items: [], operations: [] }]
  const found = resolveScan('https://x.com/plano-de-corte?plano=pl1&peca=lat&un=2', orders, [{ id: 'pl1', projectId: 'p1' }])
  assert.deepEqual(found.unit, { planId: 'pl1', pieceId: 'lat', n: 2 })
  assert.equal(resolveScan('OP-1', orders, []).unit, undefined)
})

test('código curto da etiqueta: impresso como PLANO-peça-unidade e aceito no campo de leitura', () => {
  const plans = [{ id: 'pl1', projectId: 'p1', code: 'PLC-2026-0004' }]
  const orders = [{ id: 'a', code: 'OP-2026-0001', status: 'em_producao', projectId: 'p1', cutPlanIds: ['pl1'], items: [], operations: [] }]
  assert.equal(labelCode('PLC-2026-0004', 11, 2), 'PLC-2026-0004-12-2')
  assert.deepEqual(parseLabelCode(' plc-2026-0004-12-2 ', plans), { planId: 'pl1', pieceIndex: 11, n: 2 })
  assert.equal(parseLabelCode('PLC-2026-9999-1-1', plans), null)
  const found = resolveScan('PLC-2026-0004-12-2', orders, plans)
  assert.deepEqual([found.kind, found.orderIds, found.unitRef], ['orders', ['a'], { planId: 'pl1', pieceIndex: 11, n: 2 }])
  // o código do plano sozinho continua achando a ordem (sem marcar peça)
  const plan = resolveScan('PLC-2026-0004', orders, plans)
  assert.deepEqual([plan.orderIds, plan.unitRef, plan.unit], [['a'], undefined, undefined])
})

test('operador da equipe do projeto entra com um toque; fora da equipe precisa do PIN', async () => {
  const member = (await call('POST', '/data/users', { body: { name: 'Carlos Montador', email: 'carlos@fabrica.test', role: 'projetista', password: 'Fabrica-Forte-9' } })).json
  const outsider = (await call('POST', '/data/users', { body: { name: 'Rita Fora', email: 'rita@fabrica.test', role: 'producao', password: 'Fabrica-Forte-9' } })).json
  const project = (await call('POST', '/data/projects', { body: { name: 'Projeto equipe', status: 'producao', memberIds: [member.id] } })).json
  const { id, code, ...draft } = makeOrder({ status: 'planejada', projectId: project.id })
  await call('POST', '/data/productionOrders', { body: { title: 'Equipe', priority: 'media', ...draft } })

  const team = (await call('GET', `/shopfloor/operators?projeto=${project.id}`)).json
  assert.ok(team.some((o) => o.id === member.id && o.team))
  assert.ok(!team.some((o) => o.id === outsider.id && o.team))

  const ok = await call('POST', '/shopfloor/operator', { body: { userId: member.id, projectId: project.id } })
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.equal(ok.json.operator.name, 'Carlos Montador')
  assert.equal((await call('POST', '/shopfloor/operator', { body: { userId: outsider.id } })).status, 403)
})

test('estoque pelo plano de corte: reserva as chapas do plano, baixa ao concluir o corte e aponta a falta', async () => {
  const mdf = (await call('POST', '/data/materials', { body: { name: 'MDF Branco 18 mm (teste plano)', category: 'chapa', unit: 'chapa', cost: 300, stock: 5, sheetWidth: 2750, sheetHeight: 1850, active: true } })).json
  const fita = (await call('POST', '/data/materials', { body: { name: 'Fita branca 22 mm (teste plano)', category: 'fita_borda', unit: 'm', cost: 1, stock: 100, active: true } })).json
  const sheet = { index: 1, placements: [] }
  const plan = (await call('POST', '/data/cutPlans', {
    body: {
      title: 'Plano estoque',
      status: 'aprovado',
      edgeMaterialId: fita.id,
      // 1 m de lateral com fita nos 2 lados compridos = 2 m por unidade × 4 unidades = 8 m (+10% = 9)
      pieces: [{ id: 'lat', label: 'Lateral', length: 1000, width: 500, quantity: 4, rotate: false, edgeTop: true, edgeBottom: true }],
      groups: [
        { key: 'mdf', materialId: mdf.id, materialName: mdf.name, thickness: 18, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 300, sheets: [sheet, sheet, sheet], unplaced: [], utilization: 80, cost: 900 },
        { key: 'retalho', materialId: mdf.id, materialName: 'retalho', thickness: 18, sheetWidth: 800, sheetHeight: 600, sheetCost: 0, sheets: [sheet], unplaced: [], utilization: 50, cost: 0, offcutId: 'ret-1' },
      ],
      hardware: [],
    },
  })).json
  const ops = ['Corte (seccionadora)', 'Montagem'].map((name, i) => ({ id: `st-${i}`, workCenterId: `wc-${i}`, name, order: i + 1, plannedMinutes: 10, actualSeconds: 0, status: 'pendente', runningSince: null, quantityDone: 0 }))
  // operador próprio (equipe do projeto), para não esbarrar em etapas abertas de outros testes
  const cutter = (await call('POST', '/data/users', { body: { name: 'Beto Corte', email: 'beto@fabrica.test', role: 'producao', password: 'Fabrica-Forte-9' } })).json
  const project = (await call('POST', '/data/projects', { body: { name: 'Projeto estoque', status: 'producao', memberIds: [cutter.id] } })).json
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'Estoque', projectId: project.id, status: 'planejada', priority: 'media', items: [], operations: ops, cutPlanIds: [plan.id] } })).json
  const ticket = (await call('POST', '/shopfloor/operator', { body: { userId: cutter.id, projectId: project.id } })).json.ticket
  const asCutter = { headers: { 'X-Operator': ticket } }

  const released = await call('POST', `/production-orders/${order.id}/release`)
  assert.equal(released.status, 200, JSON.stringify(released.json))
  const qty = (id) => released.json.reservations.find((r) => r.materialId === id)?.quantity
  assert.equal(qty(mdf.id), 3) // 3 chapas novas; o retalho não conta
  assert.equal(qty(fita.id), 9)

  // o corte termina: as chapas e a fita saem do estoque sozinhas
  const startCut = await call('POST', `/production-orders/${order.id}/operations/st-0/start`, asCutter)
  assert.equal(startCut.status, 200, JSON.stringify(startCut.json))
  const cut = await call('POST', `/production-orders/${order.id}/operations/st-0/finish`, { body: {}, ...asCutter })
  assert.equal(cut.status, 200, JSON.stringify(cut.json))
  assert.equal(cut.json.consumed, true)
  assert.equal(cut.json.productionOrder.materialsPosted, true)
  assert.equal((await call('GET', `/data/materials/${mdf.id}`)).json.stock, 2)
  assert.equal((await call('GET', `/data/materials/${fita.id}`)).json.stock, 91)

  // outra ordem do mesmo plano precisa de 3 chapas, mas só restam 2: a liberação recusa e a compra traz a falta
  const second = (await call('POST', '/data/productionOrders', { body: { title: 'Estoque 2', status: 'planejada', priority: 'media', items: [], operations: ops, cutPlanIds: [plan.id] } })).json
  const refused = await call('POST', `/production-orders/${second.id}/release`)
  assert.equal(refused.status, 409)
  assert.match(refused.json.error, /insuficiente/i)
  const purchase = await call('POST', `/production-orders/${second.id}/purchase`, { body: {} })
  assert.equal(purchase.status, 201, JSON.stringify(purchase.json))
  assert.deepEqual(purchase.json.shortages.map((s) => [s.materialId, s.quantity]), [[mdf.id, 1]])
})
