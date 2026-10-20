import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopServer } from './helpers.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = 4300 + Math.floor(Math.random() * 400)
const base = `http://127.0.0.1:${port}/api`
const dataDir = mkdtempSync(join(tmpdir(), 'arcoplan-test-'))
let child
let adminToken

const call = async (method, path, { body, token = adminToken, raw } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* binário */
  }
  return { status: res.status, json, text }
}

before(async () => {
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    // Os testes devem ser descartáveis e nunca podem alterar o PostgreSQL
    // configurado no .env do desenvolvedor.
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir },
    stdio: 'pipe',
  })
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/health`)
      if (r.ok) break
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  const login = await call('POST', '/auth/login', { body: { login: 'admin', password: 'arcoplan123' }, token: null })
  assert.equal(login.status, 200)
  adminToken = login.json.token
  assert.equal(login.json.user.passwordMustChange, true)
  // senha provisória deve ser trocada antes de qualquer outra coisa
  const blocked = await call('GET', '/data/clients')
  assert.equal(blocked.status, 403)
  const changed = await call('POST', '/auth/change-password', { body: { currentPassword: 'arcoplan123', newPassword: 'Senha-Forte-123' } })
  assert.equal(changed.status, 200)
})

after(async () => {
  await stopServer(child)
  rmSync(dataDir, { recursive: true, force: true })
})

test('exige autenticação e rejeita credenciais inválidas', async () => {
  assert.equal((await call('GET', '/data/clients', { token: null })).status, 401)
  const bad = await call('POST', '/auth/login', { body: { login: 'admin', password: 'errada' }, token: null })
  assert.equal(bad.status, 401)
})

test('CRUD genérico com código sequencial, auditoria e lixeira', async () => {
  const created = await call('POST', '/data/clients', { body: { name: 'Cliente Teste', type: 'PJ' } })
  assert.equal(created.status, 201)
  assert.match(created.json.code, /^CLI-\d{4}-0001$/)
  const second = await call('POST', '/data/clients', { body: { name: 'Outro' } })
  assert.match(second.json.code, /-0002$/)

  const updated = await call('PUT', `/data/clients/${created.json.id}`, { body: { phone: '(11) 99999-0000' } })
  assert.equal(updated.json.phone, '(11) 99999-0000')
  assert.equal(updated.json.name, 'Cliente Teste')

  const del = await call('DELETE', `/data/clients/${created.json.id}`)
  assert.equal(del.status, 200)
  assert.equal((await call('GET', `/data/clients/${created.json.id}`)).status, 404)

  const trash = await call('GET', '/data/trash')
  const entry = trash.json.find((t) => t.doc.id === created.json.id)
  assert.ok(entry)
  const restored = await call('POST', `/trash/${entry.id}/restore`)
  assert.equal(restored.status, 200)
  assert.equal((await call('GET', `/data/clients/${created.json.id}`)).status, 200)

  const logs = await call('GET', '/data/auditLogs')
  assert.ok(logs.json.some((l) => l.action === 'create' && l.collection === 'clients'))
})

test('excluir projeto remove tarefas em cascata e restaura da lixeira', async () => {
  const project = (await call('POST', '/data/projects', { body: { name: 'Cozinha Teste', status: 'briefing' } })).json
  const task = (await call('POST', '/data/tasks', { body: { projectId: project.id, title: 'Medir', status: 'todo' } })).json
  await call('DELETE', `/data/projects/${project.id}`)
  assert.equal((await call('GET', `/data/tasks/${task.id}`)).status, 404)
  const entry = (await call('GET', '/data/trash')).json.find((t) => t.doc.id === project.id)
  await call('POST', `/trash/${entry.id}/restore`)
  assert.equal((await call('GET', `/data/tasks/${task.id}`)).status, 200)
})

test('catálogo Leo Madeiras: busca sem acento, preços em reais e importação', async () => {
  const facets = await call('GET', '/catalog/leo/facets')
  assert.equal(facets.json.currency, 'BRL')
  assert.ok(facets.json.total > 5000)
  assert.equal(facets.json.supplier.name, 'Leo Madeiras')
  assert.ok(facets.json.supplier.id)

  const search = await call('GET', '/catalog/leo?q=artico%20branco&kind=chapa&priced=1')
  assert.equal(search.status, 200)
  assert.ok(search.json.total > 0)
  assert.equal(search.json.supplier.id, facets.json.supplier.id)
  const item = search.json.items[0]
  assert.equal(typeof item.price, 'number')

  const imp = await call('POST', '/catalog/leo/import', { body: { ids: [item.id, item.id] } })
  assert.equal(imp.json.created.length, 1)
  assert.equal(imp.json.created[0].cost, item.price)
  assert.equal(imp.json.created[0].priceSource, 'leo_madeiras')
  assert.equal(imp.json.created[0].supplierId, facets.json.supplier.id)
  assert.equal(imp.json.created[0].stock, 0)
  assert.equal(imp.json.initialStock, 0)
  const again = await call('POST', '/catalog/leo/import', { body: { ids: [item.id] } })
  assert.equal(again.json.created.length, 0)
  assert.equal(again.json.skipped.length, 1)

  const order = await call('POST', '/catalog/leo/purchase', { body: { items: [{ id: item.id, quantity: 4 }] } })
  assert.equal(order.status, 201)
  assert.equal(order.json.purchase.status, 'rascunho')
  assert.equal(order.json.purchase.supplierId, facets.json.supplier.id)
  assert.equal(order.json.purchase.items[0].materialId, imp.json.created[0].id)
  assert.equal(order.json.purchase.items[0].quantity, 4)
})

test('movimentação de estoque é atômica e impede saldo negativo', async () => {
  const mat = (await call('POST', '/data/materials', { body: { name: 'Parafuso 4x40', unit: 'un', cost: 0.1, stock: 0 } })).json
  const entry = await call('POST', '/inventory/movement', { body: { materialId: mat.id, type: 'entry', quantity: 100, reason: 'Teste' } })
  assert.equal(entry.json.stockAfter, 100)
  const exit = await call('POST', '/inventory/movement', { body: { materialId: mat.id, type: 'exit', quantity: 30 } })
  assert.equal(exit.json.stockAfter, 70)
  const over = await call('POST', '/inventory/movement', { body: { materialId: mat.id, type: 'exit', quantity: 500 } })
  assert.equal(over.status, 409)
  const stock = (await call('GET', `/data/materials/${mat.id}`)).json.stock
  assert.equal(stock, 70)
})

test('recebimento de compra lança entrada no estoque e fecha o pedido', async () => {
  const mat = (await call('POST', '/data/materials', { body: { name: 'Dobradiça 35mm', unit: 'un', cost: 2, stock: 0 } })).json
  const po = (
    await call('POST', '/data/purchases', {
      body: { status: 'pedido', items: [{ materialId: mat.id, description: mat.name, quantity: 50, unitCost: 2.5, received: 0 }] },
    })
  ).json
  const partial = await call('POST', `/purchases/${po.id}/receive`, { body: { lines: [{ index: 0, quantity: 20 }] } })
  assert.equal(partial.json.status, 'parcial')
  const done = await call('POST', `/purchases/${po.id}/receive`, { body: { lines: [{ index: 0, quantity: 30 }] } })
  assert.equal(done.json.status, 'recebido')
  const m = (await call('GET', `/data/materials/${mat.id}`)).json
  assert.equal(m.stock, 50)
  assert.equal(m.cost, 2.5)
})

test('usuários: sem hash de senha na resposta, permissão por perfil e último admin protegido', async () => {
  const created = await call('POST', '/data/users', {
    body: { name: 'Maria PCP', email: 'maria@arcoplan.com.br', role: 'pcp', password: 'Senha-Provisoria-1' },
  })
  assert.equal(created.status, 201)
  assert.equal(created.json.passwordHash, undefined)

  const login = await call('POST', '/auth/login', { body: { login: 'maria@arcoplan.com.br', password: 'Senha-Provisoria-1' }, token: null })
  assert.equal(login.status, 200)
  const ch = await call('POST', '/auth/change-password', {
    token: login.json.token,
    body: { currentPassword: 'Senha-Provisoria-1', newPassword: 'Outra-Senha-Forte-2' },
  })
  assert.equal(ch.status, 200)
  const maria = login.json.token

  // PCP não acessa financeiro nem configurações
  assert.equal((await call('GET', '/data/receivables', { token: maria })).status, 403)
  assert.equal((await call('GET', '/admin/backup', { token: maria })).status, 403)
  // mas lê dados de referência e grava em produção
  assert.equal((await call('GET', '/data/clients', { token: maria })).status, 200)
  assert.equal((await call('POST', '/data/productionOrders', { token: maria, body: { title: 'OP teste', status: 'planejada' } })).status, 201)

  const me = (await call('GET', '/data/users')).json.find((u) => u.role === 'admin')
  const selfDelete = await call('DELETE', `/data/users/${me.id}`)
  assert.equal(selfDelete.status, 400)
})

test('ponto: usuário comum vê apenas os próprios registros', async () => {
  const login = await call('POST', '/auth/login', { body: { login: 'maria', password: 'Outra-Senha-Forte-2' }, token: null })
  const maria = login.json.token
  await call('POST', '/data/timeclock', { token: maria, body: { type: 'entrada', at: new Date().toISOString() } })
  await call('POST', '/data/timeclock', { body: { type: 'entrada', at: new Date().toISOString() } })
  const mine = await call('GET', '/data/timeclock', { token: maria })
  assert.equal(mine.json.length, 1)
  const all = await call('GET', '/data/timeclock')
  assert.equal(all.json.length, 2)
})

test('upload e download de arquivo', async () => {
  const payload = Buffer.from('conteúdo do desenho técnico')
  const up = await fetch(`${base}/files/upload?name=${encodeURIComponent('desenho.txt')}&folder=Projetos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'text/plain' },
    body: payload,
  })
  assert.equal(up.status, 201)
  const meta = await up.json()
  assert.equal(meta.size, payload.length)
  const down = await fetch(`${base}/files/${meta.id}/download?token=${adminToken}`)
  assert.equal(down.status, 200)
  assert.equal(Buffer.from(await down.arrayBuffer()).toString('utf8'), 'conteúdo do desenho técnico')
})

