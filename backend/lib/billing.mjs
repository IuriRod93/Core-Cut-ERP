import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { MODULE_KEYS } from '../../shared/access.mjs'
import { HttpError } from './http-error.mjs'

/**
 * Cobrança do Core Cut ERP (Mercado Pago).
 *
 *  - Cartão → assinatura (`/preapproval`, recorrência mensal). O cliente autoriza o
 *             cartão na página do Mercado Pago (init_point) e volta para o ERP.
 *  - PIX    → pagamento único (`/v1/payments`, `payment_method_id: pix`) de 1, 3 ou
 *             6 meses. O QR Code é exibido no próprio ERP; o pagamento libera o plano
 *             até `paidUntil` e renovar gera outro PIX, que soma à validade.
 *
 * Toda confirmação consulta a API do Mercado Pago (nunca confia só no corpo do
 * webhook) e é idempotente: retorno do pagamento, webhook e reconciliação no login
 * podem chamar quantas vezes forem.
 */

export const UNLIMITED = 999999

// Módulos incluídos em cada plano (o perfil do usuário ainda restringe dentro deles).
// Essencial já inclui ordens de produção (geradas pela aprovação do orçamento, limite de 50).
const ESSENCIAL = ['dashboard', 'tasks', 'agenda', 'leads', 'clients', 'budgets', 'contracts', 'projects', 'production', 'inventory', 'suppliers', 'financial', 'team', 'timeclock', 'files', 'settings']
const PROFISSIONAL = [...ESSENCIAL, 'cutplan', 'bom', 'purchases', 'quality', 'logistics', 'warranty', 'audit']

export const BILLING_PLANS = [
  {
    id: 'essencial',
    name: 'Essencial',
    price: 99,
    description: 'Projetos, clientes, orçamentos e financeiro básico.',
    highlights: ['Até 3 usuários', 'Projetos e orçamentos', 'Estoque e fornecedores'],
    mobileApp: false,
    limits: { maxUsers: 3, maxProjects: 50, maxBudgets: 100, maxProductionOrders: 50, maxInventoryItems: 200 },
    modules: ESSENCIAL,
  },
  {
    id: 'profissional',
    name: 'Profissional',
    price: 199,
    description: 'Operação completa para marcenarias em crescimento.',
    highlights: ['Até 10 usuários', 'Produção e plano de corte', 'Compras e qualidade', 'Aplicativo Android'],
    mobileApp: true,
    limits: { maxUsers: 10, maxProjects: 200, maxBudgets: 500, maxProductionOrders: 200, maxInventoryItems: 1000 },
    modules: PROFISSIONAL,
  },
  {
    id: 'industrial',
    name: 'Industrial',
    price: 399,
    description: 'Controle avançado para produção em escala.',
    highlights: ['Usuários ilimitados', 'Chão de fábrica e manutenção', 'Relatórios e automações', 'Aplicativo Android'],
    mobileApp: true,
    limits: { maxUsers: UNLIMITED, maxProjects: UNLIMITED, maxBudgets: UNLIMITED, maxProductionOrders: UNLIMITED, maxInventoryItems: UNLIMITED },
    modules: [...MODULE_KEYS],
  },
]

/** Coleção limitada → chave do limite no plano e rótulo exibido na mensagem de erro. */
export const LIMITED_COLLECTIONS = {
  users: { key: 'maxUsers', label: 'usuários' },
  projects: { key: 'maxProjects', label: 'projetos' },
  budgets: { key: 'maxBudgets', label: 'orçamentos' },
  productionOrders: { key: 'maxProductionOrders', label: 'ordens de produção' },
  materials: { key: 'maxInventoryItems', label: 'itens de estoque' },
}

const UNLIMITED_LIMITS = Object.fromEntries(Object.values(LIMITED_COLLECTIONS).map(({ key }) => [key, UNLIMITED]))

/** Duração do teste gratuito, em horas. */
export const TRIAL_HOURS = 48

