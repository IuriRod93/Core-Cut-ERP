import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGeo, distanceMeters } from '../lib/geo.mjs'
import { projectPurchaseBalance } from '../../src/domain/planFlow.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = 5100 + Math.floor(Math.random() * 300)
const mapPort = 5500 + Math.floor(Math.random() * 300)
const base = `http://127.0.0.1:${port}/api`
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-field-'))
const mapCalls = []
let child
let maps
let master
let client

const call = async (method, path, { body, token } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
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

/** Provedor de mapas falso: Nominatim (search/reverse) e OSRM (route). */
const fakeMaps = () =>
  createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    mapCalls.push({ path: url.pathname, ua: req.headers['user-agent'] })
    res.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/search') {
      const q = url.searchParams.get('q') ?? ''
      if (/inexistente/i.test(q)) return res.end('[]')
      return res.end(JSON.stringify([{ lat: '-22.9068', lon: '-43.1729', display_name: `${q}, Rio de Janeiro, Brasil` }]))
    }
    if (url.pathname === '/reverse') return res.end(JSON.stringify({ address: { road: 'Rua da Assembleia', house_number: '10', suburb: 'Centro', city: 'Rio de Janeiro', state: 'RJ' } }))
    if (url.pathname.startsWith('/route/v1/driving/'))
      return res.end(JSON.stringify({ routes: [{ distance: 12345.6, duration: 1500.2, geometry: { coordinates: [[-43.2, -22.95], [-43.18, -22.92], [-43.1729, -22.9068]] } }] }))
    res.statusCode = 404
    res.end('{}')
  })

before(async () => {
  maps = fakeMaps()
  await new Promise((r) => maps.listen(mapPort, '127.0.0.1', r))
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: '',
      PORT: String(port),
      HOST: '127.0.0.1',
      ARCOPLAN_DATA_DIR: dataDir,
      ARCOPLAN_SCHEDULER_MS: '0',
      GEO_NOMINATIM_URL: `http://127.0.0.1:${mapPort}`,
      GEO_OSRM_URL: `http://127.0.0.1:${mapPort}`,
      RATE_GEO_PER_MIN: '1000',
    },
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
  master = login.json.token
  assert.equal((await call('POST', '/auth/change-password', { token: master, body: { currentPassword: 'arcoplan123', newPassword: 'Cerejeira-Azul-47' } })).status, 200)
})