test('dados de demonstração: carrega, é consistente e pode ser removido', async () => {
  const before = (await call('GET', '/data/clients')).json.length
  const load = await call('POST', '/admin/demo')
  assert.equal(load.status, 200)
  assert.ok(load.json.counts.projects >= 5)
  assert.ok(load.json.counts.tasks > 30)

  const projects = (await call('GET', '/data/projects')).json.filter((p) => p.demo)
  const tasks = (await call('GET', '/data/tasks')).json
  assert.ok(projects.every((p) => tasks.some((t) => t.projectId === p.id)))
  const boms = (await call('GET', '/data/boms')).json
  assert.ok(boms.every((b) => b.parts.length > 0 && b.routing.length > 0))
  const ops = (await call('GET', '/data/productionOrders')).json
  assert.ok(ops.some((o) => o.status === 'em_producao' && o.operations.some((x) => x.status === 'em_andamento')))
  const mats = (await call('GET', '/data/materials')).json
  assert.ok(mats.some((m) => m.priceSource === 'leo_madeiras' && m.cost > 0))
  const plans = (await call('GET', '/data/cutPlans?full=1')).json
  assert.ok(plans.length >= 1 && plans[0].groups.length > 0 && plans[0].costs.total > 0, 'plano de corte demo com custos')
  assert.ok(plans[0].pieces.some((p) => (p.machining ?? []).length > 0), 'plano com usinagens')
  const withPhoto = (await call('GET', '/data/users')).json.filter((u) => u.photoFileId)
  assert.ok(withPhoto.length >= 5, 'usuários demo com foto')
  const photo = await fetch(`${base}/files/${withPhoto[0].photoFileId}/download?token=${adminToken}&inline=1`)
  assert.equal(photo.status, 200)
  assert.match(photo.headers.get('content-disposition') ?? '', /^attachment/, 'SVG nunca é exibido inline')

  const clear = await call('DELETE', '/admin/demo')
  assert.equal(clear.status, 200)
  assert.equal((await call('GET', '/data/clients')).json.length, before)
  assert.equal((await call('GET', '/data/tasks')).json.filter((t) => t.demo).length, 0)
})

