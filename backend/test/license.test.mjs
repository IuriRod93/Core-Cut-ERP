import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from '../lib/db.mjs'
import { companyAccess, createBilling, GRACE_DAYS, TRIAL_HOURS } from '../lib/billing.mjs'

/**
 * Prazo de uso da licença com relógio controlado: teste gratuito de 48 h, PIX (1/3/6 meses),
 * cartão (assinatura), carência de 3 dias e bloqueio. Nenhum teste espera tempo real passar.
 */
const HOUR = 3_600_000
const DAY = 24 * HOUR
const T0 = Date.parse('2026-03-10T12:00:00.000Z')
let clock = T0
const now = () => clock
const at = (ms) => {
  clock = ms
}

let dir
let db
let billing
const payments = new Map()
const subscriptions = new Map()
let counter = 0

const gateway = {
  async post(path, body) {
    counter += 1
    if (path === '/v1/payments') {
      const record = { id: 5000 + counter, status: 'pending', external_reference: body.external_reference, date_of_expiration: body.date_of_expiration, point_of_interaction: { transaction_data: { qr_code: `PIX${counter}`, qr_code_base64: 'x', ticket_url: 'https://t' } } }
      payments.set(String(record.id), record)
      return record
    }
    if (path === '/preapproval') {
      const record = { id: `sub${counter}`, status: 'pending', external_reference: body.external_reference, init_point: `https://mp/sub${counter}`, next_payment_date: null }
      subscriptions.set(record.id, record)
      return record
    }
    throw new Error(`POST não simulado: ${path}`)
  },
  async get(path) {
    const payment = path.match(/^\/v1\/payments\/(.+)$/)
    if (payment) return payments.get(payment[1])
    const subscription = path.match(/^\/preapproval\/(.+)$/)
    if (subscription) return subscriptions.get(subscription[1])
    throw new Error(`GET não simulado: ${path}`)
  },
  async put(path, body) {
    const subscription = path.match(/^\/preapproval\/(.+)$/)
    if (subscription) return Object.assign(subscriptions.get(subscription[1]), body)
    throw new Error(`PUT não simulado: ${path}`)
  },
}

before(() => {
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-license-unit'
  dir = mkdtempSync(join(tmpdir(), 'corecut-license-'))
  db = new Database(dir)
  db.touch = () => {} // sem gravação em disco
  billing = createBilling({ db, gateway, now })
})

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

let seq = 0
const newCompany = (patch = {}) => {
  seq += 1
  return db.insert('companies', {
    name: `Empresa ${seq}`,
    email: `empresa${seq}@teste.com`,
    status: 'pending_payment',
    planId: 'profissional',
    planName: 'Profissional',
    planPrice: 199,
    ...patch,
  })
}
const current = (company) => db.all('companies').find((c) => c.id === company.id)
const access = (company) => companyAccess(current(company), clock)

async function payPix(company, months, when = clock) {
  at(when)
  const checkout = await billing.createCheckout({ company: current(company), planId: current(company).planId, method: 'pix', months, origin: 'https://www.cutcore.com.br', email: company.email })
  const record = [...payments.values()].find((p) => p.external_reference === checkout.ref)
  record.status = 'approved'
  const status = await billing.checkoutStatus(checkout.ref)
  assert.equal(status.state, 'paid')
  return current(company)
}

async function authorizeCard(company, when = clock) {
  at(when)
  const checkout = await billing.createCheckout({ company: current(company), planId: current(company).planId, method: 'card', origin: 'https://www.cutcore.com.br', email: company.email })
  const record = [...subscriptions.values()].find((s) => s.external_reference === checkout.ref)
  Object.assign(record, { status: 'authorized', next_payment_date: new Date(clock + HOUR).toISOString() })
  const status = await billing.checkoutStatus(checkout.ref)
  assert.equal(status.state, 'paid')
  return { company: current(company), subscription: record }
}

