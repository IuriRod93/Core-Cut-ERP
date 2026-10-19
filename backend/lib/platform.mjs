import { randomBytes } from 'node:crypto'
import { passwordProblem } from './auth.mjs'
import { statfsSync } from 'node:fs'
import os from 'node:os'
import { ROLES } from '../../shared/access.mjs'
import { gatewayMode, gatewayToken, simulationAllowed } from './billing.mjs'

/**
 * Painel da plataforma (somente administradores da base original, sem empresa).
 * Roda fora do contexto de empresa: enxerga todas as empresas e usuários.
 */
export function createPlatform({ db, sessions, billing, publicOrigin, metrics, mailer, seedCompany, trialHours = 48, dataDir, HttpError, hashPassword, verifyAccess, findPlan, getPlanLimits, companyUsage, assertCapacity, faces, faceEngine, now = () => Date.now() }) {
  const DAY = 86_400_000
  const HOUR = 3_600_000
  const generatePassword = () => randomBytes(9).toString('base64url')
  const companies = () => db.all('companies')
  const usersOf = (companyId) => db.all('users').filter((entry) => entry.companyId === companyId)
  const publicUser = (entry) => ({
    id: entry.id,
    name: entry.name,
    email: entry.email,
    role: entry.role,
    active: entry.active !== false,
    companyId: entry.companyId ?? null,
    companyRole: entry.companyRole ?? null,
    lastLoginAt: entry.lastLoginAt ?? null,
    passwordMustChange: Boolean(entry.passwordMustChange),
    createdAt: entry.createdAt,
  })
  /** Situação de pagamento da empresa de um usuário, em linguagem do painel. */
  const paymentOf = (company) => {
    if (!company) return { status: 'platform', label: 'Plataforma', companyId: null, companyName: '— plataforma —' }
    const access = verifyAccess(company)
    const method = company.billingMethod ?? null
    let status = 'unpaid'
    if (company.status === 'suspended') status = 'suspended'
    else if (access.state === 'trial') status = 'trial'
    else if (method === 'manual' && access.allowed) status = 'manual'
    else if (['card', 'pix'].includes(method ?? '') && access.allowed) status = 'paid'
    else if (company.lastPaymentAt || company.paidAt) status = 'expired'
    const labels = { paid: 'Pago', manual: 'Licença manual', trial: 'Em teste', unpaid: 'Não pagou', expired: 'Vencido', suspended: 'Suspenso', platform: 'Plataforma' }
    return {
      status,
      label: labels[status],
      companyId: company.id,
      companyName: company.name,
      planName: company.planName,
      planPrice: company.planPrice,
      method,
      accessState: access.state,
      allowed: access.allowed,
      paidUntil: company.paidUntil ?? null,
      trialEndsAt: company.trialEndsAt ?? null,
      lastPaymentAt: company.lastPaymentAt ?? null,
    }
  }
  const userRow = (entry) => ({ ...publicUser(entry), position: entry.position ?? '', payment: paymentOf(companies().find((c) => c.id === entry.companyId)) })

  const need = (id) => {
    const company = companies().find((entry) => entry.id === id)
    if (!company) throw new HttpError(404, 'Empresa não encontrada.')
    return company
  }
  const needUser = (id) => {
    const found = db.all('users').find((entry) => entry.id === id)
    if (!found) throw new HttpError(404, 'Usuário não encontrado.')
    return found
  }

  const companyRow = (company) => {
    const users = usersOf(company.id)
    const lastLogin = users.map((entry) => entry.lastLoginAt).filter(Boolean).sort().at(-1) ?? null
    return {
      id: company.id,
      name: company.name,
      legalName: company.legalName ?? '',
      document: company.document ?? '',
      email: company.email,
      phone: company.phone ?? '',
      planId: company.planId,
      planName: company.planName,
      planPrice: company.planPrice,
      status: company.status,
      billingMethod: company.billingMethod ?? null,
      paidUntil: company.paidUntil ?? null,
      trialEndsAt: company.trialEndsAt ?? null,
      cancelAtPeriodEnd: Boolean(company.cancelAtPeriodEnd),
      lastPaymentAt: company.lastPaymentAt ?? null,
      createdAt: company.createdAt,
      access: verifyAccess(company),
      usage: companyUsage(company.id),
      limits: getPlanLimits(company.planId),
      userCount: users.length,
      lastLoginAt: lastLogin,
      fiscalPlatform: Boolean(company.fiscalPlatform),
    }
  }

  const paymentRows = () =>
    db
      .all('billingCheckouts')
      .map((entry) => {
        const company = companies().find((c) => c.id === entry.companyId)
        const isTest = entry.kind === 'platform-test'
        return {
          id: entry.id,
          kind: entry.kind ?? 'subscription',
          companyId: entry.companyId,
          companyName: isTest ? 'Teste de cobrança (plataforma)' : company?.name ?? '(empresa removida)',
          companyEmail: company?.email ?? '',
          planId: entry.planId,
          planName: isTest ? 'Teste de cobrança' : findPlan(entry.planId)?.name ?? entry.planId,
          method: entry.method,
          months: entry.months,
          amount: entry.amount ?? 0,
          state: entry.state,
          createdAt: entry.createdAt,
          paidAt: entry.paidAt ?? null,
        }
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))

  const audit = (actor, action, company, extra = {}) =>
    db.audit({ userId: actor.id, userName: actor.name, action, collection: 'platform', docId: company?.id ?? null, label: String(company?.name ?? '').slice(0, 140), ...extra })

  /**
   * Indicadores financeiros da plataforma: receita recorrente (MRR), clientes pagantes, churn,
   * conversão do teste de 48 h e receita recebida por mês (exclui cobranças de teste da plataforma).
   */
  function finance() {
    const t = now()
    const DAYS = 86_400_000
    const list = companies()
    const rows = list.map((company) => ({ company, access: verifyAccess(company) }))
    const everPaid = (c) => Boolean(c.lastPaymentAt || c.paidAt)
    const payingNow = rows.filter(({ company, access }) => ['card', 'pix'].includes(company.billingMethod ?? '') && company.status === 'active' && access.allowed && access.state !== 'grace')
    const mrr = payingNow.reduce((sum, { company }) => sum + (Number(company.planPrice) || 0), 0)
    const byPlan = new Map()
    for (const { company } of payingNow) {
      const entry = byPlan.get(company.planId) ?? { planId: company.planId, planName: company.planName ?? company.planId, customers: 0, mrr: 0 }
      entry.customers += 1
      entry.mrr += Number(company.planPrice) || 0
      byPlan.set(company.planId, entry)
    }
    // perderam o acesso depois de terem pago: cancelou, venceu ou foi suspenso nos últimos 30 dias
    const churned = rows.filter(({ company, access }) => {
      if (!everPaid(company) || access.allowed) return false
      const until = company.paidUntil ? Date.parse(company.paidUntil) : 0
      return until > t - 30 * DAYS
    })
    const signups = list.length
    const paidEver = list.filter(everPaid).length
    const trialsOpen = rows.filter(({ access }) => access.state === 'trial').length
    const trialsLost = rows.filter(({ company, access }) => access.state === 'trial_expired' && !everPaid(company)).length

    const monthKey = (iso) => String(iso).slice(0, 7)
    const months = []
    const cursor = new Date(t)
    cursor.setUTCDate(1)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - i, 1))
      months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    const revenue = new Map(months.map((m) => [m, { month: m, amount: 0, payments: 0 }]))
    for (const entry of db.all('billingCheckouts')) {
      if (entry.kind === 'platform-test' || entry.state !== 'paid' || !entry.paidAt) continue
      const bucket = revenue.get(monthKey(entry.paidAt))
      if (bucket) {
        bucket.amount += Number(entry.amount) || 0
        bucket.payments += 1
      }
    }
    const renewals = payingNow
      .filter(({ company }) => company.paidUntil && Date.parse(company.paidUntil) - t <= 7 * DAYS && company.billingMethod === 'pix')
      .map(({ company }) => ({ companyId: company.id, companyName: company.name, planName: company.planName, paidUntil: company.paidUntil, amount: Number(company.planPrice) || 0 }))
      .sort((a, b) => String(a.paidUntil).localeCompare(String(b.paidUntil)))
    const churnBase = payingNow.length + churned.length
    return {
      mrr,
      arr: mrr * 12,
      payingCustomers: payingNow.length,
      arpu: payingNow.length ? Math.round((mrr / payingNow.length) * 100) / 100 : 0,
      manualLicenses: rows.filter(({ company, access }) => company.billingMethod === 'manual' && access.allowed).length,
      trialsOpen,
      trialsLost,
      signups,
      conversionRate: signups ? Math.round((paidEver / signups) * 1000) / 10 : 0,
      churned30d: churned.length,
      churnRate: churnBase ? Math.round((churned.length / churnBase) * 1000) / 10 : 0,
      revenueByMonth: [...revenue.values()],
      byPlan: [...byPlan.values()].sort((a, b) => b.mrr - a.mrr),
      upcomingRenewals: renewals,
      churnedCompanies: churned.slice(0, 20).map(({ company }) => ({ companyId: company.id, companyName: company.name, planName: company.planName, paidUntil: company.paidUntil })),
    }
  }

  function overview() {
    const rows = companies().map(companyRow)
    const count = (predicate) => rows.filter(predicate).length
    const paying = rows.filter((r) => ['card', 'pix', 'manual'].includes(r.billingMethod ?? '') && r.status === 'active' && r.access.allowed)
    const payments = paymentRows()
    const since = (days) => now() - days * DAY
    const paid30 = payments.filter((p) => p.kind !== 'platform-test' && p.state === 'paid' && p.paidAt && Date.parse(p.paidAt) >= since(30))
    return {
      companies: rows.length,
      trial: count((r) => r.access.state === 'trial'),
      trialExpired: count((r) => r.access.state === 'trial_expired'),
      paying: paying.filter((r) => r.billingMethod !== 'manual').length,
      manual: paying.filter((r) => r.billingMethod === 'manual').length,
      pendingPayment: count((r) => r.access.state === 'pending_payment'),
      blocked: count((r) => !r.access.allowed),
      pastDue: count((r) => ['past_due', 'grace'].includes(r.access.state)),
      suspended: count((r) => r.status === 'suspended'),
      users: db.all('users').filter((u) => u.companyId).length,
      signups7d: count((r) => Date.parse(r.createdAt) >= since(7)),
      signups30d: count((r) => Date.parse(r.createdAt) >= since(30)),
      mrrEstimate: paying.filter((r) => r.billingMethod !== 'manual').reduce((sum, r) => sum + Number(r.planPrice || 0), 0),
      revenue30d: paid30.reduce((sum, p) => sum + Number(p.amount || 0), 0),
      paymentsPaid30d: paid30.length,
      trialsEndingSoon: rows.filter((r) => r.access.state === 'trial' && (r.access.hoursLeft ?? 99) <= 12).map((r) => ({ id: r.id, name: r.name, hoursLeft: r.access.hoursLeft })),
      recentSignups: [...rows].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8).map((r) => ({ id: r.id, name: r.name, email: r.email, planName: r.planName, state: r.access.state, createdAt: r.createdAt })),
    }
  }

  // ------------------------------------------------------------ monitoramento
  async function monitor() {
    const snapshot = metrics.snapshot()
    let database = { engine: db.isPostgres ? 'PostgreSQL' : 'Arquivo JSON', ok: true, latencyMs: null, schema: db.schemaVersion ?? null }
    if (db.isPostgres) {
      const started = process.hrtime.bigint()
      try {
        await db.checkHealth()
        database.latencyMs = Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10
      } catch (error) {
        database = { ...database, ok: false, error: String(error?.message ?? error).slice(0, 160) }
      }
    }
    let disk = null
    try {
      const stats = statfsSync(dataDir)
      disk = { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize }
    } catch {
      /* sistema de arquivos sem statfs */
    }
    const memory = process.memoryUsage()
    const sessionsActive = db.state.sessions.filter((entry) => Date.parse(entry.expiresAt) > now()).length
    const failures24h = db.all('auditLogs').filter((entry) => entry.action === 'login_failed' && Date.parse(entry.at) >= now() - DAY).length
    return {
      ...snapshot,
      node: process.version,
      environment: process.env.NODE_ENV ?? 'development',
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal, systemFreeBytes: os.freemem(), systemTotalBytes: os.totalmem() },
      load: os.loadavg(),
      cpus: os.cpus().length,
      database,
      disk,
      email: mailer?.status?.() ?? null,
      totals: { companies: companies().length, users: db.all('users').length, sessionsActive, auditEntries: db.all('auditLogs').length, failedLogins24h: failures24h },
      time: new Date(now()).toISOString(),
    }
  }

  // -------------------------------------------------- verificação de configuração
  function securityChecks() {
    const appUrl = process.env.APP_URL ?? ''
    const platformAdmins = db.all('users').filter((entry) => !entry.companyId && entry.role === 'admin' && entry.active !== false)
    const pendingPassword = platformAdmins.filter((entry) => entry.passwordMustChange)
    const failures24h = db.all('auditLogs').filter((entry) => entry.action === 'login_failed' && Date.parse(entry.at) >= now() - DAY).length
    const checks = [
      { id: 'https', severity: 'high', ok: /^https:\/\//i.test(appUrl), title: 'Endereço público com HTTPS', detail: appUrl || 'APP_URL não definida' },
      { id: 'production', severity: 'medium', ok: process.env.NODE_ENV === 'production', title: 'Servidor em modo produção', detail: `NODE_ENV=${process.env.NODE_ENV ?? 'não definido'}` },
      { id: 'simulation', severity: 'high', ok: !simulationAllowed(), title: 'Simulação de pagamento desativada', detail: simulationAllowed() ? 'Qualquer pessoa pode criar conta sem pagar' : 'Cadastros só ativam com pagamento ou teste de 48 h' },
      { id: 'gateway', severity: 'high', ok: gatewayMode() === 'live', title: 'Mercado Pago em modo produção', detail: `modo: ${gatewayMode()}` },
      { id: 'webhook', severity: 'medium', ok: Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET), title: 'Assinatura secreta do webhook configurada', detail: process.env.MERCADOPAGO_WEBHOOK_SECRET ? 'configurada' : 'ausente — notificações automáticas não são validadas' },
      { id: 'admin-password', severity: 'high', ok: pendingPassword.length === 0, title: 'Senha provisória do administrador já foi trocada', detail: pendingPassword.length ? `${pendingPassword.map((entry) => entry.email).join(', ')} ainda usa senha provisória` : 'todas as contas da plataforma trocaram a senha' },
      { id: 'database', severity: 'medium', ok: Boolean(db.isPostgres), title: 'Banco PostgreSQL em uso', detail: db.isPostgres ? 'PostgreSQL' : 'arquivo JSON local (não recomendado em produção)' },
      { id: 'trust-proxy', severity: 'low', ok: process.env.TRUST_PROXY === '1', title: 'IP real do cliente atrás do proxy', detail: process.env.TRUST_PROXY === '1' ? 'TRUST_PROXY=1' : 'sem TRUST_PROXY: bloqueios por IP podem usar o IP do proxy' },
      { id: 'failed-logins', severity: 'medium', ok: failures24h < 30, title: 'Tentativas de login com falha (24 h)', detail: `${failures24h} tentativa(s)` },
    ]
    const weights = { high: 3, medium: 2, low: 1 }
    const total = checks.reduce((sum, check) => sum + weights[check.severity], 0)
    const got = checks.reduce((sum, check) => sum + (check.ok ? weights[check.severity] : 0), 0)
    return { checks, score: Math.round((got / total) * 100) }
  }

  // ------------------------------------------------ diagnóstico do Mercado Pago
  async function mercadoPagoStatus(req) {
    const mode = gatewayMode()
    const token = gatewayToken()
    const origin = publicOrigin(req)
    const base = {
      configured: mode !== 'unconfigured',
      mode,
      tokenHint: token ? `${token.slice(0, 8)}…${token.slice(-4)}` : null,
      webhookSecret: Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET),
      appUrl: process.env.APP_URL ?? null,
      notificationUrl: /^https:\/\//i.test(origin) ? `${origin}/api/billing/webhook` : null,
      simulationAllowed: simulationAllowed(),
    }
    if (!base.configured) return { ...base, reachable: false, error: 'MERCADOPAGO_ACCESS_TOKEN não configurado no servidor.' }
    const started = Date.now()
    try {
      const me = await billing.gateway.get('/users/me')
      return { ...base, reachable: true, latencyMs: Date.now() - started, account: { id: me.id, nickname: me.nickname ?? null, email: me.email ?? null, siteId: me.site_id ?? null, country: me.country_id ?? null } }
    } catch (error) {
      return { ...base, reachable: false, latencyMs: Date.now() - started, error: error?.message ?? String(error) }
    }
  }

  /** Atende `/api/platform/*`. Devolve `true` quando a rota foi tratada. */
  return async function handle({ req, res, path, query, user, readJson, send }) {
    const method = req.method
    const actor = { id: user.id, name: user.name }

    if (path === '/api/platform/monitor' && method === 'GET') {
      await send(res, 200, await monitor())
      return true
    }
    // e-mail de teste: confirma que o SMTP está configurado e entregando
    if (path === '/api/platform/email-test' && method === 'POST') {
      const body = await readJson(req)
      const to = String(body.to ?? user.email).trim()
      const result = await mailer.sendMail({
        to,
        subject: 'Teste de e-mail — Core Cut ERP',
        text: 'Este é um e-mail de teste do Core Cut ERP. Se você o recebeu, o envio está configurado corretamente.',
        html: '<p>Este é um e-mail de teste do <strong>Core Cut ERP</strong>. Se você o recebeu, o envio está configurado corretamente.</p>',
      })
      db.audit({ userId: user.id, userName: user.name, action: 'email_test', collection: 'platform', label: to })
      await send(res, 200, { ...result, to, email: mailer.status() })
      return true
    }
    if (path === '/api/platform/security' && method === 'GET') {
      await send(res, 200, securityChecks())
      return true
    }
    if (path === '/api/platform/mercadopago' && method === 'GET') {
      await send(res, 200, await mercadoPagoStatus(req))
      return true
    }
    if (path === '/api/platform/overview' && method === 'GET') {
      await send(res, 200, overview())
      return true
    }
    if (path === '/api/platform/companies' && method === 'GET') {
      const term = String(query.q ?? '').trim().toLowerCase()
      let rows = companies().map(companyRow)
      if (term) rows = rows.filter((r) => [r.name, r.legalName, r.email, r.document, r.phone].some((v) => String(v).toLowerCase().includes(term)))
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      await send(res, 200, { items: rows })
      return true
    }

    // ---- novo cliente: cria a empresa e o administrador (titular) que vai montar a própria equipe
    if (path === '/api/platform/companies' && method === 'POST') {
      const body = await readJson(req)
      const companyName = String(body.companyName ?? '').trim().slice(0, 140)
      const ownerName = String(body.ownerName ?? '').trim().slice(0, 120)
      const email = String(body.email ?? '').trim().toLowerCase()
      if (companyName.length < 2) throw new HttpError(400, 'Informe o nome da empresa.')
      if (ownerName.length < 2) throw new HttpError(400, 'Informe o nome do administrador.')
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido para o administrador.')
      if (db.all('users').some((entry) => entry.email === email)) throw new HttpError(409, 'Já existe um usuário com este e-mail.')
      const plan = findPlan(String(body.planId ?? ''))
      if (!plan) throw new HttpError(400, 'Escolha um plano válido.')
      const document = String(body.document ?? '').trim().slice(0, 30)
      const digits = document.replace(/\D/g, '')
      if (digits.length >= 11 && companies().some((c) => String(c.document ?? '').replace(/\D/g, '') === digits)) {
        throw new HttpError(409, 'Já existe um cliente com este CPF/CNPJ.')
      }
      const provided = typeof body.password === 'string' && body.password.length > 0
      if (provided) {
        const problem = passwordProblem(body.password, { email, name: ownerName })
        if (problem) throw new HttpError(400, problem)
      }
      const password = provided ? body.password : generatePassword()
      const access = ['trial', 'license', 'pending'].includes(body.access) ? body.access : 'license'
      const days = Math.min(Math.max(Math.round(Number(body.days) || 30), 1), 3650)
      const base = {
        name: companyName,
        legalName: String(body.legalName ?? companyName).trim().slice(0, 140),
        document,
        phone: String(body.phone ?? '').trim().slice(0, 40),
        email,
        planId: plan.id,
        planName: plan.name,
        planPrice: plan.price,
        gateway: 'mercadopago',
        createdByPlatform: user.id,
      }
      let state
      if (access === 'trial') {
        state = { status: 'trial', billingStatus: 'trial', billingMethod: 'trial', trialStartedAt: new Date(now()).toISOString(), trialEndsAt: new Date(now() + trialHours * HOUR).toISOString() }
      } else if (access === 'license') {
        state = { status: 'active', billingStatus: 'active', billingMethod: 'manual', paidUntil: new Date(now() + days * DAY).toISOString(), grantedBy: user.id, grantedAt: new Date(now()).toISOString() }
      } else {
        state = { status: 'pending_payment', billingStatus: 'incomplete', billingMethod: null }
      }
      const company = db.insert('companies', { ...base, ...state })
      const owner = db.insert('users', {
        name: ownerName,
        email,
        role: 'admin',
        active: true,
        companyId: company.id,
        companyRole: 'owner',
        position: 'Administrador da empresa',
        phone: base.phone,
        passwordHash: hashPassword(password),
        passwordMustChange: true,
        createdBy: user.id,
        createdByName: user.name,
      })
      seedCompany?.(company)
      audit(actor, 'platform_company_create', company, { planId: plan.id, access })
      await send(res, 201, { company: companyRow(company), owner: publicUser(owner), loginUrl: `${publicOrigin(req)}/login`, ...(provided ? {} : { temporaryPassword: password }) })
      return true
    }

    const one = path.match(/^\/api\/platform\/companies\/([^/]+)$/)
    if (one && method === 'GET') {
      const company = need(one[1])
      const ids = new Set(usersOf(company.id).map((entry) => entry.id))
      await send(res, 200, {
        company: companyRow(company),
        users: usersOf(company.id).map(publicUser),
        payments: paymentRows().filter((p) => p.companyId === company.id),
        logins: db
          .all('auditLogs')
          .filter((e) => e.action === 'login' && (e.companyId === company.id || ids.has(e.userId)))
          .slice(-30)
          .reverse()
          .map((e) => ({ at: e.at, userName: e.userName, ip: e.ip ?? '' })),
        sessions: db.state.sessions.filter((s) => ids.has(s.userId)).length,
      })
      return true
    }

    const action = path.match(/^\/api\/platform\/companies\/([^/]+)\/(trial|grant|plan|suspend|reactivate|users|delete|fiscal)$/)
    if (action && method === 'POST') {
      const company = need(action[1])
      const body = await readJson(req)

      if (action[2] === 'trial') {
        const hours = Number(body.hours)
        if (!Number.isFinite(hours) || hours < -48 || hours > 720) throw new HttpError(400, 'Informe de -48 a 720 horas.')
        const current = company.status === 'trial' && company.trialEndsAt ? Date.parse(company.trialEndsAt) : 0
        const base = hours < 0 ? now() : Math.max(now(), current)
        const updated = db.update('companies', company.id, { status: 'trial', billingStatus: 'trial', billingMethod: 'trial', trialEndsAt: new Date(base + hours * HOUR).toISOString() })
        audit(actor, 'platform_trial', company, { hours })
        await send(res, 200, companyRow(updated))
        return true
      }
      if (action[2] === 'grant') {
        const days = Number(body.days)
        if (!Number.isInteger(days) || days < 1 || days > 3650) throw new HttpError(400, 'Informe de 1 a 3650 dias.')
        const plan = body.planId ? findPlan(String(body.planId)) : findPlan(company.planId)
        if (!plan) throw new HttpError(400, 'Plano inválido.')
        const current = company.paidUntil ? Date.parse(company.paidUntil) : 0
        const start = current > now() && company.status === 'active' ? current : now()
        const updated = db.update('companies', company.id, {
          status: 'active',
          billingStatus: 'active',
          billingMethod: 'manual',
          planId: plan.id,
          planName: plan.name,
          planPrice: plan.price,
          paidUntil: new Date(start + days * DAY).toISOString(),
          cancelAtPeriodEnd: false,
          grantedBy: user.id,
          grantedAt: new Date(now()).toISOString(),
        })
        audit(actor, 'platform_grant', company, { days, planId: plan.id })
        await send(res, 200, companyRow(updated))
        return true
      }
      if (action[2] === 'plan') {
        const plan = findPlan(String(body.planId ?? ''))
        if (!plan) throw new HttpError(400, 'Plano inválido.')
        const updated = db.update('companies', company.id, { planId: plan.id, planName: plan.name, planPrice: plan.price })
        audit(actor, 'platform_plan', company, { planId: plan.id })
        await send(res, 200, companyRow(updated))
        return true
      }
      if (action[2] === 'suspend') {
        for (const member of usersOf(company.id)) sessions.destroyAllFor(member.id)
        const updated = db.update('companies', company.id, { status: 'suspended', suspendedAt: new Date(now()).toISOString() })
        audit(actor, 'platform_suspend', company)
        await send(res, 200, companyRow(updated))
        return true
      }
      if (action[2] === 'reactivate') {
        const next = company.billingMethod && company.billingMethod !== 'trial' && company.paidUntil ? 'active' : company.trialEndsAt ? 'trial' : 'pending_payment'
        const updated = db.update('companies', company.id, { status: next, suspendedAt: null })
        audit(actor, 'platform_reactivate', company, { status: next })
        await send(res, 200, companyRow(updated))
        return true
      }
      if (action[2] === 'users') {
        const name = String(body.name ?? '').trim().slice(0, 120)
        const email = String(body.email ?? '').trim().toLowerCase()
        const role = String(body.role ?? 'comercial')
        if (name.length < 2) throw new HttpError(400, 'Informe o nome.')
        if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido.')
        if (!Object.keys(ROLES).includes(role)) throw new HttpError(400, 'Perfil inválido.')
        if (db.all('users').some((entry) => entry.email === email)) throw new HttpError(409, 'Já existe um usuário com este e-mail.')
        const provided = typeof body.password === 'string' && body.password.length > 0
        if (provided) {
          const problem = passwordProblem(body.password, { email: body.email, name: body.name })
          if (problem) throw new HttpError(400, problem)
        }
        assertCapacity('users', company.id)
        const password = provided ? body.password : generatePassword()
        const created = db.insert('users', {
          name,
          email,
          role,
          active: true,
          companyId: company.id,
          companyRole: role === 'admin' ? 'admin' : 'member',
          position: String(body.position ?? '').slice(0, 80),
          passwordHash: hashPassword(password),
          passwordMustChange: true,
          createdBy: user.id,
          createdByName: user.name,
        })
        audit(actor, 'platform_user_create', company, { email, role })
        await send(res, 201, { user: publicUser(created), ...(provided ? {} : { temporaryPassword: password }) })
        return true
      }
      if (action[2] === 'fiscal') {
        const enabled = Boolean(body.enabled)
        const updated = db.update('companies', company.id, { fiscalPlatform: enabled })
        audit(actor, 'platform_fiscal', company, { enabled })
        await send(res, 200, companyRow(updated))
        return true
      }
      if (action[2] === 'delete') {
        if (String(body.confirmName ?? '').trim() !== company.name) throw new HttpError(400, 'Para excluir, digite o nome exato da empresa.')
        for (const member of usersOf(company.id)) sessions.destroyAllFor(member.id)
        db.purgeTenant(company.id)
        db.removeWhere('billingCheckouts', (entry) => entry.companyId === company.id)
        db.remove('companies', company.id)
        audit(actor, 'platform_company_delete', company)
        await send(res, 200, { ok: true })
        return true
      }
    }

    // ---- verificação facial do aplicativo -----------------------------------------
    if (path === '/api/platform/faces' && method === 'GET') {
      const usersById = new Map(db.all('users').map((u) => [u.id, u]))
      const companyById = new Map(companies().map((c) => [c.id, c]))
      const companyName = (userId) => {
        const owner = usersById.get(userId)
        return owner?.companyId ? (companyById.get(owner.companyId)?.name ?? '—') : 'Plataforma'
      }
      const newest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
      const profiles = db
        .all('faceProfiles')
        .filter((p) => p.status === 'ativo')
        .sort(newest)
        .map((p) => ({ id: p.id, userId: p.userId, userName: p.userName, email: usersById.get(p.userId)?.email ?? '', companyName: companyName(p.userId), enrolledAt: p.createdAt, device: p.device ?? '', consentAt: p.consentAt, consentVersion: p.consentVersion }))
      const checks = [...db.all('faceChecks')]
        .sort(newest)
        .slice(0, 150)
        .map((c) => ({ id: c.id, userId: c.userId, userName: c.userName, companyName: companyName(c.userId), result: c.result, kind: c.kind, distance: c.distance ?? null, at: c.createdAt, ip: c.ip ?? '', device: c.device ?? '', hasPhoto: Boolean(c.photo) }))
      const engine = faceEngine ? await faceEngine.available() : { ok: false, reason: 'motor não configurado' }
      await send(res, 200, { profiles, checks, retentionDays: 30, engine: { ok: Boolean(engine.ok), reason: engine.reason ?? null, name: faceEngine?.name ?? null } })
      return true
    }
    const facePhoto = path.match(/^\/api\/platform\/faces\/(profile|check)\/([^/]+)\/photo$/)
    if (facePhoto && method === 'GET') {
      const doc = db.all(facePhoto[1] === 'profile' ? 'faceProfiles' : 'faceChecks').find((d) => d.id === facePhoto[2])
      const buffer = doc ? faces.photoOf(doc) : null
      if (!buffer) throw new HttpError(404, 'Foto não encontrada.')
      audit(actor, 'platform_face_view', { id: doc.userId, name: doc.userName })
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': buffer.length })
      res.end(buffer)
      return true
    }
    const faceRevoke = path.match(/^\/api\/platform\/faces\/profile\/([^/]+)\/revoke$/)
    if (faceRevoke && method === 'POST') {
      const profile = db.all('faceProfiles').find((p) => p.id === faceRevoke[1] && p.status === 'ativo')
      if (!profile) throw new HttpError(404, 'Cadastro facial não encontrado.')
      faces.revoke(profile.id, user.id)
      audit(actor, 'platform_face_revoke', { id: profile.userId, name: profile.userName })
      await send(res, 200, { ok: true })
      return true
    }

    if (path === '/api/platform/users' && method === 'GET') {
      const term = String(query.q ?? '').trim().toLowerCase()
      const filter = String(query.status ?? 'all')
      let rows = db.all('users').map((entry) => ({ ...userRow(entry), companyName: companies().find((c) => c.id === entry.companyId)?.name ?? '— plataforma —' }))
      if (term) rows = rows.filter((r) => [r.name, r.email, r.companyName].some((v) => String(v).toLowerCase().includes(term)))
      if (filter === 'blocked') rows = rows.filter((r) => !r.active)
      else if (filter !== 'all') rows = rows.filter((r) => r.payment.status === filter)
      rows.sort((a, b) => String(b.lastLoginAt ?? b.createdAt).localeCompare(String(a.lastLoginAt ?? a.createdAt)))
      const summary = {}
      for (const row of db.all('users')) {
        const status = paymentOf(companies().find((c) => c.id === row.companyId)).status
        summary[status] = (summary[status] ?? 0) + 1
      }
      summary.blocked = db.all('users').filter((u) => u.active === false).length
      await send(res, 200, { items: rows.slice(0, 500), total: rows.length, summary })
      return true
    }

    // ---- criar acesso (para uma empresa ou para a base da plataforma)
    if (path === '/api/platform/users' && method === 'POST') {
      const body = await readJson(req)
      const name = String(body.name ?? '').trim().slice(0, 120)
      const email = String(body.email ?? '').trim().toLowerCase()
      const role = String(body.role ?? 'comercial')
      const companyId = body.companyId ? String(body.companyId) : null
      if (name.length < 2) throw new HttpError(400, 'Informe o nome.')
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido.')
      if (!Object.keys(ROLES).includes(role)) throw new HttpError(400, 'Perfil inválido.')
      const company = companyId ? need(companyId) : null
      if (db.all('users').some((entry) => entry.email === email)) throw new HttpError(409, 'Já existe um usuário com este e-mail.')
      const provided = typeof body.password === 'string' && body.password.length > 0
      if (provided) {
          const problem = passwordProblem(body.password, { email: body.email, name: body.name })
          if (problem) throw new HttpError(400, problem)
        }
      if (company) assertCapacity('users', company.id)
      const password = provided ? body.password : generatePassword()
      const created = db.insert('users', {
        name,
        email,
        role,
        active: true,
        ...(company ? { companyId: company.id, companyRole: role === 'admin' ? 'admin' : 'member' } : {}),
        position: String(body.position ?? '').slice(0, 80),
        passwordHash: hashPassword(password),
        passwordMustChange: true,
        createdBy: user.id,
        createdByName: user.name,
      })
      db.audit({ userId: user.id, userName: user.name, action: 'platform_user_create', collection: 'platform', docId: created.id, label: `${email} (${company?.name ?? 'plataforma'})` })
      await send(res, 201, { user: userRow(created), ...(provided ? {} : { temporaryPassword: password }) })
      return true
    }

    // ---- excluir acesso
    const remove = path.match(/^\/api\/platform\/users\/([^/]+)\/delete$/)
    if (remove && method === 'POST') {
      const target = needUser(remove[1])
      if (target.id === user.id) throw new HttpError(400, 'Você não pode excluir o próprio usuário.')
      if (target.companyId && target.companyRole === 'owner') {
        throw new HttpError(409, 'Este é o titular da empresa. Exclua ou suspenda a empresa em Empresas, ou bloqueie o acesso.')
      }
      if (!target.companyId && target.role === 'admin') {
        const others = db.all('users').filter((entry) => !entry.companyId && entry.role === 'admin' && entry.active !== false && entry.id !== target.id)
        if (others.length === 0) throw new HttpError(409, 'É necessário manter ao menos um administrador da plataforma ativo.')
      }
      sessions.destroyAllFor(target.id)
      db.remove('users', target.id)
      db.audit({ userId: user.id, userName: user.name, action: 'platform_user_delete', collection: 'platform', docId: target.id, label: target.email })
      await send(res, 200, { ok: true })
      return true
    }

    const resetPassword = path.match(/^\/api\/platform\/users\/([^/]+)\/reset-password$/)
    if (resetPassword && method === 'POST') {
      const target = needUser(resetPassword[1])
      const password = generatePassword()
      db.update('users', target.id, { passwordHash: hashPassword(password), passwordMustChange: true })
      sessions.destroyAllFor(target.id)
      db.audit({ userId: user.id, userName: user.name, action: 'platform_password_reset', collection: 'platform', docId: target.id, label: target.email })
      await send(res, 200, { temporaryPassword: password })
      return true
    }

    const toggle = path.match(/^\/api\/platform\/users\/([^/]+)\/active$/)
    if (toggle && method === 'POST') {
      const target = needUser(toggle[1])
      const body = await readJson(req)
      const active = body.active !== false
      if (target.id === user.id && !active) throw new HttpError(400, 'Você não pode bloquear o próprio usuário.')
      if (active && target.active === false && target.companyId) assertCapacity('users', target.companyId)
      const updated = db.update('users', target.id, { active })
      if (!active) sessions.destroyAllFor(target.id)
      db.audit({ userId: user.id, userName: user.name, action: active ? 'platform_user_activate' : 'platform_user_deactivate', collection: 'platform', docId: target.id, label: target.email })
      await send(res, 200, userRow(updated))
      return true
    }

    // ---- cobrança de teste: confirma que o dinheiro chega na conta do Mercado Pago
    if (path === '/api/platform/payment-test' && method === 'POST') {
      const body = await readJson(req)
      const result = await billing.createPlatformTest({ method: body.method, amount: body.amount, payerEmail: body.payerEmail, origin: publicOrigin(req) })
      db.audit({ userId: user.id, userName: user.name, action: 'platform_payment_test', collection: 'platform', docId: result.ref, label: `${body.method} R$ ${result.amount}` })
      await send(res, 201, result)
      return true
    }
    const testCancel = path.match(/^\/api\/platform\/payment-test\/([^/]+)\/cancel$/)
    if (testCancel && method === 'POST') {
      await send(res, 200, await billing.cancelPlatformTest(testCancel[1]))
      return true
    }

    if (path === '/api/platform/finance' && method === 'GET') {
      await send(res, 200, finance())
      return true
    }
    if (path === '/api/platform/payments' && method === 'GET') {
      await send(res, 200, { items: paymentRows().slice(0, 500) })
      return true
    }

    // ---- atividade: tudo o que as pessoas fazem, no site e no aplicativo ------------------------
    if (path === '/api/platform/activity' && method === 'GET') {
      const limit = Math.min(1000, Math.max(20, Number(query.limit) || 300))
      const wantChannel = query.channel === 'app' || query.channel === 'site' ? query.channel : ''
      const wantKind = String(query.kind ?? '')
      const term = String(query.q ?? '').trim().toLowerCase()
      const byCompany = new Map(companies().map((c) => [c.id, c.name]))
      const usersById = new Map(db.all('users').map((u) => [u.id, u]))
      const companyOfUser = (userId) => {
        const owner = usersById.get(userId)
        return owner?.companyId ? (byCompany.get(owner.companyId) ?? '—') : '— plataforma —'
      }

      const ACTIONS = {
        login: ['Entrou', 'acesso'],
        login_failed: ['Falha de login', 'alerta'],
        login_blocked: ['Tentou entrar com acesso bloqueado', 'alerta'],
        logout: ['Saiu', 'acesso'],
        face_enroll: ['Cadastrou o rosto', 'rosto'],
        face_failed: ['Rosto não reconhecido', 'alerta'],
        face_unavailable: ['Verificação facial indisponível no servidor', 'alerta'],
        face_recheck_ok: ['Rosto confirmado ao reabrir o app', 'rosto'],
        face_recheck_failed: ['Rosto recusado ao reabrir o app', 'alerta'],
        password_reset_requested: ['Pediu nova senha', 'senha'],
        password_reset_unknown: ['Pedido de nova senha para e-mail não cadastrado', 'senha'],
        password_reset: ['Redefiniu a senha pelo link', 'senha'],
        password_change: ['Trocou a senha', 'senha'],
        twofactor_enable: ['Ativou a verificação em duas etapas', 'seguranca'],
        twofactor_disable: ['Desativou a verificação em duas etapas', 'seguranca'],
        backup: ['Baixou um backup', 'seguranca'],
        restore: ['Restaurou um backup', 'seguranca'],
        app_download: ['Baixou o aplicativo Android', 'acesso'],
        app_download_link: ['Pediu o download do aplicativo', 'acesso'],
        app_blocked_plan: ['Tentou usar o aplicativo sem o plano (Essencial)', 'alerta'],
        platform_face_view: ['Admin viu uma foto facial', 'plataforma'],
        platform_face_revoke: ['Admin redefiniu um rosto', 'plataforma'],
        portal_enable: ['Ativou o link do cliente', 'dados'],
        portal_revoke: ['Desativou o link do cliente', 'dados'],
        portal_request: ['Cliente pediu ajuda pelo link', 'dados'],
        client_notified: ['Avisou o cliente', 'dados'],
        fiscal_token_set: ['Salvou o token fiscal', 'seguranca'],
        invoice_create: ['Criou nota fiscal', 'dados'],
        invoice_emit: ['Emitiu nota fiscal', 'dados'],
        invoice_cancel: ['Cancelou nota fiscal', 'dados'],
      }
      const COLLECTION = { budgets: 'orçamento', projects: 'projeto', clients: 'cliente', contracts: 'contrato', tasks: 'tarefa', materials: 'material', purchases: 'compra', productionOrders: 'ordem de produção', cutPlans: 'plano de corte', users: 'usuário', invoices: 'nota fiscal', warranties: 'chamado', installations: 'entrega', receivables: 'conta a receber', payables: 'conta a pagar', files: 'arquivo' }
      const VERB = { create: 'Criou', update: 'Alterou', delete: 'Excluiu', approve: 'Aprovou', upload: 'Enviou', receive: 'Recebeu', restore_item: 'Restaurou' }
      const describe = (entry) => {
        const known = ACTIONS[entry.action]
        if (known) return { label: known[0], kind: known[1] }
        if (entry.action?.startsWith('platform_')) return { label: `Admin: ${entry.action.replace(/^platform_/, '').replace(/_/g, ' ')}`, kind: 'plataforma' }
        const verb = VERB[entry.action]
        if (verb) return { label: `${verb} ${COLLECTION[entry.collection] ?? entry.collection ?? ''}`.trim(), kind: 'dados' }
        return { label: `${entry.action ?? 'ação'}${entry.collection ? ` · ${entry.collection}` : ''}`, kind: 'dados' }
      }

      const all = db.all('auditLogs')
      const now0 = now()
      const day = now0 - DAY
      const week = now0 - 7 * DAY
      const channelOf = (e) => (e.channel === 'app' ? 'app' : 'site')
      const summary = { appLogins24h: 0, siteLogins24h: 0, failures24h: 0, faceRefused24h: 0, resetRequests24h: 0, appUsers7d: 0, siteUsers7d: 0 }
      const appUsers = new Set()
      const siteUsers = new Set()
      const perUser = new Map()
      for (const e of all) {
        const at = Date.parse(e.at)
        if (!Number.isFinite(at)) continue
        if (at >= day) {
          if (e.action === 'login') summary[channelOf(e) === 'app' ? 'appLogins24h' : 'siteLogins24h'] += 1
          if (e.action === 'login_failed') summary.failures24h += 1
          if (e.action === 'face_failed' || e.action === 'face_recheck_failed') summary.faceRefused24h += 1
          if (e.action === 'password_reset_requested' || e.action === 'password_reset_unknown') summary.resetRequests24h += 1
        }
        if (at >= week && e.userId) {
          ;(channelOf(e) === 'app' ? appUsers : siteUsers).add(e.userId)
          const row = perUser.get(e.userId) ?? { userId: e.userId, userName: e.userName ?? '', companyName: companyOfUser(e.userId), site: 0, app: 0, lastAt: '', lastChannel: 'site', lastAction: '' }
          row[channelOf(e)] += 1
          if (!row.lastAt || e.at > row.lastAt) {
            row.lastAt = e.at
            row.lastChannel = channelOf(e)
            row.lastAction = describe(e).label
          }
          perUser.set(e.userId, row)
        }
      }
      summary.appUsers7d = appUsers.size
      summary.siteUsers7d = siteUsers.size

      const items = []
      for (let i = all.length - 1; i >= 0 && items.length < limit; i--) {
        const e = all[i]
        const channel = channelOf(e)
        if (wantChannel && channel !== wantChannel) continue
        const { label, kind } = describe(e)
        if (wantKind && kind !== wantKind) continue
        const row = {
          at: e.at,
          userName: e.userName ?? '',
          companyName: e.companyId ? (byCompany.get(e.companyId) ?? '—') : e.userId ? companyOfUser(e.userId) : '— plataforma —',
          action: e.action,
          label,
          kind,
          channel,
          device: e.device ?? '',
          ip: e.ip ?? '',
          detail: [e.label, e.collection && e.collection !== 'auth' && e.collection !== 'platform' ? e.collection : ''].filter(Boolean).join(' · ').slice(0, 160),
        }
        if (term && !`${row.userName} ${row.companyName} ${row.label} ${row.detail} ${row.ip} ${row.device}`.toLowerCase().includes(term)) continue
        items.push(row)
      }
      const users = [...perUser.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, 60)
      await send(res, 200, { summary, users, items })
      return true
    }

    if (path === '/api/platform/logins' && method === 'GET') {
      const limit = Math.min(500, Math.max(10, Number(query.limit) || 200))
      const byCompany = new Map(companies().map((c) => [c.id, c.name]))
      const items = db
        .all('auditLogs')
        .filter((e) => e.action === 'login' || e.action === 'login_failed')
        .slice(-limit)
        .reverse()
        .map((e) => ({ at: e.at, ok: e.action === 'login', userName: e.userName ?? '', ip: e.ip ?? '', channel: e.channel === 'app' ? 'app' : 'site', device: e.device ?? '', companyName: byCompany.get(e.companyId) ?? '— plataforma —' }))
      await send(res, 200, { items })
      return true
    }

    if (path === '/api/platform/sessions' && method === 'GET') {
      const users = new Map(db.all('users').map((entry) => [entry.id, entry]))
      const byCompany = new Map(companies().map((c) => [c.id, c.name]))
      const items = db.state.sessions
        .filter((s) => Date.parse(s.expiresAt) > now())
        .map((s) => {
          const owner = users.get(s.userId)
          return {
            id: s.key.slice(0, 16),
            userName: owner?.name ?? '(removido)',
            email: owner?.email ?? '',
            companyName: byCompany.get(owner?.companyId) ?? '— plataforma —',
            ip: s.ip ?? '',
            agent: s.agent ?? '',
            createdAt: s.createdAt,
            expiresAt: s.expiresAt,
            self: s.userId === user.id,
          }
        })
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      await send(res, 200, { items })
      return true
    }

    const revoke = path.match(/^\/api\/platform\/sessions\/([^/]+)\/revoke$/)
    if (revoke && method === 'POST') {
      const before = db.state.sessions.length
      db.state.sessions = db.state.sessions.filter((s) => s.key.slice(0, 16) !== revoke[1])
      db.touch()
      await send(res, 200, { revoked: before - db.state.sessions.length })
      return true
    }

    return false
  }
}