test('plano de corte: soma ao orçamento do projeto, gera solicitação e só perfis de aprovação decidem', async () => {
  const supplier = (await call('POST', '/data/suppliers', { body: { name: 'Leo Madeiras Teste', category: 'chapas', status: 'ativo' } })).json
  const mat = (await call('POST', '/data/materials', { body: { name: 'MDF Branco 18mm', category: 'chapa', unit: 'chapa', cost: 400, stock: 1, supplierId: supplier.id, thickness: 18, sheetWidth: 2750, sheetHeight: 1850 } })).json
  const edge = (await call('POST', '/data/materials', { body: { name: 'Fita Branca 22mm', category: 'fita_borda', unit: 'm', cost: 2, stock: 0, supplierId: supplier.id } })).json
  const project = (await call('POST', '/data/projects', { body: { name: 'Cozinha Orçamento', status: 'briefing' } })).json
  const sheet = (index) => ({ index, placements: [], usedArea: 0, utilization: 50 })
  const plan = (
    await call('POST', '/data/cutPlans', {
      body: {
        title: 'Plano teste',
        status: 'rascunho',
        projectId: project.id,
        edgeMaterialId: edge.id,
        pieces: [],
        hardware: [{ id: 'h1', description: 'Dobradiça caneco 35 mm', quantity: 4, unitCost: 3 }],
        groups: [{ key: 'g1', materialId: mat.id, materialName: mat.name, thickness: 18, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 400, sheets: [sheet(1), sheet(2)], unplaced: [], utilization: 50, cost: 800 }],
        costs: { sheets: 800, edge: 22, hardware: 12, machining: 30, total: 864, edgeMeters: 10, holes: 0, grooves: 0, minutes: 20 },
      },
    })
  ).json

  const sync = await call('POST', `/cut-plans/${plan.id}/sync-budget`)
  assert.equal(sync.status, 200)
  assert.equal(sync.json.created, true)
  assert.equal(sync.json.budget.projectId, project.id)
  assert.equal(sync.json.budget.items.length, 4)
  assert.ok(Math.abs(sync.json.cost - 864) < 0.02, `custo ${sync.json.cost}`)
  assert.ok(sync.json.budget.items.every((i) => i.cutPlanId === plan.id))
  // repetir não duplica: substitui os itens do plano
  const again = await call('POST', `/cut-plans/${plan.id}/sync-budget`)
  assert.equal(again.json.created, false)
  assert.equal(again.json.budget.id, sync.json.budget.id)
  assert.equal(again.json.budget.items.length, 4)

  // solicitação de compras agrupada por fornecedor, aguardando aprovação
  const req = await call('POST', `/cut-plans/${plan.id}/purchase-request`, {
    body: {
      items: [
        { materialId: mat.id, description: 'Chapa MDF Branco 18mm', unit: 'chapa', quantity: 1, unitCost: 400 },
        { materialId: edge.id, description: 'Fita Branca 22mm', unit: 'm', quantity: 11, unitCost: 2 },
      ],
    },
  })
  assert.equal(req.status, 201)
  assert.equal(req.json.purchases.length, 1)
  const po = req.json.purchases[0]
  assert.equal(po.status, 'solicitado')
  assert.equal(po.supplierId, supplier.id)
  assert.equal(po.cutPlanId, plan.id)
  assert.equal(po.projectId, project.id)
  assert.equal(po.items.length, 2)
  assert.equal((await call('POST', `/cut-plans/${plan.id}/purchase-request`, { body: { items: [] } })).status, 400)

  // PCP solicita, mas não aprova nem reprova
  const maria = (await call('POST', '/auth/login', { body: { login: 'maria', password: 'Outra-Senha-Forte-2' }, token: null })).json.token
  assert.equal((await call('POST', `/purchases/${po.id}/decision`, { token: maria, body: { decision: 'aprovar' } })).status, 403)
  assert.equal((await call('PUT', `/data/purchases/${po.id}`, { token: maria, body: { status: 'aprovado' } })).status, 403)

  // reprovação exige motivo; depois reabre e aprova
  assert.equal((await call('POST', `/purchases/${po.id}/decision`, { body: { decision: 'reprovar' } })).status, 400)
  const rej = await call('POST', `/purchases/${po.id}/decision`, { body: { decision: 'reprovar', reason: 'Fornecedor com prazo alto' } })
  assert.equal(rej.json.status, 'reprovado')
  assert.equal(rej.json.rejectedReason, 'Fornecedor com prazo alto')
  const reopened = await call('POST', `/purchases/${po.id}/decision`, { body: { decision: 'reabrir' } })
  assert.equal(reopened.json.status, 'rascunho')
  const approved = await call('POST', `/purchases/${po.id}/decision`, { body: { decision: 'aprovar' } })
  assert.equal(approved.json.status, 'aprovado')
  assert.ok(approved.json.decidedByName && approved.json.decidedAt)
  const logs = (await call('GET', '/data/auditLogs')).json
  assert.ok(logs.some((l) => l.action === 'approve' && l.collection === 'purchases'))
  assert.ok(logs.some((l) => l.action === 'reject' && l.collection === 'purchases'))
})

