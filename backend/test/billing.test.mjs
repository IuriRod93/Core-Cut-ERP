import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { createHmac, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stopServer } from './helpers.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = 4700 + Math.floor(Math.random() * 200)
const base = `http://127.0.0.1:${port}/api`
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-billing-'))
const WEBHOOK_SECRET = 'mp_webhook_secret_test'
const TOKEN = 'TEST-fake-token'

let child
let fake
let masterToken
let seq = 0
const preapprovals = new Map() // assinaturas criadas no "Mercado Pago"
const payments = new Map() // pagamentos PIX
const calls = [] // chamadas recebidas (para conferir cabeçalhos)

// ------------------------------------------------------------ Mercado Pago simulado
const startFakeMercadoPago = () =>
  new Promise((resolve) => {
    fake = createServer(async (req, res) => {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = raw ? JSON.parse(raw) : {}
      const url = new URL(req.url, 'http://x')
      const reply = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      calls.push({ method: req.method, path: url.pathname, headers: req.headers, body })
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { message: 'invalid access token' })

      if (req.method === 'POST' && url.pathname === '/preapproval') {
        seq += 1
        const id = `pre${seq}`
        const record = { ...body, id, status: 'pending', init_point: `https://www.mercadopago.test/subscriptions/checkout?preapproval_id=${id}`, next_payment_date: null }
        preapprovals.set(id, record)
        return reply(201, record)
      }
      const preMatch = url.pathname.match(/^\/preapproval\/([^/]+)$/)
      if (preMatch) {
        const record = preapprovals.get(preMatch[1])
        if (!record) return reply(404, { message: 'preapproval not found' })
        if (req.method === 'PUT') Object.assign(record, body)
        return reply(200, record)
      }
      if (req.method === 'POST' && url.pathname === '/v1/payments') {
        if (body.payment_method_id !== 'pix') return reply(400, { message: 'only pix in this test', cause: [{ description: 'payment_method_id' }] })
        if (!body.payer?.email) return reply(400, { message: 'payer.email is required' })
        if (!/-03:00$/.test(body.date_of_expiration ?? '')) return reply(400, { message: 'invalid date_of_expiration' })
        if (!req.headers['x-idempotency-key']) return reply(400, { message: 'X-Idempotency-Key header is required' })
        seq += 1
        const id = 9000 + seq
        const record = {
          id,
          status: 'pending',
          status_detail: 'pending_waiting_transfer',
          transaction_amount: body.transaction_amount,
          external_reference: body.external_reference,
          date_of_expiration: body.date_of_expiration,
          point_of_interaction: { transaction_data: { qr_code: `00020126-PIX-${id}`, qr_code_base64: 'iVBORw0KGgo=', ticket_url: `https://www.mercadopago.test/sandbox/payments/${id}/ticket` } },
        }
        payments.set(String(id), record)
        return reply(201, record)
      }
      const payMatch = url.pathname.match(/^\/v1\/payments\/([^/]+)$/)
      if (payMatch && req.method === 'GET') {
        const record = payments.get(payMatch[1])
        return record ? reply(200, record) : reply(404, { message: 'payment not found' })
      }
      const authMatch = url.pathname.match(/^\/authorized_payments\/([^/]+)$/)
      if (authMatch && req.method === 'GET') return reply(200, { id: authMatch[1], preapproval_id: authMatch[1].replace(/^auth_/, ''), status: 'processed' })
      if (req.method === 'GET' && url.pathname === '/users/me') return reply(200, { id: 777, nickname: 'VENDEDOR', email: 'vendedor@teste.com', site_id: 'MLB', country_id: 'BR' })
      return reply(404, { message: `rota não simulada: ${req.method} ${url.pathname}` })
    })
    fake.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${fake.address().port}`))
  })

const approvePayment = (id) => {
  payments.get(String(id)).status = 'approved'
}
const authorizePreapproval = (id, nextInDays = 30) => {
  Object.assign(preapprovals.get(id), { status: 'authorized', next_payment_date: new Date(Date.now() + nextInDays * 86_400_000).toISOString() })
}

// ------------------------------------------------------------------ cliente HTTP
const call = async (method, path, { body, token, raw, headers } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...(headers ?? {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    /* sem corpo JSON */
  }
  return { status: res.status, json }
}

/** Notificação do Mercado Pago assinada como a plataforma envia. */
const notify = (type, dataId, { secret = WEBHOOK_SECRET, tsMs = Date.now(), requestId = randomUUID() } = {}) => {
  const ts = String(Math.floor(tsMs / 1000))
  const v1 = createHmac('sha256', secret).update(`id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex')
  return call('POST', `/billing/webhook?data.id=${dataId}&type=${type}`, {
    raw: JSON.stringify({ type, action: `${type}.updated`, data: { id: String(dataId) } }),
    headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
  })
}

const preapprovalOf = (ref) => [...preapprovals.values()].find((p) => p.external_reference === ref)
const paymentOf = (ref) => [...payments.values()].find((p) => p.external_reference === ref)

let emailSeq = 0
/** Cadastra uma empresa e, opcionalmente, conclui o pagamento no Mercado Pago simulado. */
async function signupAndPay({ planId = 'profissional', paymentMethod = 'card', pixMonths, pay = true } = {}) {
  emailSeq += 1
  const email = `empresa${emailSeq}-${Date.now()}@teste.com`
  const password = 'Senha-Forte-123'
  const register = await call('POST', '/auth/register-company', {
    body: { companyName: `Marcenaria ${emailSeq}`, legalName: `Marcenaria ${emailSeq} LTDA`, ownerName: 'Dono Silva', email, password, planId, paymentMethod, pixMonths, phone: '21999990000', acceptTerms: true },
  })
  assert.equal(register.status, 201, JSON.stringify(register.json))
  const { ref } = register.json
  if (pay) {
    if (paymentMethod === 'pix') approvePayment(paymentOf(ref).id)
    else authorizePreapproval(preapprovalOf(ref).id)
    const status = await call('GET', `/billing/checkout-status?ref=${ref}`)
    assert.equal(status.status, 200)
    assert.equal(status.json.state, 'paid', JSON.stringify(status.json))
  }
  const login = await call('POST', '/auth/login', { body: { login: email, password } })
  assert.equal(login.status, 200, JSON.stringify(login.json))
  return { email, password, token: login.json.token, user: login.json.user, company: login.json.company, ref, companyId: register.json.companyId, register: register.json, login: login.json }
}