// --------------------------------------------------------------- teste gratuito
test('teste gratuito dura 48 horas: libera até o fim e bloqueia logo depois', () => {
  assert.equal(TRIAL_HOURS, 48)
  const start = T0
  const company = { status: 'trial', trialEndsAt: new Date(start + 48 * HOUR).toISOString(), planId: 'profissional' }

  const first = companyAccess(company, start)
  assert.equal(first.allowed, true)
  assert.equal(first.state, 'trial')
  assert.equal(first.hoursLeft, 48)
  assert.match(first.warning, /2 dia\(s\) e 0 h/)

  const lastHour = companyAccess(company, start + 47 * HOUR + 59 * 60_000)
  assert.equal(lastHour.allowed, true)
  assert.equal(lastHour.hoursLeft, 1)

  const expired = companyAccess(company, start + 48 * HOUR + 1_000)
  assert.equal(expired.allowed, false)
  assert.equal(expired.state, 'trial_expired')
  assert.match(expired.message, /48 horas terminou/)

  // dias depois continua bloqueado (não "desbloqueia" sozinho)
  assert.equal(companyAccess(company, start + 90 * DAY).allowed, false)
})

test('depois do teste, pagar libera o acesso a partir do dia do pagamento', async () => {
  const company = newCompany({ status: 'trial', billingMethod: 'trial', trialEndsAt: new Date(T0 + 48 * HOUR).toISOString() })
  at(T0 + 49 * HOUR)
  assert.equal(access(company).state, 'trial_expired')

  const payDay = T0 + 5 * DAY
  const paid = await payPix(company, 1, payDay)
  assert.equal(paid.status, 'active')
  assert.equal(paid.billingMethod, 'pix')
  assert.equal(new Date(paid.paidUntil).toISOString(), '2026-04-15T12:00:00.000Z') // 15/03 + 1 mês
  at(payDay + HOUR)
  assert.equal(access(company).state, 'active')
})

// -------------------------------------------------------------------------- PIX
test('PIX de 1 mês: aviso antes do vencimento, carência de 3 dias e bloqueio depois', async () => {
  const company = newCompany()
  const paid = await payPix(company, 1, T0)
  const until = Date.parse(paid.paidUntil)
  assert.equal(new Date(until).toISOString(), '2026-04-10T12:00:00.000Z')

  at(T0 + 10 * DAY)
  assert.equal(access(company).state, 'active')
  assert.equal(access(company).warning, undefined)

  at(until - 4 * DAY)
  const warning = access(company)
  assert.equal(warning.state, 'expiring')
  assert.equal(warning.allowed, true)
  assert.match(warning.warning, /vence em 4 dia/)

  at(until + HOUR)
  const grace = access(company)
  assert.equal(grace.state, 'grace')
  assert.equal(grace.allowed, true)
  assert.match(grace.warning, /bloqueado em/)

  at(until + GRACE_DAYS * DAY - HOUR)
  assert.equal(access(company).allowed, true) // ainda dentro da carência

  at(until + GRACE_DAYS * DAY + HOUR)
  const blocked = access(company)
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.state, 'expired')
  assert.match(blocked.message, /Renove/)
})

test('PIX de 3 e 6 meses: validade correta e renovação antecipada soma ao saldo', async () => {
  const three = await payPix(newCompany(), 3, T0)
  assert.equal(new Date(three.paidUntil).toISOString(), '2026-06-10T12:00:00.000Z')

  const company = newCompany()
  const six = await payPix(company, 6, T0)
  assert.equal(new Date(six.paidUntil).toISOString(), '2026-09-10T12:00:00.000Z')

  // renova 20 dias antes de vencer: soma a partir da validade atual, não de hoje
  const renewed = await payPix(company, 1, Date.parse('2026-08-21T12:00:00.000Z'))
  assert.equal(new Date(renewed.paidUntil).toISOString(), '2026-10-10T12:00:00.000Z')
})

test('renovar depois de vencido conta a partir do pagamento, sem "crédito" do período perdido', async () => {
  const company = newCompany()
  const first = await payPix(company, 1, T0)
  const until = Date.parse(first.paidUntil) // 10/04
  const lateDay = until + 10 * DAY // bloqueado há 7 dias
  at(lateDay)
  assert.equal(access(company).allowed, false)

  const renewed = await payPix(company, 1, lateDay)
  assert.equal(new Date(renewed.paidUntil).toISOString(), '2026-05-20T12:00:00.000Z') // 20/04 + 1 mês
  assert.equal(access(company).allowed, true)
})

test('meses curtos: pagar em 31/01 vence em 28/02, não em março', async () => {
  const company = newCompany()
  const paid = await payPix(company, 1, Date.parse('2026-01-31T12:00:00.000Z'))
  assert.equal(new Date(paid.paidUntil).toISOString(), '2026-02-28T12:00:00.000Z')
})