test('aprovação do orçamento integra projeto, produção e contas a receber', async () => {
  const client = (await call('POST', '/data/clients', { body: { name: 'Cliente Fluxo Comercial', type: 'PF' } })).json
  const budget = (await call('POST', '/data/budgets', {
    body: {
      title: 'Cozinha integrada',
      clientId: client.id,
      status: 'enviado',
      items: [{ id: 'item-fluxo', group: 'Cozinha', description: 'Módulo inferior', kind: 'modulo', unit: 'un', quantity: 1, unitCost: 900, unitPrice: 1800 }],
      marginPercent: 30,
      discountPercent: 0,
      taxPercent: 0,
      deliveryDays: 30,
    },
  })).json
  const approved = await call('POST', `/budgets/${budget.id}/approve`, { body: {} })
  assert.equal(approved.status, 200)
  assert.equal(approved.json.budget.status, 'aprovado')
  assert.equal(approved.json.project.clientId, client.id)
  assert.equal(approved.json.productionOrder.projectId, approved.json.project.id)
  assert.equal(approved.json.receivables.length, 2)
  assert.equal(approved.json.receivables.reduce((sum, entry) => sum + entry.amount, 0), 1800)

  const repeated = await call('POST', `/budgets/${budget.id}/approve`, { body: {} })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.json.project.id, approved.json.project.id)
  assert.equal(repeated.json.productionOrder.id, approved.json.productionOrder.id)
  assert.equal(repeated.json.receivables.length, 2)
})