export const PIX_MONTH_OPTIONS = [1, 3, 6]
/** Horas até o QR Code do PIX expirar. */
export const PIX_EXPIRES_HOURS = 24
/** Dias de tolerância após o vencimento antes de bloquear o acesso. */
export const GRACE_DAYS = 3
const DAY = 86_400_000

export const findPlan = (planId) => BILLING_PLANS.find((plan) => plan.id === planId)
export const getPlanLimits = (planId) => findPlan(planId)?.limits ?? UNLIMITED_LIMITS
export const getPlanModules = (planId) => findPlan(planId)?.modules ?? [...MODULE_KEYS]

export const publicPlans = () =>
  BILLING_PLANS.map(({ id, name, price, description, highlights, limits, modules, mobileApp }) => ({ id, name, price, currency: 'BRL', interval: 'month', description, highlights, limits, modules, mobileApp: Boolean(mobileApp) }))

/** O aplicativo Android é um direito dos planos Profissional e Industrial. */
export const planHasMobileApp = (planId) => Boolean(BILLING_PLANS.find((plan) => plan.id === planId)?.mobileApp)

export const pixAmount = (plan, months) => Math.round(plan.price * months * 100) / 100

// ---------------------------------------------------------------- acesso
const addMonths = (from, months) => {
  const date = new Date(from)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return date
}

/**
 * Situação de acesso de uma empresa.
 * `allowed: false` bloqueia o ERP (o usuário só vê a tela de assinatura);
 * `warning` é um aviso não bloqueante (vencendo, em carência, renovação falhou).
 */
export function companyAccess(company, now = Date.now()) {
  if (!company) return { allowed: true, state: 'platform' }
  const until = company.paidUntil ? Date.parse(company.paidUntil) : null
  const daysLeft = until ? Math.ceil((until - now) / DAY) : null
  const base = { paidUntil: company.paidUntil ?? null, daysLeft, method: company.billingMethod ?? null }

  if (company.status === 'suspended') {
    return { ...base, allowed: false, state: 'suspended', message: 'Acesso suspenso. Entre em contato com a Core Cut pelo WhatsApp (21) 99307-9682.' }
  }
  if (company.status === 'trial') {
    const end = company.trialEndsAt ? Date.parse(company.trialEndsAt) : 0
    const trialBase = { ...base, trialEndsAt: company.trialEndsAt ?? null }
    if (now > end) {
      return { ...trialBase, allowed: false, state: 'trial_expired', message: 'Seu teste gratuito de 48 horas terminou. Escolha um plano para continuar usando o sistema — seus dados estão guardados.' }
    }
    const hoursLeft = Math.max(1, Math.ceil((end - now) / 3_600_000))
    const label = hoursLeft >= 24 ? `${Math.floor(hoursLeft / 24)} dia(s) e ${hoursLeft % 24} h` : `${hoursLeft} h`
    return { ...trialBase, allowed: true, state: 'trial', hoursLeft, warning: `Teste gratuito: restam ${label}. Assine um plano para não perder o acesso.` }
  }
  if (company.status === 'pending_payment') {
    return { ...base, allowed: false, state: 'pending_payment', message: 'Pagamento pendente. Conclua o pagamento para liberar o acesso ao ERP.' }
  }
  if (company.status === 'canceled') {
    return { ...base, allowed: false, state: 'canceled', message: 'Assinatura cancelada. Escolha uma forma de pagamento para reativar o acesso.' }
  }
  if (until && now > until + GRACE_DAYS * DAY) {
    return { ...base, allowed: false, state: 'expired', message: 'Assinatura vencida. Renove o plano para voltar a usar o ERP.' }
  }
  if (until && now > until) {
    return { ...base, allowed: true, state: 'grace', warning: `Assinatura vencida. O acesso será bloqueado em ${Math.max(1, Math.ceil((until + GRACE_DAYS * DAY - now) / DAY))} dia(s) sem renovação.` }
  }
  if (company.status === 'past_due') {
    return { ...base, allowed: true, state: 'past_due', warning: 'Não conseguimos cobrar a última renovação. Atualize a forma de pagamento para evitar a suspensão.' }
  }
  if (company.cancelAtPeriodEnd && until) {
    return { ...base, allowed: true, state: 'expiring', warning: `Assinatura cancelada: o acesso vai até ${new Date(until).toLocaleDateString('pt-BR')}. Reative para continuar.` }
  }
  if (until && company.billingMethod === 'pix' && daysLeft <= 5) {
    return { ...base, allowed: true, state: 'expiring', warning: `Seu plano vence em ${Math.max(daysLeft, 0)} dia(s). Renove por PIX para não perder o acesso.` }
  }
  return { ...base, allowed: true, state: 'active' }
}