test('o mesmo pagamento confirmado duas vezes não estende o prazo', async () => {
  const company = newCompany()
  at(T0)
  const checkout = await billing.createCheckout({ company, planId: 'profissional', method: 'pix', months: 3, origin: 'https://www.cutcore.com.br', email: company.email })
  const record = [...payments.values()].find((p) => p.external_reference === checkout.ref)
  record.status = 'approved'
  await billing.checkoutStatus(checkout.ref)
  const first = current(company).paidUntil
  at(T0 + 2 * DAY)
  await billing.checkoutStatus(checkout.ref)
  await billing.handleNotification({ type: 'payment', dataId: String(record.id) })
  assert.equal(current(company).paidUntil, first)
})

test('PIX não pago (pendente ou expirado) nunca libera o acesso', async () => {
  const company = newCompany()
  at(T0)
  const checkout = await billing.createCheckout({ company, planId: 'profissional', method: 'pix', months: 1, origin: 'https://www.cutcore.com.br', email: company.email })
  assert.equal((await billing.checkoutStatus(checkout.ref)).state, 'pending')
  assert.equal(access(company).allowed, false)

  const record = [...payments.values()].find((p) => p.external_reference === checkout.ref)
  record.status = 'cancelled'
  assert.equal((await billing.checkoutStatus(checkout.ref)).state, 'expired')
  assert.equal(access(company).allowed, false)
})

// ------------------------------------------------------------------------ cartão
test('cartão: libera na autorização e a renovação mensal confirmada mantém o acesso', async () => {
  const company = newCompany()
  const { company: active, subscription } = await authorizeCard(company, T0)
  assert.equal(active.status, 'active')
  assert.equal(active.billingMethod, 'card')
  assert.ok(Date.parse(active.paidUntil) >= Date.parse('2026-04-10T12:00:00.000Z')) // ≥ 1 mês

  // o Mercado Pago cobra o mês seguinte e informa a nova data
  const renewalDay = Date.parse(active.paidUntil) + DAY
  at(renewalDay)
  subscription.next_payment_date = new Date(renewalDay + 30 * DAY).toISOString()
  await billing.reconcile(current(company), { force: true })
  assert.equal(current(company).status, 'active')
  assert.equal(access(company).allowed, true)
  assert.ok(Date.parse(current(company).paidUntil) > renewalDay)
})

test('cartão recusado na renovação: segue com aviso e é bloqueado se não regularizar', async () => {
  const company = newCompany()
  const { company: active, subscription } = await authorizeCard(company, T0)
  const until = Date.parse(active.paidUntil)

  subscription.status = 'paused' // cobrança falhou
  at(until + HOUR)
  await billing.reconcile(current(company), { force: true })
  assert.equal(current(company).status, 'past_due')
  assert.equal(access(company).allowed, true)

  at(until + GRACE_DAYS * DAY + HOUR)
  assert.equal(access(company).allowed, false) // venceu + carência sem regularizar
})

test('cancelar o cartão mantém o acesso até o fim do período pago e depois bloqueia', async () => {
  const company = newCompany()
  const { company: active } = await authorizeCard(company, T0)
  const until = Date.parse(active.paidUntil)

  at(T0 + 3 * DAY)
  await billing.cancelSubscription(current(company))
  assert.equal(current(company).cancelAtPeriodEnd, true)
  assert.equal(access(company).allowed, true)
  assert.equal(access(company).state, 'expiring')

  at(until - DAY)
  assert.equal(access(company).allowed, true)
  at(until + GRACE_DAYS * DAY + HOUR)
  assert.equal(access(company).allowed, false)
})

// ------------------------------------------------------------ outros estados
test('suspensa, aguardando pagamento e cancelada bloqueiam; licença manual libera pelo prazo', () => {
  assert.equal(companyAccess({ status: 'suspended' }, T0).allowed, false)
  assert.equal(companyAccess({ status: 'pending_payment' }, T0).allowed, false)
  assert.equal(companyAccess({ status: 'canceled' }, T0).allowed, false)

  const manual = { status: 'active', billingMethod: 'manual', paidUntil: new Date(T0 + 30 * DAY).toISOString() }
  assert.equal(companyAccess(manual, T0 + 29 * DAY).allowed, true)
  assert.equal(companyAccess(manual, T0 + 30 * DAY + GRACE_DAYS * DAY + HOUR).allowed, false)

  // sem empresa (base da plataforma) nunca é bloqueado
  assert.equal(companyAccess(null, T0).allowed, true)
})