test('agendador: notifica prazos, executa automações por atraso uma única vez e avisa menções', async () => {
  const users = (await call('GET', '/data/users')).json
  const maria = users.find((u) => u.email === 'maria@arcoplan.com.br')
  const mariaToken = (await call('POST', '/auth/login', { body: { login: 'maria', password: 'Outra-Senha-Forte-2' }, token: null })).json.token
  const automations = [
    { id: 'a1', name: 'Atrasada → urgente', enabled: true, trigger: { type: 'overdue', days: 1 }, actions: [{ type: 'set_priority', priority: 'urgente' }, { type: 'comment', text: 'Cobrar responsável' }, { type: 'create_subtasks', titles: ['Ligar para o cliente'] }] },
  ]
  const project = (await call('POST', '/data/projects', { body: { name: 'Agendador', status: 'briefing', automations } })).json
  const late = (await call('POST', '/data/tasks', { body: { projectId: project.id, title: 'Entregar ferragens', status: 'todo', priority: 'normal', dueDate: '2026-10-09', assigneeIds: [maria.id], order: 1 } })).json
  const soon = (await call('POST', '/data/tasks', { body: { projectId: project.id, title: 'Medir cozinha', status: 'todo', dueDate: '2026-10-11', assigneeIds: [maria.id], order: 2 } })).json
  const done = (await call('POST', '/data/tasks', { body: { projectId: project.id, title: 'Já feita', status: 'done', dueDate: '2026-10-09', completedAt: '2026-10-08T10:00:00Z', assigneeIds: [maria.id], order: 3 } })).json
  // só administradores executam o agendador manualmente
  assert.equal((await call('POST', '/admin/scheduler/run', { token: mariaToken, body: {} })).status, 403)

  const run1 = await call('POST', '/admin/scheduler/run', { body: { now: '2026-10-10T12:00:00' } })
  assert.equal(run1.status, 200)
  assert.equal(run1.json.automationsRun, 1)
  const t = (await call('GET', `/data/tasks/${late.id}`)).json
  assert.equal(t.priority, 'urgente')
  const tasks = (await call('GET', '/data/tasks')).json
  assert.ok(tasks.some((x) => x.parentId === late.id && x.title === 'Ligar para o cliente'))
  const comments = (await call('GET', '/data/taskComments')).json.filter((c) => c.taskId === late.id)
  assert.ok(comments.some((c) => /Atrasada → urgente/.test(c.body)))
  assert.ok(!tasks.find((x) => x.id === done.id).automationRuns)

  const mine = (await call('GET', '/notifications', { token: mariaToken })).json
  assert.ok(mine.items.some((n) => n.taskId === late.id && n.kind === 'overdue'))
  assert.ok(mine.items.some((n) => n.taskId === soon.id && n.kind === 'due' && /amanhã/.test(n.title)))
  assert.ok(!mine.items.some((n) => n.taskId === done.id && ['due', 'overdue'].includes(n.kind)), 'tarefa concluída não gera aviso de prazo')
  assert.ok(mine.items.some((n) => n.taskId === soon.id && n.kind === 'assigned'), 'atribuição notifica o responsável')
  // outro usuário não vê notificações da maria
  const adminView = (await call('GET', '/notifications')).json
  assert.ok(!adminView.items.some((n) => n.taskId === soon.id))

  // idempotente: segunda rodada no mesmo dia não repete nada
  const run2 = await call('POST', '/admin/scheduler/run', { body: { now: '2026-10-10T18:00:00' } })
  assert.equal(run2.json.notified, 0)
  assert.equal(run2.json.automationsRun, 0)

  // menção e atribuição geram notificação
  await call('POST', '/data/taskComments', { body: { taskId: soon.id, projectId: project.id, authorId: 'x', authorName: 'Admin', body: '@Maria confira a medida', kind: 'comment', mentions: [maria.id] } })
  const after = (await call('GET', '/notifications', { token: mariaToken })).json
  assert.ok(after.items.some((n) => n.kind === 'mention'))
  const unreadBefore = after.unread
  assert.ok(unreadBefore >= 3)
  const read = await call('POST', '/notifications/read', { token: mariaToken, body: { all: true } })
  assert.equal(read.json.changed, unreadBefore)
  assert.equal((await call('GET', '/notifications', { token: mariaToken })).json.unread, 0)
})