// ---------------------------------------------------------- Mercado Pago
export const gatewayToken = () => process.env.MERCADOPAGO_ACCESS_TOKEN || ''

/**
 * 'unconfigured' | 'test' | 'live'. Tokens `TEST-…` são de teste; credenciais de
 * usuários de teste usam `APP_USR-…`, então marque MERCADOPAGO_MODE=test nesse caso.
 */
export const gatewayMode = () => {
  const token = gatewayToken()
  if (!token) return 'unconfigured'
  if (process.env.MERCADOPAGO_MODE === 'test' || /^TEST-/.test(token)) return 'test'
  return 'live'
}

/** "Simular pagamento" ativa a conta sem cobrar; nunca com credenciais de produção. */
export const simulationAllowed = () => {
  if (process.env.ALLOW_SIMULATED_SIGNUP === '0') return false
  if (process.env.ALLOW_SIMULATED_SIGNUP === '1') return true
  return process.env.NODE_ENV !== 'production' && gatewayMode() !== 'live'
}

const MP_MESSAGES = [
  [/back_url|back_urls|auto_return|invalid.*url|notification_url/i, 'O Mercado Pago recusou o endereço de retorno do pagamento (ele costuma exigir HTTPS público). Use um domínio ou um túnel HTTPS (Cloudflare Tunnel) e ajuste APP_URL.'],
  [/payer.*email|email.*invalid|invalid.*email/i, 'O Mercado Pago recusou o e-mail informado. Confira o e-mail e tente novamente.'],
  [/not.*allowed|forbidden|permission/i, 'A conta do Mercado Pago não tem permissão para esta operação (confira se ela está ativada para receber).'],
]