after(() => {
  child?.kill()
  maps?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('geo: geocodifica, cacheia, espaça as chamadas e identifica o ERP no User-Agent', async () => {
  const seen = []
  const fake = async (url, init) => {
    seen.push({ url: String(url), ua: init.headers['User-Agent'], at: Date.now() })
    return { ok: true, json: async () => [{ lat: '-23.5', lon: '-46.6', display_name: 'Praça da Sé, São Paulo' }] }
  }
  const geo = createGeo({ fetchImpl: fake, minGapMs: 120 })
  const a = await geo.geocode('Praça da Sé, São Paulo')
  const b = await geo.geocode('praça da sé, são paulo') // mesma consulta (cache)
  assert.deepEqual(a, b)
  assert.equal(a.lat, -23.5)
  assert.equal(seen.length, 1)
  assert.match(seen[0].ua, /CoreCutERP/)
  await geo.geocode('Avenida Paulista 1000, São Paulo')
  assert.ok(seen[1].at - seen[0].at >= 100, 'chamadas espaçadas')
  // falha do provedor não derruba: devolve null
  const down = createGeo({ fetchImpl: async () => ({ ok: false, status: 503 }), minGapMs: 0 })
  assert.equal(await down.geocode('Rua Qualquer 100, Niterói'), null)
  assert.ok(Math.abs(distanceMeters({ lat: 0, lng: 0 }, { lat: 0, lng: 1 }) - 111195) < 200)
})

test('painel: cria cliente novo com administrador, que entra e monta a própria equipe por unidade', async () => {
  const created = await call('POST', '/platform/companies', {
    token: master,
    body: { companyName: 'Marcenaria Horizonte', ownerName: 'Helena Prado', email: 'helena@horizonte.com.br', planId: 'profissional', access: 'license', days: 30, phone: '21988887777' },
  })
  assert.equal(created.status, 201, JSON.stringify(created.json))
  assert.equal(created.json.owner.role, 'admin')
  assert.equal(created.json.owner.companyRole, 'owner')
  assert.equal(created.json.company.access.state, 'active')
  assert.ok(created.json.temporaryPassword)
  assert.equal((await call('POST', '/platform/companies', { token: master, body: { companyName: 'Outra', ownerName: 'Fulano', email: 'helena@horizonte.com.br', planId: 'essencial' } })).status, 409)

  // o administrador do cliente entra (troca a senha provisória) e cria unidades e equipe
  const login = await call('POST', '/auth/login', { body: { login: 'helena@horizonte.com.br', password: created.json.temporaryPassword } })
  assert.equal(login.status, 200)
  assert.equal(login.json.user.passwordMustChange, true)
  const t = login.json.token
  assert.equal((await call('POST', '/auth/change-password', { token: t, body: { currentPassword: created.json.temporaryPassword, newPassword: 'Ipe-Amarelo-2026' } })).status, 200)
  client = t

  const unit = await call('POST', '/data/units', { token: client, body: { name: 'Fábrica — Niterói', city: 'Niterói' } })
  assert.equal(unit.status, 201)
  assert.match(unit.json.code, /^UN-/)
  const member = await call('POST', '/data/users', { token: client, body: { name: 'Marcos Lima', email: 'marcos@horizonte.com.br', role: 'instalador', password: 'Pau-Brasil-8841', unitId: unit.json.id } })
  assert.equal(member.status, 201)
  assert.equal(member.json.unitId, unit.json.id)
  // a unidade e a equipe são do cliente: o painel da plataforma enxerga a empresa, mas outra empresa não vê a unidade
  const other = await call('POST', '/auth/register-company', {
    body: { companyName: 'Concorrente', ownerName: 'Rui Alves', email: `rui${Date.now()}@conc.com.br`, password: 'Jacaranda-Roxo-55', planId: 'profissional', phone: '21977776666', trial: true, acceptTerms: true },
  })
  assert.equal((await call('GET', '/data/units', { token: other.json.token })).json.length, 0)
  assert.equal((await call('GET', '/data/units', { token: client })).json.length, 1)
})

test('ponto: guarda a localização válida e descarta coordenadas absurdas', async () => {
  const ok = await call('POST', '/data/timeclock', { token: client, body: { type: 'entrada', at: new Date().toISOString(), lat: -22.906847, lng: -43.172897, accuracy: 18.4, place: 'Rua da Assembleia, 10 · Centro', locationStatus: 'granted' } })
  assert.equal(ok.status, 201)
  assert.equal(ok.json.lat, -22.90685)
  assert.equal(ok.json.accuracy, 18)
  assert.equal(ok.json.locationStatus, 'granted')
  const bad = await call('POST', '/data/timeclock', { token: client, body: { type: 'saida', at: new Date().toISOString(), lat: 999, lng: 'x', accuracy: -5 } })
  assert.equal(bad.status, 201)
  assert.equal(bad.json.lat, undefined)
  assert.equal(bad.json.lng, undefined)
  // atualização parcial (endereço legível) mantém a posição gravada
  const placed = await call('PUT', `/data/timeclock/${ok.json.id}`, { token: client, body: { place: 'Centro, Rio de Janeiro' } })
  assert.equal(placed.status, 200)
  const kept = (await call('GET', `/data/timeclock/${ok.json.id}`, { token: client })).json
  assert.equal(kept.lat, -22.90685)
  assert.equal(kept.locationStatus, 'granted')
  assert.equal(kept.place, 'Centro, Rio de Janeiro')
  const denied = await call('POST', '/data/timeclock', { token: client, body: { type: 'entrada', at: new Date().toISOString(), locationStatus: 'denied' } })
  assert.equal(denied.json.locationStatus, 'denied')
})

test('mapas: endereço → coordenadas, rota e endereço do ponto passam pelo servidor', async () => {
  assert.equal((await call('GET', '/geo/geocode?q=Rua%20X')).status, 401)
  const g = await call('GET', `/geo/geocode?q=${encodeURIComponent('Rua da Assembleia 10, Rio de Janeiro')}`, { token: client })
  assert.equal(g.json.found, true)
  assert.equal(g.json.lat, -22.9068)
  assert.equal((await call('GET', `/geo/geocode?q=${encodeURIComponent('lugar inexistente 99')}`, { token: client })).json.found, false)
  const r = await call('GET', '/geo/route?fromLat=-22.95&fromLng=-43.2&toLat=-22.9068&toLng=-43.1729', { token: client })
  assert.equal(r.json.found, true)
  assert.equal(r.json.distanceM, 12346)
  assert.equal(r.json.points.length, 3)
  assert.deepEqual(r.json.points[0], [-22.95, -43.2])
  const rev = await call('GET', '/geo/reverse?lat=-22.9068&lng=-43.1729', { token: client })
  assert.match(rev.json.label, /Rua da Assembleia, 10/)
  assert.equal((await call('GET', '/geo/route?fromLat=abc&fromLng=1&toLat=2&toLng=3', { token: client })).json.found, false)
  assert.ok(mapCalls.every((c) => /CoreCutERP/.test(c.ua ?? '')))
})

test('entrega: destino pelo endereço, rastreamento só da equipe e rastro limitado', async () => {
  const me = (await call('GET', '/auth/me', { token: client })).json.user
  const users = (await call('GET', '/data/users', { token: client })).json
  const marcos = users.find((u) => u.email === 'marcos@horizonte.com.br')
  const job = (await call('POST', '/data/installations', { token: client, body: { kind: 'entrega', date: '2026-10-20', status: 'agendada', address: 'Rua da Assembleia 10, Rio de Janeiro', teamIds: [marcos.id] } })).json
  assert.ok(job.id)

  const dest = await call('POST', `/installations/${job.id}/destination`, { token: client, body: {} })
  assert.equal(dest.status, 200)
  assert.equal(dest.json.destLat, -22.9068)
  assert.ok(dest.json.destLabel)

  // quem não está na equipe e não é gestão não envia posição
  const outsider = await call('POST', '/data/users', { token: client, body: { name: 'Zeca Externo', email: 'zeca@horizonte.com.br', role: 'instalador', password: 'Cajueiro-Verde-3321' } })
  assert.equal(outsider.status, 201)
  const zl = await call('POST', '/auth/login', { body: { login: 'zeca@horizonte.com.br', password: 'Cajueiro-Verde-3321' } })
  await call('POST', '/auth/change-password', { token: zl.json.token, body: { currentPassword: 'Cajueiro-Verde-3321', newPassword: 'Cajueiro-Verde-9988' } })
  assert.equal((await call('POST', `/installations/${job.id}/track`, { token: zl.json.token, body: { lat: -22.9, lng: -43.1 } })).status, 403)

  // a equipe envia; pontos parados são descartados e coordenadas inválidas recusadas
  const ml = await call('POST', '/auth/login', { body: { login: 'marcos@horizonte.com.br', password: 'Pau-Brasil-8841' } })
  await call('POST', '/auth/change-password', { token: ml.json.token, body: { currentPassword: 'Pau-Brasil-8841', newPassword: 'Pau-Brasil-1199' } })
  const mt = ml.json.token
  assert.equal((await call('POST', `/installations/${job.id}/track`, { token: mt, body: { lat: 'x', lng: 1 } })).status, 400)
  const first = await call('POST', `/installations/${job.id}/track`, { token: mt, body: { lat: -22.95, lng: -43.2, accuracy: 12 } })
  assert.equal(first.status, 200)
  assert.equal(first.json.points, 1)
  const same = await call('POST', `/installations/${job.id}/track`, { token: mt, body: { lat: -22.95001, lng: -43.20001, accuracy: 9 } })
  assert.equal(same.json.points, 1, 'parado: não grava outro ponto')
  const moved = await call('POST', `/installations/${job.id}/track`, { token: mt, body: { lat: -22.94, lng: -43.19 } })
  assert.equal(moved.json.points, 2)
  const fresh = (await call('GET', `/data/installations/${job.id}`, { token: client })).json
  assert.equal(fresh.lastLocation.userName, 'Marcos Lima')
  assert.equal(fresh.track.length, 2)
  // o rastro não pode ser forjado pela API de cadastros
  await call('PUT', `/data/installations/${job.id}`, { token: client, body: { notes: 'x', track: [{ lat: 1, lng: 1, at: 'y' }], lastLocation: { lat: 1, lng: 1 } } })
  const after = (await call('GET', `/data/installations/${job.id}`, { token: client })).json
  assert.equal(after.track.length, 2)
  assert.equal(after.lastLocation.userName, 'Marcos Lima')
  void me
})

test('compras: o saldo do orçamento do projeto diminui com cada solicitação', async () => {
  const supplier = (await call('POST', '/data/suppliers', { token: client, body: { name: 'Fornecedor X', category: 'chapas', status: 'ativo' } })).json
  const mat = (await call('POST', '/data/materials', { token: client, body: { name: 'MDF 15mm', category: 'chapa', unit: 'chapa', cost: 400, stock: 0, supplierId: supplier.id, thickness: 15, sheetWidth: 2750, sheetHeight: 1850 } })).json
  const project = (await call('POST', '/data/projects', { token: client, body: { name: 'Closet Horizonte', status: 'briefing' } })).json
  const budget = (
    await call('POST', '/data/budgets', {
      token: client,
      body: {
        title: 'Orçamento Closet',
        projectId: project.id,
        status: 'aprovado',
        marginPercent: 0,
        items: [
          { id: 'a', group: 'Closet', description: 'MDF', kind: 'material', unit: 'chapa', quantity: 5, unitCost: 400, unitPrice: 600 },
          { id: 'b', group: 'Closet', description: 'Montagem', kind: 'servico', unit: 'un', quantity: 1, unitCost: 500, unitPrice: 1000 },
        ],
      },
    })
  ).json
  assert.ok(budget.id)
  const plan = (
    await call('POST', '/data/cutPlans', {
      token: client,
      body: {
        title: 'Plano closet',
        projectId: project.id,
        pieces: [],
        hardware: [],
        groups: [{ key: 'g', materialId: mat.id, materialName: mat.name, thickness: 15, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 400, sheets: [{ index: 1, placements: [], usedArea: 0, utilization: 50 }], unplaced: [], utilization: 50, cost: 400 }],
        costs: { sheets: 400, edge: 0, hardware: 0, machining: 0, total: 400, edgeMeters: 0, holes: 0, grooves: 0, minutes: 0 },
      },
    })
  ).json
  const first = await call('POST', `/cut-plans/${plan.id}/purchase-request`, { token: client, body: { items: [{ materialId: mat.id, description: 'MDF 15mm', unit: 'chapa', quantity: 2, unitCost: 400 }] } })
  assert.equal(first.status, 201)
  const b = first.json.balance
  assert.equal(b.budgetTotal, 4000) // 5×600 + 1×1000
  assert.equal(b.materialsBudget, 2000) // custo de materiais: 5 × 400
  assert.equal(b.committed, 0) // a própria compra é a "solicitação"
  assert.equal(b.request, 800)
  assert.equal(b.balance, 3200)
  assert.equal(b.materialsBalance, 1200)
  const second = await call('POST', `/cut-plans/${plan.id}/purchase-request`, { token: client, body: { items: [{ materialId: mat.id, description: 'MDF 15mm', unit: 'chapa', quantity: 1, unitCost: 400 }] } })
  assert.equal(second.json.balance.committed, 800)
  assert.equal(second.json.balance.balance, 2800)
  assert.equal(second.json.balance.materialsBalance, 800)

  // função pura: projeto sem orçamento não tem saldo; orçamento recusado não conta
  assert.equal(projectPurchaseBalance({ projectId: 'p', budgets: [], purchases: [] }), null)
  assert.equal(projectPurchaseBalance({ projectId: 'p', budgets: [{ id: 'b', projectId: 'p', status: 'recusado', items: [], marginPercent: 0 }], purchases: [] }), null)
})

test('produção: a ordem vira tarefa-mãe com uma subtarefa por etapa e o andamento acompanha o chão de fábrica', async () => {
  const project = (await call('POST', '/data/projects', { token: client, body: { name: 'Cozinha Prado', status: 'briefing' } })).json
  const ops = ['Corte', 'Coladeira', 'Montagem'].map((name, i) => ({ id: `op-${i}`, workCenterId: `wc-${i}`, name, order: i + 1, plannedMinutes: 60 * (i + 1), actualSeconds: 0, status: 'pendente', runningSince: null }))
  const order = (await call('POST', '/data/productionOrders', { token: client, body: { title: 'Cozinha Prado', projectId: project.id, status: 'planejada', priority: 'alta', items: [], operations: ops, dueDate: '2026-12-01' } })).json
  assert.ok(order.id)
  const tasksOf = async () => (await call('GET', '/data/tasks', { token: client })).json.filter((t) => t.productionOrderId === order.id)
  let tasks = await tasksOf()
  const parent = tasks.find((t) => !t.parentId)
  assert.equal(tasks.length, 4)
  assert.match(parent.title, /^Produção — /)
  assert.equal(parent.status, 'todo')
  assert.equal(tasks.filter((t) => t.parentId === parent.id).length, 3)
  const lists = (await call('GET', '/data/taskLists', { token: client })).json.filter((l) => l.projectId === project.id)
  assert.ok(lists.some((l) => l.name === 'Produção'))

  // operador inicia a primeira etapa
  const running = ops.map((o, i) => (i === 0 ? { ...o, status: 'em_andamento', operatorId: 'u1', operatorName: 'Marcos', startedAt: new Date().toISOString() } : o))
  await call('PUT', `/data/productionOrders/${order.id}`, { token: client, body: { operations: running, status: 'em_producao' } })
  tasks = await tasksOf()
  assert.equal(tasks.find((t) => t.operationId === 'op-0').status, 'doing')
  assert.equal(tasks.find((t) => !t.parentId).status, 'doing')
  assert.deepEqual(tasks.find((t) => t.operationId === 'op-0').assigneeIds, ['u1'])

  // tudo concluído: etapas e tarefa-mãe encerradas; repetir a gravação não duplica
  const finished = ops.map((o) => ({ ...o, status: 'concluida', finishedAt: new Date().toISOString(), actualSeconds: 600 }))
  await call('PUT', `/data/productionOrders/${order.id}`, { token: client, body: { operations: finished } })
  await call('PUT', `/data/productionOrders/${order.id}`, { token: client, body: { notes: 'repetido' } })
  tasks = await tasksOf()
  assert.equal(tasks.length, 4)
  assert.ok(tasks.every((t) => t.status === 'done'))
  assert.ok(tasks.find((t) => !t.parentId).completedAt)
})

test('retalhos: o plano reserva o retalho usado, conclui como usado e libera quando deixa de usar', async () => {
  const offcut = await call('POST', '/data/offcuts', { token: client, body: { materialName: 'MDF Branco 18 mm', thickness: 18, width: 1200, height: 600, status: 'disponivel', location: 'Prateleira B2' } })
  assert.equal(offcut.status, 201, JSON.stringify(offcut.json))
  assert.match(offcut.json.code, /^RET-/)

  const group = { key: 'retalho:' + offcut.json.id, materialName: 'MDF Branco 18 mm · retalho', thickness: 18, sheetWidth: 1200, sheetHeight: 600, sheetCost: 0, sheets: [], unplaced: [], utilization: 0, cost: 0, offcutId: offcut.json.id }
  const plan = await call('POST', '/data/cutPlans', { token: client, body: { title: 'Plano com retalho', status: 'rascunho', groups: [group], pieces: [] } })
  assert.equal(plan.status, 201, JSON.stringify(plan.json))
  const read = async () => (await call('GET', `/data/offcuts/${offcut.json.id}`, { token: client })).json
  let current = await read()
  assert.equal(current.status, 'reservado')
  assert.equal(current.usedInPlanId, plan.json.id)

  // o plano é recalculado sem o retalho: ele volta ao estoque
  await call('PUT', `/data/cutPlans/${plan.json.id}`, { token: client, body: { groups: [] } })
  current = await read()
  assert.equal(current.status, 'disponivel')
  assert.equal(current.usedInPlanId ?? null, null)

  // usa de novo e conclui: vira "usado"
  await call('PUT', `/data/cutPlans/${plan.json.id}`, { token: client, body: { groups: [group], status: 'concluido' } })
  current = await read()
  assert.equal(current.status, 'usado')

  // resumo da listagem: retalho não conta como chapa comprada
  const listed = (await call('GET', '/data/cutPlans', { token: client })).json.find((p) => p.id === plan.json.id)
  assert.equal(listed.sheetCount, 0)
  assert.equal(listed.offcutCount, 1)
})

test('portal do cliente: link secreto mostra só o andamento, aceita pedido de assistência e pode ser revogado', async () => {
  const clientDoc = (await call('POST', '/data/clients', { token: client, body: { name: 'Família Prado', email: 'prado@example.com', phone: '21999990000' } })).json
  const project = (await call('POST', '/data/projects', { token: client, body: { name: 'Closet Prado', clientId: clientDoc.id, stageId: 'producao', dueDate: '2026-12-10', contractValue: 98765, estimatedCost: 55555 } })).json
  const ops = [
    { id: 'p0', workCenterId: 'wc', name: 'Corte', order: 1, plannedMinutes: 60, actualSeconds: 3600, status: 'concluida', operatorName: 'Segredo Silva' },
    { id: 'p1', workCenterId: 'wc', name: 'Montagem', order: 2, plannedMinutes: 60, actualSeconds: 0, status: 'pendente' },
  ]
  await call('POST', '/data/productionOrders', { token: client, body: { title: 'Closet Prado', projectId: project.id, status: 'em_producao', priority: 'media', items: [], operations: ops } })

  const publicGet = (path, init) => fetch(`http://127.0.0.1:${port}/api/public/portal/${path}`, init)

  // sem link ainda: nada é exposto
  assert.equal((await publicGet('0'.repeat(48))).status, 404)
  assert.equal((await publicGet('nao-e-um-codigo')).status, 404)

  const enabled = await call('POST', `/projects/${project.id}/portal`, { token: client, body: {} })
  assert.equal(enabled.status, 200, JSON.stringify(enabled.json))
  const token = enabled.json.token
  assert.match(token, /^[a-f0-9]{48}$/)
  assert.match(enabled.json.url, new RegExp(`/acompanhar/${token}$`))
  // chamar de novo mantém o mesmo link; regenerar troca
  assert.equal((await call('POST', `/projects/${project.id}/portal`, { token: client, body: {} })).json.token, token)

  const view = await publicGet(token)
  assert.equal(view.status, 200)
  assert.match(view.headers.get('cache-control') ?? '', /no-store/)
  const text = await view.text()
  const data = JSON.parse(text)
  assert.equal(data.project.name, 'Closet Prado')
  assert.equal(data.project.stage.label, 'Produção')
  assert.equal(data.production[0].steps.length, 2)
  assert.equal(data.production[0].steps[0].status, 'Concluída')
  // nada de dinheiro, custos nem nomes de funcionários
  for (const secret of ['98765', '55555', 'Segredo Silva', 'contractValue', 'estimatedCost', 'prado@example.com', 'passwordHash']) assert.equal(text.includes(secret), false, `vazou: ${secret}`)

  // pedido de assistência vira chamado aberto, com limite de pedidos por link
  const ask = await publicGet(`${token}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Dona Lúcia', message: 'A porta do closet está rangendo.' }) })
  assert.equal(ask.status, 201)
  assert.equal((await publicGet(`${token}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'x' }) })).status, 400)
  const warranty = (await call('GET', '/data/warranties', { token: client })).json.find((w) => w.projectId === project.id)
  assert.equal(warranty.status, 'aberta')
  assert.equal(warranty.source, 'portal')
  assert.match(warranty.description, /rangendo/)

  // aviso por e-mail ao cliente: sem SMTP configurado a resposta é clara (503), não um erro genérico
  const notify = await call('POST', `/projects/${project.id}/notify-client`, { token: client, body: { message: 'Seu closet entrou em produção.' } })
  assert.equal(notify.status, 503)
  assert.match(notify.json.error, /SMTP|e-mail/i)

  // regenerar invalida o link antigo; revogar derruba o novo
  const fresh = (await call('POST', `/projects/${project.id}/portal`, { token: client, body: { regenerate: true } })).json.token
  assert.notEqual(fresh, token)
  assert.equal((await publicGet(token)).status, 404)
  assert.equal((await publicGet(fresh)).status, 200)
  assert.equal((await call('DELETE', `/projects/${project.id}/portal`, { token: client })).status, 200)
  assert.equal((await publicGet(fresh)).status, 404)

  // sem login ninguém liga o portal de um projeto
  assert.equal((await call('POST', `/projects/${project.id}/portal`, { body: {} })).status, 401)
})