test('producao reserva materiais e consome uma unica vez', async () => {
  const material = (await call('POST', '/data/materials', { body: { name: 'Parafuso reserva', category: 'ferragem', unit: 'un', cost: 1, stock: 10, minStock: 0, active: true } })).json
  const bom = (await call('POST', '/data/boms', { body: { name: 'BOM reserva', category: 'outro', parts: [], hardware: [{ id: 'h1', materialId: material.id, description: material.name, quantity: 2 }], routing: [], active: true } })).json
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'OP reserva', status: 'planejada', priority: 'media', items: [{ id: 'item-1', bomId: bom.id, name: bom.name, quantity: 2 }], operations: [], materialsPosted: false } })).json

  const release = await call('POST', `/production-orders/${order.id}/release`)
  assert.equal(release.status, 200)
  assert.equal(release.json.productionOrder.status, 'liberada')
  assert.equal(release.json.reservations.length, 1)
  assert.equal(release.json.reservations[0].quantity, 4)
  assert.equal((await call('GET', `/data/materials/${material.id}`)).json.stock, 10)

  const repeated = await call('POST', `/production-orders/${order.id}/release`)
  assert.equal(repeated.status, 200)
  assert.equal(repeated.json.reservations.length, 1)

  const consumed = await call('POST', `/production-orders/${order.id}/consume`)
  assert.equal(consumed.status, 200)
  assert.equal(consumed.json.productionOrder.materialsPosted, true)
  assert.equal(consumed.json.reservations[0].status, 'consumed')
  assert.equal((await call('GET', `/data/materials/${material.id}`)).json.stock, 6)

  const cancelOrder = (await call('POST', '/data/productionOrders', { body: { title: 'OP cancelamento', status: 'planejada', priority: 'media', items: [{ id: 'item-2', bomId: bom.id, name: bom.name, quantity: 1 }], operations: [], materialsPosted: false } })).json
  await call('POST', `/production-orders/${cancelOrder.id}/release`)
  const cancelled = await call('PUT', `/data/productionOrders/${cancelOrder.id}`, { body: { status: 'cancelada' } })
  assert.equal(cancelled.status, 200)
  const releasedReservation = (await call('GET', '/data/inventoryReservations')).json.find((r) => r.productionOrderId === cancelOrder.id)
  assert.equal(releasedReservation.status, 'released')
})