export function createMercadoPago({ base = process.env.MERCADOPAGO_API_BASE || 'https://api.mercadopago.com', fetchImpl = globalThis.fetch } = {}) {
  async function request(method, path, { body, query, idempotencyKey } = {}) {
    const token = gatewayToken()
    if (!token) throw new HttpError(503, 'O Mercado Pago não está configurado no servidor (defina MERCADOPAGO_ACCESS_TOKEN).')
    const qs = query ? `?${new URLSearchParams(query)}` : ''
    let response
    try {
      response = await fetchImpl(`${base}${path}${qs}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      console.error(`[mercadopago] ${method} ${path} sem resposta:`, error?.cause?.message ?? error?.message ?? error)
      throw new HttpError(502, 'Não foi possível conectar ao Mercado Pago agora. Tente novamente em instantes.')
    }
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detail = [data?.message, ...(Array.isArray(data?.cause) ? data.cause.map((c) => c?.description) : []), data?.error].filter(Boolean).join(' | ')
      console.error(`[mercadopago] ${method} ${path} → ${response.status}: ${detail}`)
      const friendly = response.status === 401 ? 'O token do Mercado Pago configurado no servidor é inválido ou expirou.' : MP_MESSAGES.find(([pattern]) => pattern.test(detail))?.[1]
      throw new HttpError(response.status === 404 ? 404 : 502, friendly ?? (detail || 'O Mercado Pago recusou a operação.'))
    }
    return data
  }
  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body, idempotencyKey) => request('POST', path, { body, idempotencyKey }),
    put: (path, body) => request('PUT', path, { body }),
  }
}

// ------------------------------------------------- aplicar pagamento/assinatura
const splitName = (name) => {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  return { first_name: parts[0] ?? 'Cliente', last_name: parts.slice(1).join(' ') || 'Core Cut' }
}

/** ISO 8601 com o fuso de Brasília, formato exigido pelo Mercado Pago em date_of_expiration. */
const brasiliaIso = (ms) => `${new Date(ms - 3 * 3_600_000).toISOString().slice(0, -1)}-03:00`

/**
 * O Mercado Pago recusa a palavra "localhost" no `back_url` ("must be a valid URL"),
 * mas aceita 127.0.0.1: em desenvolvimento o retorno usa o endereço numérico.
 */
export const returnBase = (origin) => String(origin).replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, '$1127.0.0.1')

const PAYMENT_FAILED = new Set(['rejected', 'cancelled', 'refunded', 'charged_back'])

export function createBilling({ db, gateway = createMercadoPago(), now = () => Date.now(), onPaid = null }) {
  const companies = () => db.all('companies')
  const findCompany = (id) => companies().find((company) => company.id === id)
  const patchCompany = (id, patch) => db.update('companies', id, patch)
  const checkouts = () => db.all('billingCheckouts')
  const findCheckout = (ref) => checkouts().find((entry) => entry.id === ref)
  const eventSeen = (id) => db.all('billingEvents').some((event) => event.id === id)
  const recordEvent = (id, type, extra = {}) => db.insert('billingEvents', { id, type, receivedAt: new Date(now()).toISOString(), ...extra })
  const iso = (ms = now()) => new Date(ms).toISOString()

  /** Libera/estende o acesso por um checkout pago. Idempotente por `checkout:<ref>`. */
  async function applyPaid(record, resource) {
    const company = findCompany(record.companyId)
    if (!company) return { state: 'unknown' }
    const eventId = `checkout:${record.id}`
    if (eventSeen(eventId)) return { state: 'paid', company, duplicate: true }
    recordEvent(eventId, 'checkout.applied', { companyId: company.id })
    try {
      const plan = findPlan(record.planId) ?? findPlan(company.planId)
      const patch = {
        status: 'active',
        billingStatus: 'active',
        planId: plan.id,
        planName: plan.name,
        planPrice: plan.price,
        lastPaymentAt: iso(),
        paidAt: company.paidAt ?? iso(),
        cancelAtPeriodEnd: false,
        lastPaymentError: null,
      }
      if (record.method === 'card') {
        const next = resource?.next_payment_date ? Date.parse(resource.next_payment_date) : 0
        const floor = addMonths(now(), 1).getTime()
        patch.billingMethod = 'card'
        patch.mpSubscriptionId = record.mpPreapprovalId
        patch.subscriptionStatus = resource?.status ?? 'authorized'
        // a 1ª cobrança ocorre logo após a autorização; a próxima data real chega pela reconciliação
        patch.paidUntil = iso(Math.max(next, floor))
        const previous = company.mpSubscriptionId
        if (previous && previous !== record.mpPreapprovalId) {
          await gateway.put(`/preapproval/${previous}`, { status: 'cancelled' }).catch((error) => console.error('[billing] Não foi possível cancelar a assinatura anterior.', error.message))
        }
      } else {
        const months = Math.max(1, Math.min(12, Number(record.months) || 1))
        const current = company.paidUntil ? Date.parse(company.paidUntil) : 0
        const start = company.billingMethod === 'pix' && current > now() ? current : now()
        patch.billingMethod = 'pix'
        patch.paidUntil = addMonths(start, months).toISOString()
        patch.pixMonths = months
      }
      const updated = patchCompany(company.id, patch)
      db.update('billingCheckouts', record.id, { state: 'paid', paidAt: iso() })
      try {
        onPaid?.(updated, record)
      } catch (error) {
        console.error('[billing] Falha ao avisar o pagamento aprovado.', error?.message ?? error)
      }
      return { state: 'paid', company: updated }
    } catch (error) {
      db.remove('billingEvents', eventId)
      throw error
    }
  }

  /** Reflete o estado de uma assinatura (preapproval) na empresa. */
  function applySubscription(preapproval, company) {
    company ??= companies().find((entry) => entry.mpSubscriptionId === preapproval.id)
    if (!company) return null
    if (company.mpSubscriptionId && company.mpSubscriptionId !== preapproval.id) return company // assinatura antiga (troca de plano)
    const patch = { subscriptionStatus: preapproval.status, mpSubscriptionId: preapproval.id }
    const current = company.paidUntil ? Date.parse(company.paidUntil) : 0
    const next = preapproval.next_payment_date ? Date.parse(preapproval.next_payment_date) : 0
    if (preapproval.status === 'authorized') {
      Object.assign(patch, { status: 'active', billingStatus: 'active', cancelAtPeriodEnd: false })
      if (next > current) patch.paidUntil = new Date(next).toISOString()
    } else if (preapproval.status === 'paused') {
      Object.assign(patch, { status: 'past_due', billingStatus: 'past_due' })
    } else if (preapproval.status === 'cancelled') {
      // cancelado pelo cliente ou por falhas de cobrança: o período já pago continua valendo
      if (current > now()) patch.cancelAtPeriodEnd = true
      else Object.assign(patch, { status: 'canceled', billingStatus: 'canceled' })
    }
    return patchCompany(company.id, patch)
  }

  /** Consulta o Mercado Pago e aplica o resultado de um checkout. */
  async function syncCheckout(record) {
    // Cobrança de teste da plataforma: não pertence a nenhuma empresa, só confirma o recebimento.
    if (record.kind === 'platform-test') {
      if (record.method === 'pix') {
        const payment = await gateway.get(`/v1/payments/${record.mpPaymentId}`)
        if (payment.status === 'approved') {
          db.update('billingCheckouts', record.id, { state: 'paid', paidAt: iso(), mpStatus: payment.status })
          return { state: 'paid' }
        }
        if (PAYMENT_FAILED.has(payment.status) || (payment.date_of_expiration && Date.parse(payment.date_of_expiration) < now())) {
          db.update('billingCheckouts', record.id, { state: 'expired', mpStatus: payment.status })
          return { state: 'expired' }
        }
        return { state: 'pending' }
      }
      const preapproval = await gateway.get(`/preapproval/${record.mpPreapprovalId}`)
      if (preapproval.status === 'authorized') {
        db.update('billingCheckouts', record.id, { state: 'paid', paidAt: record.paidAt ?? iso(), mpStatus: preapproval.status })
        return { state: 'paid' }
      }
      if (preapproval.status === 'cancelled') {
        db.update('billingCheckouts', record.id, { state: record.state === 'paid' ? 'cancelled' : 'expired', mpStatus: preapproval.status })
        return { state: record.state === 'paid' ? 'paid' : 'expired' }
      }
      return { state: 'pending' }
    }
    if (record.method === 'pix') {
      const payment = await gateway.get(`/v1/payments/${record.mpPaymentId}`)
      if (payment.status === 'approved') return applyPaid(record, payment)
      const expired = PAYMENT_FAILED.has(payment.status) || (payment.date_of_expiration && Date.parse(payment.date_of_expiration) < now())
      if (expired) {
        db.update('billingCheckouts', record.id, { state: 'expired' })
        return { state: 'expired', company: findCompany(record.companyId) }
      }
      return { state: 'pending', company: findCompany(record.companyId) }
    }
    const preapproval = await gateway.get(`/preapproval/${record.mpPreapprovalId}`)
    if (preapproval.status === 'authorized') return applyPaid(record, preapproval)
    if (preapproval.status === 'cancelled') {
      db.update('billingCheckouts', record.id, { state: 'expired' })
      return { state: 'expired', company: findCompany(record.companyId) }
    }
    return { state: 'pending', company: findCompany(record.companyId) }
  }

  /** Estado público de um checkout (retorno do pagamento e polling do QR Code). */
  async function checkoutStatus(ref) {
    const record = findCheckout(ref)
    if (!record) return { state: 'unknown' }
    const result = record.state === 'paid' ? { state: 'paid', company: findCompany(record.companyId) } : await syncCheckout(record)
    return { ...result, method: record.method, record }
  }

  /**
   * Notificação do Mercado Pago (já validada). Os dados vêm sempre da API.
   * Tópicos: payment, subscription_preapproval, subscription_authorized_payment.
   */
  async function handleNotification({ type, dataId }) {
    if (!dataId) return { handled: false }
    if (type === 'payment') {
      const payment = await gateway.get(`/v1/payments/${dataId}`)
      const record = findCheckout(payment.external_reference) ?? checkouts().find((entry) => String(entry.mpPaymentId) === String(dataId))
      if (record?.kind === 'platform-test') {
        if (payment.status === 'approved') await syncCheckout(record)
        return { handled: true }
      }
      if (record && record.method === 'pix' && payment.status === 'approved') return applyPaid(record, payment)
      return { handled: Boolean(record) }
    }
    if (type === 'subscription_preapproval' || type === 'subscription_authorized_payment') {
      let preapprovalId = dataId
      if (type === 'subscription_authorized_payment') {
        const authorized = await gateway.get(`/authorized_payments/${dataId}`)
        preapprovalId = authorized.preapproval_id
      }
      if (!preapprovalId) return { handled: false }
      const preapproval = await gateway.get(`/preapproval/${preapprovalId}`)
      const record = findCheckout(preapproval.external_reference)
      if (record?.kind === 'platform-test') {
        await syncCheckout(record)
        return { handled: true }
      }
      if (record && preapproval.status === 'authorized' && record.state !== 'paid') await applyPaid(record, preapproval)
      applySubscription(preapproval)
      return { handled: true }
    }
    return { handled: false }
  }

  const reconciledAt = new Map()

  /**
   * Confere no Mercado Pago o que o webhook pode não ter entregue (ambiente local,
   * webhook fora do ar): checkouts pendentes e assinatura de cartão vencida.
   */
  async function reconcile(company, { force = false } = {}) {
    if (!company || gatewayMode() === 'unconfigured') return company
    const last = reconciledAt.get(company.id) ?? 0
    if (!force && now() - last < 20_000) return findCompany(company.id)
    reconciledAt.set(company.id, now())
    try {
      const pending = checkouts()
        .filter((entry) => entry.companyId === company.id && entry.state === 'pending')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 3)
      for (const record of pending) await syncCheckout(record)
      const current = findCompany(company.id)
      const expired = current.paidUntil && Date.parse(current.paidUntil) < now()
      if (current.billingMethod === 'card' && current.mpSubscriptionId && (expired || current.status === 'past_due')) {
        applySubscription(await gateway.get(`/preapproval/${current.mpSubscriptionId}`), current)
      }
    } catch (error) {
      console.error('[billing] Reconciliação com o Mercado Pago falhou:', error.message)
    }
    return findCompany(company.id)
  }

  const notificationUrl = (origin) => (/^https:\/\//i.test(origin) ? `${origin}/api/billing/webhook` : undefined)

  /**
   * Inicia um pagamento.
   *  - card → { checkoutUrl } (página do Mercado Pago para autorizar o cartão)
   *  - pix  → { pix: { qrCode, qrCodeBase64, ticketUrl, expiresAt, amount } } (exibido no ERP)
   */
  async function createCheckout({ company, planId, method, months = 1, origin, email, payerName }) {
    const plan = findPlan(planId ?? company.planId)
    if (!plan) throw new HttpError(400, 'Selecione um plano válido.')
    if (!['card', 'pix'].includes(method)) throw new HttpError(400, 'Escolha cartão ou PIX.')
    if (method === 'pix' && !PIX_MONTH_OPTIONS.includes(Number(months))) throw new HttpError(400, 'Escolha 1, 3 ou 6 meses para o PIX.')
    const payerEmail = String(email ?? company.email ?? '').trim()
    const ref = randomUUID()
    const notification = notificationUrl(origin)
    const meta = { company_id: company.id, plan_id: plan.id, method, months: method === 'pix' ? Number(months) : 1 }
    const base = { id: ref, companyId: company.id, planId: plan.id, method, months: meta.months, state: 'pending' }

    if (method === 'pix') {
      const amount = pixAmount(plan, meta.months)
      const expiresAt = now() + PIX_EXPIRES_HOURS * 3_600_000
      const payment = await gateway.post('/v1/payments', {
        transaction_amount: amount,
        description: `Core Cut ERP - Plano ${plan.name} (${meta.months} ${meta.months === 1 ? 'mês' : 'meses'})`,
        payment_method_id: 'pix',
        payer: { email: payerEmail, ...splitName(payerName ?? company.name) },
        external_reference: ref,
        date_of_expiration: brasiliaIso(expiresAt),
        metadata: meta,
        ...(notification ? { notification_url: notification } : {}),
      }, ref)
      const data = payment.point_of_interaction?.transaction_data ?? {}
      if (!data.qr_code) throw new HttpError(502, 'O Mercado Pago não retornou o código PIX. Tente novamente.')
      db.insert('billingCheckouts', { ...base, mpPaymentId: String(payment.id), amount })
      patchCompany(company.id, { lastCheckoutId: ref, pendingPlanId: plan.id, pendingMethod: 'pix' })
      return { ref, method, plan, months: meta.months, pix: { qrCode: data.qr_code, qrCodeBase64: data.qr_code_base64 ?? null, ticketUrl: data.ticket_url ?? null, expiresAt: new Date(expiresAt).toISOString(), amount } }
    }

    const preapproval = await gateway.post('/preapproval', {
      reason: `Core Cut ERP - Plano ${plan.name}`,
      external_reference: ref,
      payer_email: payerEmail,
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: plan.price, currency_id: 'BRL' },
      back_url: `${returnBase(origin)}/assinatura?checkout=success&ref=${ref}`,
      status: 'pending',
      ...(notification ? { notification_url: notification } : {}),
    })
    const checkoutUrl = preapproval.init_point ?? preapproval.sandbox_init_point
    if (!checkoutUrl) throw new HttpError(502, 'O Mercado Pago não retornou o endereço de pagamento.')
    db.insert('billingCheckouts', { ...base, mpPreapprovalId: String(preapproval.id), amount: plan.price })
    patchCompany(company.id, { lastCheckoutId: ref, pendingPlanId: plan.id, pendingMethod: 'card' })
    return { ref, method, plan, months: 1, checkoutUrl }
  }

  /**
   * Cobrança de teste da plataforma (R$ 1 a R$ 50): confirma que o dinheiro chega na conta do
   * Mercado Pago. Não altera nenhuma empresa. PIX = pagamento único; cartão = assinatura mensal
   * que deve ser cancelada logo após a primeira cobrança.
   */
  async function createPlatformTest({ method, amount, payerEmail, origin }) {
    if (!['pix', 'card'].includes(method)) throw new HttpError(400, 'Escolha PIX ou cartão.')
    const value = Math.round(Number(amount) * 100) / 100
    if (!Number.isFinite(value) || value < 1 || value > 50) throw new HttpError(400, 'Informe um valor de R$ 1,00 a R$ 50,00.')
    const email = String(payerEmail ?? '').trim()
    if (method === 'card' && !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Informe o e-mail da conta Mercado Pago de quem vai pagar (diferente da sua conta de vendedor).')
    const ref = randomUUID()
    const base = { id: ref, kind: 'platform-test', companyId: null, planId: null, method, months: 1, amount: value, state: 'pending' }
    const notification = notificationUrl(origin)

    if (method === 'pix') {
      const expiresAt = now() + 2 * 3_600_000
      const payment = await gateway.post('/v1/payments', {
        transaction_amount: value,
        description: 'Core Cut ERP - teste de cobranca',
        payment_method_id: 'pix',
        payer: { email: email || 'teste-cobranca@cutcore.com.br', first_name: 'Teste', last_name: 'Core Cut' },
        external_reference: ref,
        date_of_expiration: brasiliaIso(expiresAt),
        metadata: { kind: 'platform-test' },
        ...(notification ? { notification_url: notification } : {}),
      }, ref)
      const data = payment.point_of_interaction?.transaction_data ?? {}
      if (!data.qr_code) throw new HttpError(502, 'O Mercado Pago não retornou o código PIX. Tente novamente.')
      db.insert('billingCheckouts', { ...base, mpPaymentId: String(payment.id) })
      return { ref, method, amount: value, pix: { qrCode: data.qr_code, qrCodeBase64: data.qr_code_base64 ?? null, ticketUrl: data.ticket_url ?? null, expiresAt: new Date(expiresAt).toISOString(), amount: value } }
    }

    const preapproval = await gateway.post('/preapproval', {
      reason: 'Core Cut ERP - teste de cobranca (cancelar apos o teste)',
      external_reference: ref,
      payer_email: email,
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: value, currency_id: 'BRL' },
      back_url: `${returnBase(origin)}/admin`,
      status: 'pending',
      ...(notification ? { notification_url: notification } : {}),
    })
    const checkoutUrl = preapproval.init_point ?? preapproval.sandbox_init_point
    if (!checkoutUrl) throw new HttpError(502, 'O Mercado Pago não retornou o endereço de pagamento.')
    db.insert('billingCheckouts', { ...base, mpPreapprovalId: String(preapproval.id) })
    return { ref, method, amount: value, checkoutUrl }
  }

  /** Encerra a assinatura de teste (para de cobrar nos próximos meses). */
  async function cancelPlatformTest(ref) {
    const record = findCheckout(ref)
    if (!record || record.kind !== 'platform-test' || record.method !== 'card') throw new HttpError(404, 'Teste não encontrado.')
    await gateway.put(`/preapproval/${record.mpPreapprovalId}`, { status: 'cancelled' })
    db.update('billingCheckouts', record.id, { state: record.state === 'paid' ? 'cancelled' : 'expired' })
    return { ok: true }
  }

  /** Cancela a cobrança recorrente; o período já pago continua valendo. */
  async function cancelSubscription(company) {
    if (company.billingMethod !== 'card' || !company.mpSubscriptionId) throw new HttpError(409, 'Esta empresa não tem assinatura recorrente no cartão.')
    if (company.cancelAtPeriodEnd) throw new HttpError(409, 'A assinatura já está cancelada; o acesso segue até o fim do período pago.')
    await gateway.put(`/preapproval/${company.mpSubscriptionId}`, { status: 'cancelled' })
    return applySubscription({ id: company.mpSubscriptionId, status: 'cancelled' }, company)
  }

  return { applyPaid, applySubscription, checkoutStatus, handleNotification, reconcile, createCheckout, cancelSubscription, createPlatformTest, cancelPlatformTest, findCompany, gateway }
}

// -------------------------------------------------------------- webhook
/**
 * Valida `x-signature` (`ts=…,v1=…`): HMAC-SHA256 do manifesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` com a chave secreta da aplicação.
 */
export function verifyMercadoPagoSignature({ signature, requestId, dataId, secret, nowMs = Date.now() }) {
  if (!secret) throw new HttpError(503, 'MERCADOPAGO_WEBHOOK_SECRET não está configurado.')
  const parts = Object.fromEntries(String(signature ?? '').split(',').map((part) => part.trim().split('=')).filter((pair) => pair.length === 2))
  const ts = String(parts.ts ?? '')
  const received = String(parts.v1 ?? '')
  if (!ts || !received) throw new HttpError(400, 'Assinatura do Mercado Pago ausente.')
  const tsMs = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > 10 * 60_000) throw new HttpError(400, 'Assinatura do Mercado Pago expirada.')
  const id = /^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId)
  const manifest = `id:${id};request-id:${requestId ?? ''};ts:${ts};`
  const expected = createHmac('sha256', secret).update(manifest).digest('hex')
  const left = Buffer.from(expected)
  const right = Buffer.from(received)
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new HttpError(400, 'Assinatura do Mercado Pago inválida.')
}