before(async () => {
  const fakeUrl = await startFakeMercadoPago()
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: '',
      PORT: String(port),
      HOST: '127.0.0.1',
      ARCOPLAN_DATA_DIR: dataDir,
      ARCOPLAN_SCHEDULER_MS: '0',
      MERCADOPAGO_ACCESS_TOKEN: TOKEN,
      MERCADOPAGO_API_BASE: fakeUrl,
      MERCADOPAGO_WEBHOOK_SECRET: WEBHOOK_SECRET,
      APP_URL: 'http://localhost:5174',
      RATE_REGISTER_PER_HOUR: '1000',
      RATE_TRIAL_PER_DAY: '1000',
      RATE_API_PER_MIN: '100000',
      RATE_LOGIN_PER_10MIN: '1000',
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
  assert.equal(login.status, 200)
  const changed = await call('POST', '/auth/change-password', { token: login.json.token, body: { currentPassword: 'arcoplan123', newPassword: 'Senha-Forte-123' } })
  assert.equal(changed.status, 200)
  masterToken = login.json.token
})

after(async () => {
  await stopServer(child)
  fake?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------- testes
test('planos expõem cartão (assinatura) e PIX (1, 3 ou 6 meses) pelo Mercado Pago', async () => {
  const res = await call('GET', '/billing/plans')
  assert.equal(res.status, 200)
  assert.equal(res.json.gateway, 'mercadopago')
  assert.equal(res.json.mode, 'test')
  assert.deepEqual(res.json.methods.pix.months, [1, 3, 6])
  assert.equal(res.json.methods.card.recurring, true)
  const essencial = res.json.plans.find((p) => p.id === 'essencial')
  assert.equal(essencial.limits.maxUsers, 3)
  assert.ok(essencial.modules.includes('production'))
  assert.ok(!essencial.modules.includes('cutplan'))
  assert.ok(res.json.plans.find((p) => p.id === 'industrial').modules.includes('shopfloor'))
})

test('cartão cria assinatura mensal pendente e só libera o ERP depois de autorizada', async () => {
  const unpaid = await signupAndPay({ planId: 'profissional', paymentMethod: 'card', pay: false })
  assert.match(unpaid.register.checkoutUrl, /^https:\/\/www\.mercadopago\.test\/subscriptions\/checkout/)
  const preapproval = preapprovalOf(unpaid.ref)
  assert.equal(preapproval.status, 'pending')
  assert.equal(preapproval.reason, 'Core Cut ERP - Plano Profissional')
  assert.equal(preapproval.payer_email, unpaid.email)
  assert.deepEqual(preapproval.auto_recurring, { frequency: 1, frequency_type: 'months', transaction_amount: 199, currency_id: 'BRL' })
  // o Mercado Pago recusa "localhost" no back_url; o ERP usa 127.0.0.1
  assert.equal(preapproval.back_url, `http://127.0.0.1:5174/assinatura?checkout=success&ref=${unpaid.ref}`)
  assert.ok(!('notification_url' in preapproval), 'APP_URL local não envia notification_url')

  // titular entra, mas o ERP fica bloqueado até a autorização do cartão
  assert.equal(unpaid.company.access.allowed, false)
  assert.equal(unpaid.company.access.state, 'pending_payment')
  assert.deepEqual(unpaid.login.modules, [])
  assert.equal((await call('GET', '/data/clients', { token: unpaid.token })).status, 402)
  assert.equal((await call('GET', '/billing/status', { token: unpaid.token })).status, 200)
  assert.equal((await call('GET', `/billing/checkout-status?ref=${unpaid.ref}`)).json.state, 'pending')

  authorizePreapproval(preapproval.id)
  const confirmed = await call('GET', `/billing/checkout-status?ref=${unpaid.ref}`)
  assert.equal(confirmed.json.state, 'paid')
  assert.equal(confirmed.json.method, 'card')
  const me = await call('GET', '/auth/me', { token: unpaid.token })
  assert.equal(me.json.company.status, 'active')
  assert.equal(me.json.company.billingMethod, 'card')
  assert.equal(me.json.company.access.allowed, true)
  assert.ok(me.json.modules.includes('production'))
  assert.ok(Date.parse(me.json.company.paidUntil) > Date.now() + 25 * 86_400_000)
  assert.equal((await call('GET', '/data/clients', { token: unpaid.token })).status, 200)
})

test('PIX gera QR Code no ERP, exige pagamento aprovado e estende a validade sem duplicar', async () => {
  const account = await signupAndPay({ planId: 'essencial', paymentMethod: 'pix', pixMonths: 3, pay: false })
  assert.equal(account.register.method, 'pix')
  assert.ok(!('checkoutUrl' in account.register))
  assert.match(account.register.pix.qrCode, /^00020126-PIX-/)
  assert.equal(account.register.pix.qrCodeBase64, 'iVBORw0KGgo=')
  assert.equal(account.register.pix.amount, 297) // 3 × R$ 99,00
  assert.ok(Date.parse(account.register.pix.expiresAt) > Date.now())

  const payment = paymentOf(account.ref)
  assert.equal(payment.transaction_amount, 297)
  const sent = calls.find((c) => c.path === '/v1/payments' && c.body.external_reference === account.ref)
  assert.equal(sent.body.payment_method_id, 'pix')
  assert.equal(sent.body.payer.email, account.email)
  assert.equal(sent.body.payer.first_name, 'Dono')
  assert.equal(sent.body.payer.last_name, 'Silva')
  assert.equal(sent.headers['x-idempotency-key'], account.ref)
  assert.deepEqual(sent.body.metadata, { company_id: account.companyId, plan_id: 'essencial', method: 'pix', months: 3 })

  // enquanto o PIX não é pago o ERP segue bloqueado
  assert.equal((await call('GET', `/billing/checkout-status?ref=${account.ref}`)).json.state, 'pending')
  assert.equal((await call('GET', '/data/clients', { token: account.token })).status, 402)

  approvePayment(payment.id)
  assert.equal((await call('GET', `/billing/checkout-status?ref=${account.ref}`)).json.state, 'paid')
  const first = await call('GET', '/auth/me', { token: account.token })
  assert.equal(first.json.company.billingMethod, 'pix')
  const until = Date.parse(first.json.company.paidUntil)
  assert.ok(Math.abs(until - (Date.now() + 3 * 30 * 86_400_000)) < 5 * 86_400_000, 'validade ~3 meses')

  // retorno do pagamento + webhook repetidos não podem estender duas vezes
  await call('GET', `/billing/checkout-status?ref=${account.ref}`)
  assert.equal((await notify('payment', payment.id)).status, 200)
  assert.equal((await notify('payment', payment.id)).status, 200)
  const again = await call('GET', '/auth/me', { token: account.token })
  assert.equal(again.json.company.paidUntil, first.json.company.paidUntil)

  // renovar antes de vencer soma à validade existente
  const renew = await call('POST', '/billing/checkout', { token: account.token, body: { paymentMethod: 'pix', pixMonths: 1 } })
  assert.equal(renew.status, 201)
  assert.equal(renew.json.pix.amount, 99)
  approvePayment(paymentOf(renew.json.ref).id)
  await call('GET', `/billing/checkout-status?ref=${renew.json.ref}`)
  const renewed = await call('GET', '/auth/me', { token: account.token })
  assert.ok(Date.parse(renewed.json.company.paidUntil) > until + 27 * 86_400_000)
})

test('PIX recusa períodos fora de 1/3/6 meses', async () => {
  const res = await call('POST', '/auth/register-company', {
    body: { companyName: 'Marcenaria X', ownerName: 'Dono', email: `x${Date.now()}@teste.com`, password: 'Senha-Forte-123', planId: 'industrial', paymentMethod: 'pix', pixMonths: 12, acceptTerms: true },
  })
  assert.equal(res.status, 400)
})

test('cadastro sem pagamento pode ser retomado só por quem sabe a senha', async () => {
  const first = await signupAndPay({ planId: 'essencial', pay: false })
  const body = { companyName: 'Marcenaria Retomada', ownerName: 'Dono', email: first.email, password: first.password, planId: 'profissional', paymentMethod: 'pix', pixMonths: 1, acceptTerms: true }
  const resumed = await call('POST', '/auth/register-company', { body })
  assert.equal(resumed.status, 201)
  assert.equal(resumed.json.companyId, first.companyId)
  assert.equal(resumed.json.pix.amount, 199)

  const stranger = await call('POST', '/auth/register-company', { body: { ...body, password: 'Outra-Senha-999' } })
  assert.equal(stranger.status, 409)
})

test('limites do plano valem para usuários e projetos e liberam ao excluir', async () => {
  const account = await signupAndPay({ planId: 'essencial' }) // 3 usuários, 50 projetos
  const t = account.token
  const newUser = (n) => call('POST', '/data/users', { token: t, body: { name: `Func ${n}`, email: `func${n}-${account.companyId.slice(0, 6)}@teste.com`, password: 'Senha-Forte-123', role: 'comercial' } })
  assert.equal((await newUser(1)).status, 201)
  assert.equal((await newUser(2)).status, 201)
  const blocked = await newUser(3)
  assert.equal(blocked.status, 403)
  assert.match(blocked.json.error, /Limite do plano Essencial atingido: 3 usuários/)

  const ids = []
  for (let i = 0; i < 50; i++) {
    const r = await call('POST', '/data/projects', { token: t, body: { name: `Projeto ${i}`, stageId: 'briefing', priority: 'media' } })
    assert.equal(r.status, 201, `projeto ${i}: ${JSON.stringify(r.json)}`)
    ids.push(r.json.id)
  }
  const over = await call('POST', '/data/projects', { token: t, body: { name: 'Projeto 51', stageId: 'briefing' } })
  assert.equal(over.status, 403)
  assert.match(over.json.error, /50 projetos/)
  assert.equal((await call('DELETE', `/data/projects/${ids[0]}`, { token: t })).status, 200)
  assert.equal((await call('POST', '/data/projects', { token: t, body: { name: 'Projeto novo', stageId: 'briefing' } })).status, 201)

  const usage = await call('GET', '/billing/company-usage', { token: t })
  assert.equal(usage.json.usage.projects, 50)
  assert.equal(usage.json.usage.users, 3)
  assert.equal(usage.json.limits.maxProjects, 50)
})

test('módulos disponíveis seguem o plano contratado', async () => {
  const essencial = await signupAndPay({ planId: 'essencial' })
  const me = await call('GET', '/auth/me', { token: essencial.token })
  assert.ok(me.json.modules.includes('projects'))
  assert.ok(me.json.modules.includes('production'))
  for (const blocked of ['cutplan', 'purchases', 'quality', 'shopfloor', 'maintenance', 'reports']) assert.ok(!me.json.modules.includes(blocked), blocked)
  assert.equal((await call('GET', '/data/purchases', { token: essencial.token })).status, 403)
  assert.equal((await call('GET', '/data/maintenance', { token: essencial.token })).status, 403)

  const profissional = await signupAndPay({ planId: 'profissional' })
  const pro = await call('GET', '/auth/me', { token: profissional.token })
  assert.ok(pro.json.modules.includes('cutplan'))
  assert.ok(pro.json.modules.includes('purchases'))
  assert.ok(!pro.json.modules.includes('shopfloor'))
  assert.equal((await call('GET', '/data/purchases', { token: profissional.token })).status, 200)
  assert.equal((await call('GET', '/data/maintenance', { token: profissional.token })).status, 403)

  const industrial = await signupAndPay({ planId: 'industrial' })
  const full = await call('GET', '/auth/me', { token: industrial.token })
  assert.ok(full.json.modules.includes('shopfloor'))
  assert.ok(full.json.modules.includes('reports'))
  assert.equal((await call('GET', '/data/maintenance', { token: industrial.token })).status, 200)
})

test('empresas não enxergam nem alteram os dados umas das outras', async () => {
  const masterClient = await call('POST', '/data/clients', { token: masterToken, body: { name: 'Cliente da plataforma', type: 'PJ' } })
  assert.equal(masterClient.status, 201)

  const a = await signupAndPay({ planId: 'profissional' })
  const b = await signupAndPay({ planId: 'profissional' })
  const aClient = await call('POST', '/data/clients', { token: a.token, body: { name: 'Cliente A', type: 'PF' } })
  assert.equal(aClient.status, 201)
  assert.match(aClient.json.code, /^CLI-\d{4}-0001$/) // contador próprio da empresa
  assert.equal(aClient.json.companyId, a.companyId)

  assert.deepEqual((await call('GET', '/data/clients', { token: b.token })).json, [])
  const listMaster = await call('GET', '/data/clients', { token: masterToken })
  assert.ok(listMaster.json.every((c) => c.id !== aClient.json.id))
  assert.ok(listMaster.json.some((c) => c.id === masterClient.json.id))

  assert.equal((await call('GET', `/data/clients/${aClient.json.id}`, { token: b.token })).status, 404)
  assert.equal((await call('PUT', `/data/clients/${aClient.json.id}`, { token: b.token, body: { name: 'invadido' } })).status, 404)
  assert.equal((await call('DELETE', `/data/clients/${aClient.json.id}`, { token: b.token })).status, 404)
  assert.equal((await call('GET', `/data/clients/${masterClient.json.id}`, { token: a.token })).status, 404)

  // companyId não pode ser forjado pelo cliente
  const forged = await call('POST', '/data/clients', { token: b.token, body: { name: 'Forjado', companyId: a.companyId } })
  assert.equal(forged.json.companyId, b.companyId)

  // usuários e configurações também são por empresa
  assert.equal((await call('GET', '/data/users', { token: a.token })).json.length, 1)
  const settingsA = await call('GET', '/data/settings', { token: a.token })
  assert.equal(settingsA.json.find((s) => s.id === 'company').name, a.company.name)
  const saved = await call('PUT', '/data/settings/company', { token: a.token, body: { defaultMargin: 42 } })
  assert.equal(saved.json.id, 'company')
  assert.equal(saved.json.defaultMargin, 42)
  const settingsB = await call('GET', '/data/settings', { token: b.token })
  assert.notEqual(settingsB.json.find((s) => s.id === 'company').defaultMargin, 42)

  // ações de plataforma ficam fora do alcance das empresas
  assert.equal((await call('POST', '/admin/restore', { token: a.token, body: { collections: { users: [{}] } } })).status, 403)
  assert.equal((await call('GET', '/admin/companies', { token: a.token })).status, 403)
  const platform = await call('GET', '/admin/companies', { token: masterToken })
  assert.equal(platform.status, 200)
  assert.ok(platform.json.items.length >= 3)
  const backup = await fetch(`${base}/admin/backup`, { headers: { Authorization: `Bearer ${a.token}` } })
  const snapshot = await backup.json()
  assert.ok(snapshot.collections.clients.every((c) => c.companyId === a.companyId))
  assert.ok(!snapshot.collections.users.some((u) => u.companyId !== a.companyId))
})

test('webhook valida a assinatura e aplica pagamento, atraso e renovação', async () => {
  const account = await signupAndPay({ planId: 'profissional' })
  const preapproval = preapprovalOf(account.ref)

  // assinatura inválida, expirada ou sem cabeçalho é recusada
  assert.equal((await notify('payment', '123', { secret: 'segredo-errado' })).status, 400)
  assert.equal((await notify('payment', '123', { tsMs: Date.now() - 3_600_000 })).status, 400)
  assert.equal((await call('POST', '/billing/webhook?data.id=1&type=payment', { raw: '{}' })).status, 400)

  // cobrança recusada → atraso, com aviso, mas ainda com acesso
  preapproval.status = 'paused'
  assert.equal((await notify('subscription_preapproval', preapproval.id)).status, 200)
  let me = await call('GET', '/auth/me', { token: account.token })
  assert.equal(me.json.company.status, 'past_due')
  assert.equal(me.json.company.access.allowed, true)
  assert.match(me.json.company.access.warning, /Atualize a forma de pagamento/)

  // cobrança paga (tópico de pagamento recorrente) → volta ao normal e renova a validade
  authorizePreapproval(preapproval.id, 60)
  assert.equal((await notify('subscription_authorized_payment', `auth_${preapproval.id}`)).status, 200)
  me = await call('GET', '/auth/me', { token: account.token })
  assert.equal(me.json.company.status, 'active')
  assert.ok(Date.parse(me.json.company.paidUntil) > Date.now() + 55 * 86_400_000)
})

test('cancelar a assinatura do cartão mantém o acesso até o fim do período pago', async () => {
  const account = await signupAndPay({ planId: 'profissional' })
  const preapproval = preapprovalOf(account.ref)
  const status = await call('GET', '/billing/status', { token: account.token })
  assert.equal(status.json.canCancel, true)

  const cancelled = await call('POST', '/billing/cancel', { token: account.token })
  assert.equal(cancelled.status, 200)
  assert.equal(preapproval.status, 'cancelled')
  const me = await call('GET', '/auth/me', { token: account.token })
  assert.equal(me.json.company.cancelAtPeriodEnd, true)
  assert.equal(me.json.company.access.allowed, true)
  assert.match(me.json.company.access.warning, /Assinatura cancelada/)
  assert.equal((await call('GET', '/data/clients', { token: account.token })).status, 200)
  assert.equal((await call('POST', '/billing/cancel', { token: account.token })).status, 409)
})

test('troca de plano no cartão cancela a assinatura anterior', async () => {
  const account = await signupAndPay({ planId: 'essencial' })
  const oldPreapproval = preapprovalOf(account.ref)
  const upgrade = await call('POST', '/billing/checkout', { token: account.token, body: { planId: 'industrial', paymentMethod: 'card' } })
  assert.equal(upgrade.status, 201)
  const next = preapprovalOf(upgrade.json.ref)
  assert.equal(next.auto_recurring.transaction_amount, 399)
  authorizePreapproval(next.id)
  assert.equal((await call('GET', `/billing/checkout-status?ref=${upgrade.json.ref}`)).json.state, 'paid')
  const me = await call('GET', '/auth/me', { token: account.token })
  assert.equal(me.json.company.planId, 'industrial')
  assert.equal(oldPreapproval.status, 'cancelled')
  assert.ok(me.json.modules.includes('maintenance'))
})

test('somente administradores da empresa mexem na assinatura', async () => {
  const account = await signupAndPay({ planId: 'profissional' })
  const member = await call('POST', '/data/users', {
    token: account.token,
    body: { name: 'Financeiro', email: `fin-${Date.now()}@teste.com`, password: 'Senha-Forte-123', role: 'financeiro' },
  })
  assert.equal(member.status, 201)
  const login = await call('POST', '/auth/login', { body: { login: member.json.email, password: 'Senha-Forte-123' } })
  const change = await call('POST', '/auth/change-password', { token: login.json.token, body: { currentPassword: 'Senha-Forte-123', newPassword: 'Outra-Senha-456' } })
  assert.equal(change.status, 200)
  assert.equal((await call('POST', '/billing/checkout', { token: login.json.token, body: { paymentMethod: 'pix', pixMonths: 1 } })).status, 403)
  assert.equal((await call('POST', '/billing/cancel', { token: login.json.token })).status, 403)
})

// ---------------------------------------------------- teste gratuito de 48 horas
async function startTrial(extra = {}) {
  emailSeq += 1
  const email = `trial${emailSeq}-${Date.now()}@teste.com`
  const name = `Marcenaria Teste ${emailSeq}`
  const res = await call('POST', '/auth/register-company', {
    body: { companyName: name, ownerName: 'Maria Souza', email, password: 'Senha-Forte-123', planId: 'profissional', phone: '21988887777', trial: true, acceptTerms: true, ...extra },
  })
  return { email, name, res }
}

test('teste gratuito de 48 horas: entra sem pagar e usa o plano escolhido', async () => {
  const chamadasAntes = calls.length
  const { res } = await startTrial()
  assert.equal(res.status, 201, JSON.stringify(res.json))
  assert.equal(res.json.trial, true)
  assert.equal(res.json.company.access.state, 'trial')
  assert.ok(res.json.company.access.hoursLeft >= 47)
  assert.match(res.json.company.access.warning, /Teste gratuito/)
  assert.ok(Math.abs(Date.parse(res.json.trialEndsAt) - (Date.now() + 48 * 3_600_000)) < 60_000)
  assert.ok(res.json.modules.includes('production'))
  // o teste não cria cobrança no Mercado Pago
  assert.equal(calls.length, chamadasAntes)

  // já pode trabalhar (sessão devolvida no cadastro)
  const client = await call('POST', '/data/clients', { token: res.json.token, body: { name: 'Primeiro cliente', type: 'PF' } })
  assert.equal(client.status, 201)
  assert.equal(client.json.companyId, res.json.companyId)

  // limites do plano escolhido valem no teste
  const status = await call('GET', '/billing/status', { token: res.json.token })
  assert.equal(status.json.limits.maxUsers, 10)
})

test('teste gratuito: exige aceite dos termos e não repete CPF/CNPJ nem e-mail', async () => {
  const noTerms = await startTrial({ acceptTerms: false })
  assert.equal(noTerms.res.status, 400)

  const first = await startTrial({ document: '12.345.678/0001-90' })
  assert.equal(first.res.status, 201)
  const sameDocument = await startTrial({ document: '12345678000190' })
  assert.equal(sameDocument.res.status, 409)
  assert.match(sameDocument.res.json.error, /CPF\/CNPJ/)

  const sameEmail = await call('POST', '/auth/register-company', {
    body: { companyName: 'Outra', ownerName: 'Maria', email: first.email, password: 'Senha-Forte-123', planId: 'essencial', trial: true, acceptTerms: true },
  })
  assert.equal(sameEmail.status, 409)
})

test('teste encerrado bloqueia o ERP até pagar; o painel pode estender e o pagamento ativa', async () => {
  const { res } = await startTrial()
  const { token, companyId } = res.json

  // encerra o teste pelo painel da plataforma (-1 h = já vencido)
  const ended = await call('POST', `/platform/companies/${companyId}/trial`, { token: masterToken, body: { hours: -1 } })
  assert.equal(ended.status, 200)
  assert.equal(ended.json.access.state, 'trial_expired')
  assert.equal((await call('GET', '/data/clients', { token })).status, 402)
  const me = await call('GET', '/auth/me', { token })
  assert.equal(me.json.company.access.allowed, false)
  assert.match(me.json.company.access.message, /48 horas terminou/)

  // paga por PIX da tela de bloqueio → ativa
  const pay = await call('POST', '/billing/checkout', { token, body: { paymentMethod: 'pix', pixMonths: 1 } })
  assert.equal(pay.status, 201)
  approvePayment(paymentOf(pay.json.ref).id)
  assert.equal((await call('GET', `/billing/checkout-status?ref=${pay.json.ref}`)).json.state, 'paid')
  const active = await call('GET', '/auth/me', { token })
  assert.equal(active.json.company.status, 'active')
  assert.equal(active.json.company.access.allowed, true)

  // outra empresa com teste vencido recebe mais 48 h do painel
  const second = await startTrial()
  await call('POST', `/platform/companies/${second.res.json.companyId}/trial`, { token: masterToken, body: { hours: -1 } })
  const extended = await call('POST', `/platform/companies/${second.res.json.companyId}/trial`, { token: masterToken, body: { hours: 48 } })
  assert.equal(extended.json.access.state, 'trial')
  assert.equal((await call('GET', '/data/clients', { token: second.res.json.token })).status, 200)
})

// ----------------------------------------------------------- painel da plataforma
test('painel da plataforma: visão geral, empresas, credenciais, licença manual, suspensão e exclusão', async () => {
  const trial = await startTrial()
  const paid = await signupAndPay({ planId: 'essencial', paymentMethod: 'pix', pixMonths: 1 })
  const { companyId } = trial.res.json

  const overview = await call('GET', '/platform/overview', { token: masterToken })
  assert.equal(overview.status, 200)
  assert.ok(overview.json.companies >= 2)
  assert.ok(overview.json.trial >= 1)
  assert.ok(overview.json.paying >= 1)
  assert.ok(overview.json.mrrEstimate >= 99)
  assert.ok(overview.json.revenue30d >= 99)
  assert.ok(overview.json.recentSignups.length >= 2)

  const list = await call('GET', `/platform/companies?q=${encodeURIComponent(trial.email)}`, { token: masterToken })
  assert.equal(list.json.items.length, 1)
  assert.equal(list.json.items[0].access.state, 'trial')

  const detail = await call('GET', `/platform/companies/${companyId}`, { token: masterToken })
  assert.equal(detail.json.users.length, 1)
  assert.equal(detail.json.users[0].email, trial.email)
  assert.ok(detail.json.logins.length >= 1)

  // cria credenciais para um funcionário (senha provisória exibida uma única vez)
  const created = await call('POST', `/platform/companies/${companyId}/users`, { token: masterToken, body: { name: 'João Financeiro', email: `joao-${Date.now()}@teste.com`, role: 'financeiro' } })
  assert.equal(created.status, 201)
  assert.ok(created.json.temporaryPassword.length >= 8)
  const login = await call('POST', '/auth/login', { body: { login: created.json.user.email, password: created.json.temporaryPassword } })
  assert.equal(login.status, 200)
  assert.equal(login.json.user.passwordMustChange, true)
  assert.equal(login.json.company.id, companyId)

  // redefinir senha encerra as sessões e gera outra senha
  const reset = await call('POST', `/platform/users/${created.json.user.id}/reset-password`, { token: masterToken })
  assert.equal(reset.status, 200)
  assert.equal((await call('GET', '/auth/me', { token: login.json.token })).status, 401)
  assert.equal((await call('POST', '/auth/login', { body: { login: created.json.user.email, password: reset.json.temporaryPassword } })).status, 200)

  // licença manual (cortesia) por 30 dias
  const grant = await call('POST', `/platform/companies/${companyId}/grant`, { token: masterToken, body: { days: 30, planId: 'industrial' } })
  assert.equal(grant.json.status, 'active')
  assert.equal(grant.json.billingMethod, 'manual')
  assert.equal(grant.json.planId, 'industrial')
  assert.ok(Date.parse(grant.json.paidUntil) > Date.now() + 29 * 86_400_000)

  // suspensão bloqueia e derruba a sessão; reativar devolve o acesso
  const owner = await call('POST', '/auth/login', { body: { login: trial.email, password: 'Senha-Forte-123' } })
  assert.equal((await call('POST', `/platform/companies/${companyId}/suspend`, { token: masterToken })).json.access.state, 'suspended')
  assert.equal((await call('GET', '/auth/me', { token: owner.json.token })).status, 401)
  const blocked = await call('POST', '/auth/login', { body: { login: trial.email, password: 'Senha-Forte-123' } })
  assert.equal(blocked.json.company.access.allowed, false)
  assert.equal((await call('POST', `/platform/companies/${companyId}/reactivate`, { token: masterToken })).json.access.allowed, true)

  // pagamentos, acessos, usuários e sessões
  const payments = await call('GET', '/platform/payments', { token: masterToken })
  assert.ok(payments.json.items.some((p) => p.companyId === paid.companyId && p.state === 'paid' && p.method === 'pix' && p.amount === 99))
  const logins = await call('GET', '/platform/logins', { token: masterToken })
  assert.ok(logins.json.items.some((l) => l.userName && l.ok === true))
  const users = await call('GET', `/platform/users?q=${encodeURIComponent(trial.email)}`, { token: masterToken })
  assert.equal(users.json.items.length, 1)
  const sessionsList = await call('GET', '/platform/sessions', { token: masterToken })
  assert.ok(sessionsList.json.items.length >= 1)
  const victim = sessionsList.json.items.find((s) => !s.self)
  if (victim) assert.equal((await call('POST', `/platform/sessions/${victim.id}/revoke`, { token: masterToken })).json.revoked, 1)

  // exclusão exige o nome exato e remove tudo da empresa
  assert.equal((await call('POST', `/platform/companies/${companyId}/delete`, { token: masterToken, body: { confirmName: 'nome errado' } })).status, 400)
  assert.equal((await call('POST', `/platform/companies/${companyId}/delete`, { token: masterToken, body: { confirmName: trial.name } })).status, 200)
  assert.equal((await call('GET', `/platform/companies/${companyId}`, { token: masterToken })).status, 404)
  assert.equal((await call('GET', '/platform/users?q=' + encodeURIComponent(trial.email), { token: masterToken })).json.items.length, 0)
})

test('painel da plataforma é restrito ao administrador da base original', async () => {
  const { res } = await startTrial()
  for (const path of ['/platform/overview', '/platform/companies', '/platform/payments', '/platform/logins', '/platform/sessions', '/platform/users']) {
    assert.equal((await call('GET', path, { token: res.json.token })).status, 403, path)
    assert.equal((await call('GET', path)).status, 401, path)
  }
  assert.equal((await call('POST', `/platform/companies/${res.json.companyId}/grant`, { token: res.json.token, body: { days: 3650 } })).status, 403)
})

test('respostas da API trazem cabeçalhos de segurança', async () => {
  const res = await fetch(`${base}/billing/plans`)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(res.headers.get('x-frame-options'), 'DENY')
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin')
})

// ------------------------------------------- cobrança de teste da plataforma
test('teste de cobrança PIX de R$ 1,00: confirma o recebimento sem mexer em empresa nem na receita', async () => {
  const before = (await call('GET', '/platform/overview', { token: masterToken })).json
  const created = await call('POST', '/platform/payment-test', { token: masterToken, body: { method: 'pix', amount: 1 } })
  assert.equal(created.status, 201, JSON.stringify(created.json))
  assert.equal(created.json.pix.amount, 1)
  assert.match(created.json.pix.qrCode, /^00020126-PIX-/)

  const payment = paymentOf(created.json.ref)
  assert.equal(payment.transaction_amount, 1)
  assert.equal((await call('GET', `/billing/checkout-status?ref=${created.json.ref}`)).json.state, 'pending')

  approvePayment(payment.id)
  assert.equal((await call('GET', `/billing/checkout-status?ref=${created.json.ref}`)).json.state, 'paid')
  // a notificação do Mercado Pago também é tratada sem erro
  assert.equal((await notify('payment', payment.id)).status, 200)

  const payments = (await call('GET', '/platform/payments', { token: masterToken })).json.items
  const row = payments.find((p) => p.id === created.json.ref)
  assert.equal(row.kind, 'platform-test')
  assert.equal(row.state, 'paid')
  assert.equal(row.amount, 1)

  const after = (await call('GET', '/platform/overview', { token: masterToken })).json
  assert.equal(after.revenue30d, before.revenue30d) // teste não conta como receita
  assert.equal(after.companies, before.companies)
})

test('teste de cobrança no cartão: assinatura de R$ 1,00 autorizada e cancelada em seguida', async () => {
  assert.equal((await call('POST', '/platform/payment-test', { token: masterToken, body: { method: 'card', amount: 1 } })).status, 400) // exige e-mail do pagador
  const created = await call('POST', '/platform/payment-test', { token: masterToken, body: { method: 'card', amount: 1, payerEmail: 'comprador@teste.com' } })
  assert.equal(created.status, 201, JSON.stringify(created.json))
  assert.match(created.json.checkoutUrl, /mercadopago\.test\/subscriptions/)
  const preapproval = preapprovalOf(created.json.ref)
  assert.equal(preapproval.auto_recurring.transaction_amount, 1)
  assert.equal(preapproval.payer_email, 'comprador@teste.com')

  assert.equal((await call('GET', `/billing/checkout-status?ref=${created.json.ref}`)).json.state, 'pending')
  authorizePreapproval(preapproval.id)
  assert.equal((await call('GET', `/billing/checkout-status?ref=${created.json.ref}`)).json.state, 'paid')

  assert.equal((await call('POST', `/platform/payment-test/${created.json.ref}/cancel`, { token: masterToken })).status, 200)
  assert.equal(preapproval.status, 'cancelled')
})

test('teste de cobrança valida valor e é exclusivo da plataforma', async () => {
  assert.equal((await call('POST', '/platform/payment-test', { token: masterToken, body: { method: 'pix', amount: 0.5 } })).status, 400)
  assert.equal((await call('POST', '/platform/payment-test', { token: masterToken, body: { method: 'pix', amount: 500 } })).status, 400)
  assert.equal((await call('POST', '/platform/payment-test', { token: masterToken, body: { method: 'boleto', amount: 1 } })).status, 400)
  const { res } = await startTrial()
  assert.equal((await call('POST', '/platform/payment-test', { token: res.json.token, body: { method: 'pix', amount: 1 } })).status, 403)
  assert.equal((await call('POST', '/platform/payment-test', { body: { method: 'pix', amount: 1 } })).status, 401)
})

// -------------------------------------------------- monitoramento e diagnóstico
test('monitoramento: saúde, desempenho, erros e totais do sistema', async () => {
  // gera tráfego conhecido
  for (let i = 0; i < 5; i++) await call('GET', '/billing/plans')
  await call('POST', '/auth/login', { body: { login: 'ninguem@teste.com', password: 'errada-123' } })

  const res = await call('GET', '/platform/monitor', { token: masterToken })
  assert.equal(res.status, 200)
  const m = res.json
  assert.ok(m.uptimeSeconds >= 0)
  assert.match(m.node, /^v\d+/)
  assert.equal(m.database.ok, true)
  assert.ok(m.last5min.requests >= 6)
  assert.ok(m.last5min.byClass['2xx'] >= 5)
  assert.ok(m.last5min.byClass['4xx'] >= 1)
  assert.equal(m.last5min.errorRate, 0)
  assert.ok(m.last5min.p95 >= 0)
  assert.ok(m.busiestRoutes.length > 0)
  assert.ok([...m.busiestRoutes, ...m.slowestRoutes].every((r) => /^[A-Z]+ \/api\//.test(r.route) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(r.route))) // ids agrupados em :id
  assert.ok(m.loginFailures >= 1)
  assert.ok(m.memory.rssBytes > 0)
  assert.ok(m.totals.companies >= 1)
  assert.ok(m.totals.sessionsActive >= 1)
  assert.ok(Array.isArray(m.recentErrors))

  // exclusivo da plataforma
  const { res: trial } = await startTrial()
  assert.equal((await call('GET', '/platform/monitor', { token: trial.json.token })).status, 403)
  assert.equal((await call('GET', '/platform/monitor')).status, 401)
})

test('erros do navegador chegam ao monitoramento, agrupados e sem quebra de linha', async () => {
  const { res: trial } = await startTrial()
  const token = trial.json.token
  const noAuth = await call('POST', '/auth/client-error', { body: { message: 'x' } })
  assert.equal(noAuth.status, 401)
  const report = { message: 'MUI: MenuListContext is missing.\nlinha extra', page: '/projetos/abc?tarefa=1', where: 'tela', stack: 'Error: x\n at y' }
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', '/auth/client-error', { token, body: report })).status, 200)
  assert.equal((await call('POST', '/auth/client-error', { token, body: { ...report, message: 'Outro erro', page: '/plano-de-corte' } })).status, 200)
  const monitor = (await call('GET', '/platform/monitor', { token: masterToken })).json
  const list = monitor.recentClientErrors
  assert.ok(Array.isArray(list))
  const grouped = list.find((e) => /MenuListContext/.test(e.message))
  assert.equal(grouped.count, 3)
  assert.equal(grouped.page, '/projetos/abc')
  assert.ok(!/[\r\n]/.test(grouped.message))
  assert.ok(list.some((e) => e.message === 'Outro erro' && e.page === '/plano-de-corte'))
  assert.match(grouped.user, /@/)
})

test('verificação de segurança da configuração aponta o que está fraco', async () => {
  const res = await call('GET', '/platform/security', { token: masterToken })
  assert.equal(res.status, 200)
  const byId = Object.fromEntries(res.json.checks.map((c) => [c.id, c]))
  // ambiente de teste: HTTP local, token de teste e senha trocada no beforeAll
  assert.equal(byId.https.ok, false)
  assert.equal(byId.gateway.ok, false)
  assert.equal(byId['admin-password'].ok, true)
  assert.equal(byId.webhook.ok, true)
  assert.equal(byId.database.ok, false) // JSON no teste
  assert.ok(res.json.score >= 0 && res.json.score <= 100)
  assert.ok(res.json.checks.every((c) => ['high', 'medium', 'low'].includes(c.severity) && typeof c.detail === 'string'))
  assert.equal((await call('GET', '/platform/security')).status, 401)
})

test('diagnóstico do Mercado Pago: conecta, mostra a conta e esconde o token', async () => {
  const res = await call('GET', '/platform/mercadopago', { token: masterToken })
  assert.equal(res.status, 200)
  assert.equal(res.json.configured, true)
  assert.equal(res.json.reachable, true)
  assert.equal(res.json.account.id, 777)
  assert.equal(res.json.account.siteId, 'MLB')
  assert.equal(res.json.mode, 'test')
  assert.equal(res.json.webhookSecret, true)
  assert.ok(!JSON.stringify(res.json).includes(TOKEN)) // token nunca vai por inteiro
  assert.match(res.json.tokenHint, /^TEST-fak…oken$|…/)
})

// ------------------------------------- usuários: criar, bloquear, excluir, pagamento
test('painel: cria acesso, mostra quem pagou, bloqueia, desbloqueia e exclui', async () => {
  const trial = await startTrial()
  const paid = await signupAndPay({ planId: 'profissional', paymentMethod: 'pix', pixMonths: 1 })

  // criar acesso numa empresa
  const created = await call('POST', '/platform/users', {
    token: masterToken,
    body: { name: 'Maria Financeiro', email: `maria-${Date.now()}@teste.com`, role: 'financeiro', companyId: paid.companyId },
  })
  assert.equal(created.status, 201, JSON.stringify(created.json))
  assert.ok(created.json.temporaryPassword.length >= 8)
  assert.equal(created.json.user.companyId, paid.companyId)
  assert.equal(created.json.user.payment.status, 'paid')
  const email = created.json.user.email

  // entra pelo /login com a senha provisória
  const login = await call('POST', '/auth/login', { body: { login: email, password: created.json.temporaryPassword } })
  assert.equal(login.status, 200)
  assert.equal(login.json.user.passwordMustChange, true)

  // quem pagou: a lista mostra o estado de cada empresa
  const all = await call('GET', '/platform/users', { token: masterToken })
  const byEmail = Object.fromEntries(all.json.items.map((u) => [u.email, u]))
  assert.equal(byEmail[email].payment.status, 'paid')
  assert.equal(byEmail[email].payment.method, 'pix')
  assert.ok(byEmail[email].payment.paidUntil)
  assert.equal(byEmail[trial.email].payment.status, 'trial')
  assert.equal(byEmail['admin@corecut.local'].payment.status, 'platform')
  assert.ok(all.json.summary.paid >= 1)
  assert.ok(all.json.summary.trial >= 1)
  const onlyPaid = await call('GET', '/platform/users?status=paid', { token: masterToken })
  assert.ok(onlyPaid.json.items.length >= 1 && onlyPaid.json.items.every((u) => u.payment.status === 'paid'))

  // bloquear: derruba a sessão e o login informa o bloqueio (só a quem acerta a senha)
  const blocked = await call('POST', `/platform/users/${created.json.user.id}/active`, { token: masterToken, body: { active: false } })
  assert.equal(blocked.status, 200)
  assert.equal(blocked.json.active, false)
  assert.equal((await call('GET', '/auth/me', { token: login.json.token })).status, 401)
  const denied = await call('POST', '/auth/login', { body: { login: email, password: created.json.temporaryPassword } })
  assert.equal(denied.status, 403)
  assert.match(denied.json.error, /bloqueado/)
  const wrong = await call('POST', '/auth/login', { body: { login: email, password: 'senha-errada-123' } })
  assert.equal(wrong.status, 401) // quem não sabe a senha não descobre que existe
  assert.equal((await call('GET', '/platform/users?status=blocked', { token: masterToken })).json.items.some((u) => u.email === email), true)

  // desbloquear
  await call('POST', `/platform/users/${created.json.user.id}/active`, { token: masterToken, body: { active: true } })
  assert.equal((await call('POST', '/auth/login', { body: { login: email, password: created.json.temporaryPassword } })).status, 200)

  // excluir: some da lista e não consegue mais entrar
  const removed = await call('POST', `/platform/users/${created.json.user.id}/delete`, { token: masterToken })
  assert.equal(removed.status, 200)
  assert.equal((await call('POST', '/auth/login', { body: { login: email, password: created.json.temporaryPassword } })).status, 401)
  const after = await call('GET', `/platform/users?q=${encodeURIComponent(email)}`, { token: masterToken })
  assert.equal(after.json.items.length, 0)
})

test('painel: proteções ao excluir e ao criar acesso', async () => {
  const account = await signupAndPay({ planId: 'essencial' }) // limite de 3 usuários
  // titular da empresa não é excluído por aqui
  const owner = (await call('GET', `/platform/users?q=${encodeURIComponent(account.email)}`, { token: masterToken })).json.items[0]
  assert.equal((await call('POST', `/platform/users/${owner.id}/delete`, { token: masterToken })).status, 409)
  // não exclui nem bloqueia a si mesmo
  const me = (await call('GET', '/platform/users?q=admin@corecut.local', { token: masterToken })).json.items[0]
  assert.equal((await call('POST', `/platform/users/${me.id}/delete`, { token: masterToken })).status, 400)
  assert.equal((await call('POST', `/platform/users/${me.id}/active`, { token: masterToken, body: { active: false } })).status, 400)

  // limite do plano vale também para o painel
  const make = (n) => call('POST', '/platform/users', { token: masterToken, body: { name: `Func ${n}`, email: `limite${n}-${Date.now()}@teste.com`, role: 'comercial', companyId: account.companyId } })
  assert.equal((await make(1)).status, 201)
  assert.equal((await make(2)).status, 201)
  const over = await make(3)
  assert.equal(over.status, 403)
  assert.match(over.json.error, /Limite do plano Essencial/)

  // validações e e-mail duplicado
  assert.equal((await call('POST', '/platform/users', { token: masterToken, body: { name: 'X', email: 'invalido', role: 'admin' } })).status, 400)
  assert.equal((await call('POST', '/platform/users', { token: masterToken, body: { name: 'Fulano', email: account.email, role: 'admin' } })).status, 409)
  assert.equal((await call('POST', '/platform/users', { token: masterToken, body: { name: 'Fulano', email: `x${Date.now()}@t.com`, role: 'inexistente' } })).status, 400)

  // acesso da base da plataforma (sem empresa)
  const platformUser = await call('POST', '/platform/users', { token: masterToken, body: { name: 'Operador Core Cut', email: `operador-${Date.now()}@corecut.local`, role: 'gerente', password: 'Senha-Do-Operador-1' } })
  assert.equal(platformUser.status, 201)
  assert.equal(platformUser.json.user.companyId, null)
  assert.equal(platformUser.json.temporaryPassword, undefined)

  // só a plataforma gerencia acessos
  const { res } = await startTrial()
  assert.equal((await call('POST', '/platform/users', { token: res.json.token, body: { name: 'Invasor', email: `inv${Date.now()}@t.com`, role: 'admin' } })).status, 403)
  assert.equal((await call('POST', `/platform/users/${owner.id}/delete`, { token: res.json.token })).status, 403)
})

test('financeiro da plataforma: MRR, conversão, churn e receita por mês sem contar cobranças de teste', async () => {
  const res = await call('GET', '/platform/finance', { token: masterToken })
  assert.equal(res.status, 200)
  const f = res.json
  assert.equal(f.revenueByMonth.length, 6)
  assert.ok(f.signups >= 1)
  assert.ok(f.conversionRate >= 0 && f.conversionRate <= 100)
  assert.equal(f.arr, f.mrr * 12)
  assert.ok(f.byPlan.reduce((sum, p) => sum + p.mrr, 0) === f.mrr, 'MRR é a soma dos planos')
  assert.ok(Array.isArray(f.upcomingRenewals) && Array.isArray(f.churnedCompanies))
  const received = f.revenueByMonth.reduce((sum, m) => sum + m.amount, 0)
  const paid = (await call('GET', '/platform/payments', { token: masterToken })).json.items.filter((p) => p.state === 'paid' && p.kind !== 'platform-test')
  assert.equal(Math.round(received * 100), Math.round(paid.reduce((sum, p) => sum + p.amount, 0) * 100))
  const { res: trial } = await startTrial()
  assert.equal((await call('GET', '/platform/finance', { token: trial.json.token })).status, 403)
})

// -------------------------------------------------- senhas fortes e verificação em duas etapas
test('política de senha: recusa senhas previsíveis e o próprio e-mail', async () => {
  const { email, res } = await startTrial()
  const token = res.json.token
  const change = (newPassword) => call('POST', '/auth/change-password', { token, body: { currentPassword: 'Senha-Forte-123', newPassword } })
  for (const weak of ['12345678', 'senha123', 'aaaaaaaaa', 'abcdefgh', email.split('@')[0] + '99', 'corecut123']) {
    const r = await change(weak)
    assert.equal(r.status, 400, `"${weak}" deveria ser recusada`)
  }
  assert.equal((await change('curta')).status, 400)
  assert.equal((await change('Cerejeira-Azul-47')).status, 200)
  // cadastro também aplica a política
  const weakSignup = await call('POST', '/auth/register-company', {
    body: { companyName: 'Fraca LTDA', ownerName: 'Zé', email: `fraca${Date.now()}@teste.com`, password: '12345678', planId: 'profissional', phone: '21988887777', trial: true, acceptTerms: true },
  })
  assert.equal(weakSignup.status, 400)
})

test('sem 2FA: login só com senha, rotas do autenticador removidas e a API não guarda sementes', async () => {
  const { email, res } = await startTrial()
  const token = res.json.token

  // as rotas do autenticador não existem mais
  for (const path of ['/auth/2fa/setup', '/auth/2fa/enable', '/auth/2fa/disable']) {
    const r = await call('POST', path, { token, body: { password: 'Senha-Forte-123', code: '123456' } })
    assert.equal(r.status, 404, path)
  }

  // login normal, sem pedir código (um código extra é ignorado)
  const login = await call('POST', '/auth/login', { body: { login: email, password: 'Senha-Forte-123', code: '000000' } })
  assert.equal(login.status, 200)
  assert.ok(login.json.token)
  assert.equal(login.json.twoFactorRequired, undefined)

  // a API de usuários não aceita semente de 2FA nem a devolve
  const me = (await call('GET', '/auth/me', { token })).json.user
  assert.equal(me.totpEnabled, undefined)
  await call('PUT', `/data/users/${me.id}`, { token, body: { totpEnabled: true, totpSecret: 'AAAAAAAAAAAAAAAA', recoveryCodes: ['x'] } })
  const after = (await call('GET', '/auth/me', { token })).json.user
  assert.equal(after.totpEnabled, undefined)
  assert.equal(after.totpSecret, undefined)
  const plain = await call('POST', '/auth/login', { body: { login: email, password: 'Senha-Forte-123' } })
  assert.equal(plain.status, 200)
  assert.equal(plain.json.twoFactorRequired, undefined)
})