test('qualidade cria inspeção, bloqueia conclusão direta e controla retrabalho', async () => {
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'OP qualidade', status: 'planejada', priority: 'media', items: [], operations: [] } })).json
  assert.equal((await call('POST', `/production-orders/${order.id}/release`)).status, 200)
  const started = await call('POST', `/production-orders/${order.id}/quality/start`)
  assert.equal(started.status, 200)
  assert.equal(started.json.inspection.status, 'pending')

  const direct = await call('PUT', `/data/productionOrders/${order.id}`, { body: { status: 'concluida' } })
  assert.equal(direct.status, 400)
  const rejected = await call('POST', `/production-orders/${order.id}/quality/reject`, { body: { notes: 'Aresta fora de esquadro.' } })
  assert.equal(rejected.status, 200)
  assert.equal(rejected.json.productionOrder.status, 'em_producao')
  assert.equal(rejected.json.inspection.status, 'rejected')

  const restarted = await call('POST', `/production-orders/${order.id}/quality/start`)
  assert.equal(restarted.status, 200)
  const approved = await call('POST', `/production-orders/${order.id}/quality/approve`)
  assert.equal(approved.status, 200)
  assert.equal(approved.json.productionOrder.status, 'concluida')
  assert.equal(approved.json.productionOrder.qualityStatus, 'approved')
  assert.equal((await call('GET', '/data/qualityInspections')).json.filter((i) => i.productionOrderId === order.id).length, 2)
})

test('compra da producao considera reservas e e idempotente', async () => {
  const material = (await call('POST', '/data/materials', { body: { name: 'Porca compra', category: 'ferragem', unit: 'un', cost: 2, stock: 2, active: true } })).json
  const bom = (await call('POST', '/data/boms', { body: { name: 'BOM compra', category: 'outro', parts: [], hardware: [{ id: 'h1', materialId: material.id, description: material.name, quantity: 5 }], routing: [], active: true } })).json
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'OP compra', status: 'planejada', priority: 'media', items: [{ id: 'item-1', bomId: bom.id, name: bom.name, quantity: 1 }], operations: [] } })).json

  const created = await call('POST', `/production-orders/${order.id}/purchase`, { body: {} })
  assert.equal(created.status, 201)
  assert.equal(created.json.purchase.items[0].quantity, 3)
  const repeated = await call('POST', `/production-orders/${order.id}/purchase`, { body: {} })
  assert.equal(repeated.status, 200)
  assert.equal(repeated.json.existing, true)
  assert.equal(repeated.json.purchase.id, created.json.purchase.id)
})

test('recebimento de compra vinculada reserva automaticamente a ordem quando o saldo fecha', async () => {
  const material = (await call('POST', '/data/materials', { body: { name: 'Arruela recebida', category: 'ferragem', unit: 'un', cost: 1, stock: 0, active: true } })).json
  const bom = (await call('POST', '/data/boms', { body: { name: 'BOM recebimento', category: 'outro', parts: [], hardware: [{ id: 'h1', materialId: material.id, description: material.name, quantity: 3 }], routing: [], active: true } })).json
  const order = (await call('POST', '/data/productionOrders', { body: { title: 'OP recebimento', status: 'planejada', priority: 'media', items: [{ id: 'item-1', bomId: bom.id, name: bom.name, quantity: 1 }], operations: [] } })).json
  const purchase = (await call('POST', `/production-orders/${order.id}/purchase`, { body: {} })).json.purchase
  const received = await call('POST', `/purchases/${purchase.id}/receive`, { body: { lines: [{ index: 0, quantity: 3 }] } })
  assert.equal(received.status, 200)
  assert.equal(received.json.autoReservation.created, true)
  const planned = (await call('GET', `/data/productionOrders/${order.id}`)).json
  assert.equal(planned.status, 'planejada')
  assert.equal(planned.reservationStatus, 'reserved')
  const released = await call('POST', `/production-orders/${order.id}/release`)
  assert.equal(released.status, 200)
  assert.equal(released.json.reservations[0].quantity, 3)
})

test('plano de corte importado com milhares de peças (acima de 12 MB) é salvo', async () => {
  const material = 'x'.repeat(40)
  const pieces = Array.from({ length: 22000 }, (_, i) => ({
    id: `p${i}`,
    label: `Painel ${i} ${material}`,
    length: 500 + (i % 300),
    width: 200 + (i % 150),
    quantity: 1,
    rotate: false,
    machining: [{ id: `m${i}`, kind: 'furo', method: 'furo_cego', face: 'topo', x: 10, y: 20, diameter: 8, depth: 12 }],
    note: material.repeat(8),
  }))
  const body = { title: 'Plano gigante', status: 'rascunho', mode: 'seccionadora', kerf: 3, trim: 10, pieces, hardware: [], groups: [] }
  assert.ok(JSON.stringify(body).length > 12 * 1024 * 1024, 'o corpo do teste precisa passar de 12 MB')
  const created = await call('POST', '/data/cutPlans', { body })
  assert.equal(created.status, 201, created.text.slice(0, 200))
  const read = await call('GET', `/data/cutPlans/${created.json.id}`)
  assert.equal(read.json.pieces.length, 22000)
  // a listagem devolve só o resumo (sem peças nem mapas), e o plano completo continua em GET por id
  const listed = (await call('GET', '/data/cutPlans')).json.find((p) => p.id === created.json.id)
  assert.equal(listed.summary, true)
  assert.equal(listed.pieces, undefined)
  assert.equal(listed.groups, undefined)
  assert.equal(listed.pieceLines, 22000)
  assert.equal(listed.pieceCount, 22000)
  assert.equal(listed.title, 'Plano gigante')
  const listedFull = (await call('GET', '/data/cutPlans?full=1')).json.find((p) => p.id === created.json.id)
  assert.equal(listedFull.pieces.length, 22000)
  // mantém o teto: acima do limite de cadastros a API recusa com mensagem clara
  const tooBig = JSON.stringify({ title: 'x', pad: 'y'.repeat(50 * 1024 * 1024) })
  try {
    const refused = await call('POST', '/data/cutPlans', { raw: tooBig })
    assert.equal(refused.status, 413)
    assert.match(refused.json.error, /limite/)
  } catch {
    /* conexão encerrada pelo servidor também é uma recusa válida */
  }
})

test('operador de fábrica não lê contato, documento nem valores; quem tem o módulo continua vendo tudo', async () => {
  const client = (await call('POST', '/data/clients', { body: { name: 'Cliente Sigiloso', type: 'PF', status: 'ativo', document: '123.456.789-00', phone: '21 99999-0000', email: 'sigiloso@x.com', address: 'Rua A, 10' } })).json
  const project = (await call('POST', '/data/projects', { body: { name: 'Projeto com valor', status: 'briefing', clientId: client.id, contractValue: 98765 } })).json
  const material = (await call('POST', '/data/materials', { body: { name: 'MDF custo', category: 'chapa', unit: 'chapa', cost: 321, stock: 2 } })).json

  const made = await call('POST', '/data/users', { body: { name: 'João Operador', email: 'joao.op@arcoplan.com.br', role: 'producao', password: 'Senha-Provisoria-1' } })
  assert.equal(made.status, 201)
  const login = await call('POST', '/auth/login', { body: { login: 'joao.op@arcoplan.com.br', password: 'Senha-Provisoria-1' }, token: null })
  await call('POST', '/auth/change-password', { token: login.json.token, body: { currentPassword: 'Senha-Provisoria-1', newPassword: 'Outra-Senha-Forte-2' } })
  const op = login.json.token

  const seen = (await call('GET', `/data/clients/${client.id}`, { token: op })).json
  assert.equal(seen.name, 'Cliente Sigiloso') // o nome continua disponível para identificar a ordem
  for (const field of ['document', 'phone', 'email', 'address']) assert.equal(seen[field], undefined, `${field} deve ser omitido`)
  const list = (await call('GET', '/data/clients', { token: op })).json.find((c) => c.id === client.id)
  assert.equal(list.phone, undefined)
  assert.equal((await call('GET', `/data/projects/${project.id}`, { token: op })).json.contractValue, undefined)
  assert.equal((await call('GET', `/data/materials/${material.id}`, { token: op })).json.cost, undefined)
  assert.equal((await call('GET', `/data/materials/${material.id}`, { token: op })).json.stock, 2)

  // administrador e PCP (que tem módulos ligados a essas coleções) seguem vendo tudo
  assert.equal((await call('GET', `/data/clients/${client.id}`)).json.phone, '21 99999-0000')
  assert.equal((await call('GET', `/data/projects/${project.id}`)).json.contractValue, 98765)
  const pcp = (await call('POST', '/auth/login', { body: { login: 'maria', password: 'Outra-Senha-Forte-2' }, token: null })).json.token
  assert.equal((await call('GET', `/data/clients/${client.id}`, { token: pcp })).json.phone, '21 99999-0000')
})
