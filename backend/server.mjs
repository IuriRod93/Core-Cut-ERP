import 'dotenv/config'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, createReadStream, statSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join, extname, dirname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import pg from 'pg'
import { Database } from './lib/db.mjs'
import { createLiveHub } from './lib/live.mjs'
import { PostgresDatabase } from './lib/postgres-db.mjs'
import { Sessions, hashPassword, verifyPassword, DUMMY_HASH, passwordProblem } from './lib/auth.mjs'
import { LeoCatalog } from './lib/catalog.mjs'
import { seedDefaults, seedCompanyDefaults } from './lib/seed.mjs'
import { HttpError } from './lib/http-error.mjs'
import { createRateLimiter } from './lib/rate-limit.mjs'
import { createPlatform } from './lib/platform.mjs'
import { createMetrics } from './lib/metrics.mjs'
import { createMailer } from './lib/mailer.mjs'
import { createGeo, distanceMeters, isLat, isLng } from './lib/geo.mjs'
import { createProductionTasks } from './lib/production-tasks.mjs'
import { syncPlanOffcuts } from './lib/offcuts.mjs'
import { applyOperationAction, forgottenTimers, runningOperationsOf } from './lib/shopfloor.mjs'
import { createPortal, newPortalToken, validPortalToken } from './lib/portal.mjs'
import { buildFocusPayload, companyProblems, createFocusClient, createSecretBox, invoiceProblems, mapFocusResponse, totalsOf } from './lib/fiscal.mjs'
import { FACE_MATCH_DISTANCE, FACE_MESSAGES, createFaceEngine, createFaceStore, createFakeFaceEngine, createTickets, decodeImage, euclidean } from './lib/face.mjs'
import { emails } from './lib/emails.mjs'
import { createBillingEmails } from './lib/billing-emails.mjs'
import {
  LIMITED_COLLECTIONS, UNLIMITED, PIX_MONTH_OPTIONS, TRIAL_HOURS,
  createBilling, createMercadoPago, companyAccess, findPlan, getPlanLimits, getPlanModules, publicPlans, planHasMobileApp,
  simulationAllowed, gatewayMode, verifyMercadoPagoSignature,
} from './lib/billing.mjs'
import { notify, runScheduler, setNotifyHook } from './lib/scheduler.mjs'
import { COLLECTIONS, MODULES, resolveModules, isManagerRole, redactDoc } from '../shared/access.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.PORT ?? 4400)
const HOST = process.env.HOST ?? '0.0.0.0'
const dataDir = process.env.ARCOPLAN_DATA_DIR ?? join(root, 'backend', 'data')
const distDir = process.env.ARCOPLAN_DIST_DIR ? process.env.ARCOPLAN_DIST_DIR : join(root, 'dist')
const filesDir = join(dataDir, 'files')
mkdirSync(filesDir, { recursive: true })

const usePostgres = Boolean(process.env.DATABASE_URL) && process.env.NODE_ENV !== 'test'
const db = usePostgres
  ? await new PostgresDatabase(dataDir, new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PGPOOL_MAX ?? 10),
      connectionTimeoutMillis: 10000,
    })).initialize()
  : new Database(dataDir)
if (db.isPostgres) console.info('[db] PostgreSQL conectado; persistência JSON local desativada.')
const sessions = new Sessions(db)
const catalog = new LeoCatalog(join(root, 'backend', 'catalog', 'leo-madeiras.json'))
seedDefaults(db)
// Cadastros feitos antes do pagamento ficavam com o titular inativo; agora ele entra e vê a tela de assinatura.
for (const owner of db.all('users')) {
  const company = owner.companyId ? db.all('companies').find((entry) => entry.id === owner.companyId) : null
  if (company && owner.companyRole === 'owner' && owner.active === false) db.update('users', owner.id, { active: true })
}
if (db.isPostgres) await db.flush()

const MAX_JSON = 12 * 1024 * 1024
// Cadastros (planos de corte com centenas de chapas, importações do Promob) podem passar de 12 MB.
const MAX_CRUD_JSON = Math.max(12, Number(process.env.MAX_CRUD_JSON_MB) || 48) * 1024 * 1024
const MAX_FILE = 80 * 1024 * 1024
const TRASH_LIMIT = 500

const mailer = createMailer()
const productionTasks = createProductionTasks(db)
// avisos ao vivo: cada gravação conta às telas abertas da empresa qual coleção mudou
const live = createLiveHub()
// toda gravação de uma ordem de produção atualiza a tarefa do projeto (sentido único: produção → tarefas)
let syncing = false
db.afterWrite = (name, doc) => {
  live.changed(doc.companyId ?? null, name)
  if ((name !== 'productionOrders' && name !== 'cutPlans') || syncing) return
  syncing = true
  try {
    db.runAsTenant(doc.companyId ?? null, () => (name === 'cutPlans' ? syncPlanOffcuts(db, doc) : productionTasks.sync(doc)))
  } catch (error) {
    console.error('[produção] Falha ao sincronizar o registro:', error?.message ?? error)
  } finally {
    syncing = false
  }
}
const geo = createGeo()
const portal = createPortal(db)
const fiscalSecrets = createSecretBox({ dataDir })
const focus = createFocusClient()
// verificação facial do aplicativo (o motor de teste só existe em NODE_ENV=test)
const faceBox = createSecretBox({ dataDir, purpose: 'face', envKey: 'FACE_SECRET_KEY' })
const faceEngine = process.env.NODE_ENV === 'test' && process.env.FACE_ENGINE === 'fake' ? createFakeFaceEngine() : createFaceEngine()
const faceTickets = createTickets()
// operador identificado por PIN num tablet compartilhado do chão de fábrica (vale um turno)
const operatorTickets = createTickets({ ttlMs: 12 * 60 * 60_000 })

// Aplicativo Android: o arquivo fica fora da pasta pública e só sai por link temporário de quem tem o plano.
const appApkPath = process.env.APP_APK_PATH || join(root, 'backend', 'assets', 'core-cut-erp.apk')
const appVersionPath = process.env.APP_VERSION_PATH || join(root, 'backend', 'assets', 'app-version.json')
const appDownloads = new Map()
const appVersionInfo = () => {
  try {
    const { versionName, versionCode, sizeBytes, sha256, builtAt } = JSON.parse(readFileSync(appVersionPath, 'utf8'))
    return { versionName, versionCode, sizeBytes, sha256, builtAt }
  } catch {
    return null
  }
}
const faces = createFaceStore({ db, box: faceBox })

// De onde veio cada ação (site ou aplicativo) e de qual aparelho: entra no registro de acessos do Painel Admin.
const requestContext = new AsyncLocalStorage()
const browserLabel = (ua) => {
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iPhone' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : ''
  const browser = /Edg\//i.test(ua) ? 'Edge' : /OPR\//i.test(ua) ? 'Opera' : /Chrome\//i.test(ua) ? 'Chrome' : /Firefox\//i.test(ua) ? 'Firefox' : /Safari\//i.test(ua) ? 'Safari' : ''
  return [browser, os].filter(Boolean).join(' · ')
}
const contextFor = (req) => {
  const ua = String(req.headers['user-agent'] ?? '')
  const client = String(req.headers['x-client'] ?? '')
  const app = /CoreCutApp/i.test(ua) || /^corecut-app/i.test(client) || String(req.url ?? '').startsWith('/api/mobile/')
  const fromHeader = (/\(([^)]*)\)/.exec(client)?.[1] ?? '').slice(0, 100)
  return { channel: app ? 'app' : 'site', device: fromHeader || (app ? '' : browserLabel(ua)) }
}
const baseAudit = db.audit.bind(db)
db.audit = (entry) => {
  const context = requestContext.getStore()
  return baseAudit(context ? { channel: context.channel, ...(context.device ? { device: context.device } : {}), ...entry } : entry)
}
const appUrl = () => process.env.APP_URL || 'http://localhost:5174'
let billingEmails = null
const billing = createBilling({ db, gateway: createMercadoPago(), onPaid: (company) => billingEmails?.paymentApproved(company) })
billingEmails = createBillingEmails({ db, mailer, appUrl })

// Limites de requisição por IP (ajustáveis por variável de ambiente; os testes elevam os valores).
const limiter = createRateLimiter()
const metrics = createMetrics()
const envInt = (name, fallback) => (Number.isFinite(Number(process.env[name])) && process.env[name] ? Number(process.env[name]) : fallback)
const LIMITS = {
  api: envInt('RATE_API_PER_MIN', 900),
  login: envInt('RATE_LOGIN_PER_10MIN', 30),
  register: envInt('RATE_REGISTER_PER_HOUR', 10),
  trial: envInt('RATE_TRIAL_PER_DAY', 5),
  status: envInt('RATE_STATUS_PER_MIN', 120),
  forgot: envInt('RATE_FORGOT_PER_HOUR', 10),
  geo: envInt('RATE_GEO_PER_MIN', 60),
  track: envInt('RATE_TRACK_PER_MIN', 30),
}
function rateLimit(key, max, windowMs) {
  const result = limiter.hit(key, max, windowMs)
  if (!result.ok) {
    metrics.blocked()
    const error = new HttpError(429, 'Muitas requisições em pouco tempo. Aguarde um instante e tente novamente.')
    error.retryAfter = result.retryAfter
    throw error
  }
}
setInterval(() => limiter.sweep(), 5 * 60_000).unref()
if (gatewayMode() === 'live') {
  const appUrl = process.env.APP_URL ?? ''
  const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.(localhost|local|test|lan))(:\d+)?(\/|$)/i.test(appUrl)
  if (!/^https:\/\//i.test(appUrl) && !local) console.error('[billing] ATENÇÃO: credenciais de produção do Mercado Pago sem APP_URL válida; o cadastro e o checkout serão recusados.')
  else if (local) console.warn('[billing] Produção com APP_URL local: o Mercado Pago não consegue chamar o webhook e só esta máquina conclui o pagamento.')
  if (!process.env.MERCADOPAGO_WEBHOOK_SECRET) console.warn('[billing] MERCADOPAGO_WEBHOOK_SECRET ausente: pagamentos serão conferidos no retorno e no login. Rode "npm run billing:check".')
}
const companyOf = (user) => (user?.companyId ? db.all('companies').find((entry) => entry.id === user.companyId) ?? null : null)

/** Quantos registros a empresa já usa de cada recurso limitado pelo plano. */
function companyUsage(companyId) {
  const own = (name, predicate = () => true) => db.all(name).filter((doc) => doc.companyId === companyId && predicate(doc)).length
  return {
    users: own('users', (u) => u.active !== false),
    projects: own('projects'),
    budgets: own('budgets'),
    productionOrders: own('productionOrders'),
    inventoryItems: own('materials'),
  }
}

/** Bloqueia a criação de registros acima do limite do plano da empresa. */
function assertCapacity(name, tenantId, extra = 1) {
  const rule = LIMITED_COLLECTIONS[name]
  if (!rule || !tenantId) return
  const company = db.all('companies').find((entry) => entry.id === tenantId)
  if (!company) return
  const max = getPlanLimits(company.planId)[rule.key]
  if (max >= UNLIMITED) return
  const used = db.all(name).filter((doc) => doc.companyId === tenantId && (name !== 'users' || doc.active !== false)).length
  if (used + extra > max) {
    throw new HttpError(403, `Limite do plano ${company.planName} atingido: ${max} ${rule.label}. Faça upgrade em Configurações → Assinatura para continuar.`)
  }
}

db.beforeInsert = (name, tenantId, doc) => {
  if (name === 'users' && doc.active === false) return
  assertCapacity(name, tenantId)
}
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const dateOnly = (offsetDays = 0) => {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}
const budgetTotal = (budget) => {
  const margin = Number(budget.marginPercent ?? 0) / 100
  const price = (budget.items ?? []).reduce((sum, item) => {
    const cost = Number(item.quantity) * Number(item.unitCost)
    return sum + (Number(item.unitPrice) > 0 ? Number(item.quantity) * Number(item.unitPrice) : cost * (1 + margin))
  }, 0)
  const labor = Number(budget.laborHours ?? 0) * Number(budget.laborRate ?? 0)
  const extras = Number(budget.freight ?? 0) + Number(budget.installation ?? 0)
  const gross = price + labor * (1 + margin) + extras
  const discount = gross * (Number(budget.discountPercent ?? 0) / 100)
  const net = gross - discount
  const taxRate = Number(budget.taxPercent ?? 0) / 100
  return round2(taxRate > 0 && taxRate < 1 ? net / (1 - taxRate) : net)
}

const PRODUCTION_YIELD = 0.82

function productionMaterialNeeds(order) {
  const areaBy = new Map()
  const edgeBy = new Map()
  const hardwareBy = new Map()
  for (const item of order.items ?? []) {
    const bom = item.bomId ? db.get('boms', item.bomId) : null
    if (!bom) continue
    const itemQuantity = Number(item.quantity) || 0
    for (const part of bom.parts ?? []) {
      if (!part.materialId) continue
      const area = (Number(part.length) * Number(part.width) * Number(part.quantity)) / 1_000_000 * itemQuantity
      areaBy.set(part.materialId, (areaBy.get(part.materialId) ?? 0) + area)
      if (bom.edgeMaterialId) {
        const top = part.edgeTop ? 1 : 0
        const bottom = part.edgeBottom ? 1 : 0
        const left = part.edgeLeft ? 1 : 0
        const right = part.edgeRight ? 1 : 0
        const edge = (top + bottom + left + right) > 0
          ? ((top + bottom) * Number(part.length) + (left + right) * Number(part.width)) / 1000 * Number(part.quantity) * itemQuantity
          : 0
        edgeBy.set(bom.edgeMaterialId, (edgeBy.get(bom.edgeMaterialId) ?? 0) + edge)
      }
    }
    for (const hardware of bom.hardware ?? []) {
      if (!hardware.materialId) continue
      hardwareBy.set(hardware.materialId, (hardwareBy.get(hardware.materialId) ?? 0) + (Number(hardware.quantity) || 0) * itemQuantity)
    }
  }

  const needs = []
  for (const [materialId, area] of areaBy) {
    const material = db.get('materials', materialId)
    const sheet = material?.sheetWidth && material?.sheetHeight ? (material.sheetWidth * material.sheetHeight) / 1_000_000 : 0
    needs.push({ materialId, material, quantity: sheet > 0 ? Math.ceil(area / PRODUCTION_YIELD / sheet) : round2(area / PRODUCTION_YIELD), kind: 'chapa' })
  }
  for (const [materialId, meters] of edgeBy) {
    const material = db.get('materials', materialId)
    needs.push({ materialId, material, quantity: Math.ceil(meters * 1.1), kind: 'fita' })
  }
  for (const [materialId, quantity] of hardwareBy) {
    const material = db.get('materials', materialId)
    needs.push({ materialId, material, quantity: Math.ceil(quantity), kind: 'ferragem' })
  }
  return needs
}

const activeReservationsFor = (materialId, exceptOrderId = null) =>
  db.col('inventoryReservations')
    .filter((reservation) => reservation.materialId === materialId && reservation.status === 'reserved' && reservation.productionOrderId !== exceptOrderId)
    .reduce((sum, reservation) => sum + Number(reservation.quantity ?? 0), 0)

/** Quem está apontando: o operador do PIN (cabeçalho X-Operator) ou o próprio usuário logado. */
function shopfloorOperator(req, user) {
  const header = req.headers['x-operator']
  if (!header) return user
  const ticket = operatorTickets.get(header)
  const operator = ticket && ticket.sessionUserId === user.id ? db.get('users', ticket.userId) : null
  if (!operator || operator.active === false) throw new HttpError(409, 'A identificação do operador expirou. Informe o PIN de novo.')
  return operator
}

/** Abre (ou reaproveita) a inspeção de qualidade pendente e coloca a ordem em "qualidade". */
function startQualityInspection(user, order) {
  const pending = db.col('qualityInspections').find((inspection) => inspection.productionOrderId === order.id && inspection.status === 'pending')
  if (pending) return { productionOrder: order, inspection: pending }
  const inspection = db.insert('qualityInspections', {
    code: db.nextCode('QIN'),
    productionOrderId: order.id,
    projectId: order.projectId ?? null,
    status: 'pending',
    notes: '',
    startedAt: new Date().toISOString(),
    startedBy: user.id,
    startedByName: user.name,
  })
  const updated = db.update('productionOrders', order.id, { status: 'qualidade', qualityStatus: 'pending', qualityInspectionId: inspection.id })
  audit(user, 'quality_start', 'productionOrders', updated, { inspectionId: inspection.id })
  return { productionOrder: updated, inspection }
}

function releaseProductionReservations(order, user) {
  const now = new Date().toISOString()
  let released = 0
  for (const reservation of db.col('inventoryReservations')) {
    if (reservation.productionOrderId !== order.id || reservation.status !== 'reserved') continue
    db.update('inventoryReservations', reservation.id, { status: 'released', releasedAt: now, releasedBy: user.id, releasedByName: user.name })
    released += 1
  }
  return released
}

function reserveProductionMaterials(order, user) {
  const existing = db.col('inventoryReservations').filter((reservation) => reservation.productionOrderId === order.id && reservation.status === 'reserved')
  if (existing.length) return { reservations: existing, needs: [], created: false }
  const needs = productionMaterialNeeds(order)
  for (const need of needs) {
    if (!need.material) throw new HttpError(409, 'A ficha tecnica referencia um material que nao existe mais.')
    const available = Number(need.material.stock ?? 0) - activeReservationsFor(need.materialId, order.id)
    if (Number(need.quantity) > available) throw new HttpError(409, `Saldo insuficiente para reservar "${need.material.name}".`)
  }
  const reservations = needs.map((need) => db.insert('inventoryReservations', {
    code: db.nextCode('RES'),
    productionOrderId: order.id,
    materialId: need.materialId,
    materialName: need.material.name,
    quantity: need.quantity,
    unit: need.material.unit,
    status: 'reserved',
    projectId: order.projectId ?? null,
    createdBy: user.id,
    createdByName: user.name,
  }))
  return { reservations, needs, created: true }
}

// ---------------------------------------------------------------- utilities
const API_SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
}

/**
 * Cookie que só libera o download do CÓDIGO das telas internas (/assets/*). Não autentica a API (a API continua
 * exigindo o cabeçalho Authorization), por isso não abre brecha de CSRF.
 */
const GATE_COOKIE = 'cc_gate'
const gateCookie = (token) => `${GATE_COOKIE}=${token}; Path=/assets/; HttpOnly; SameSite=Strict${/^https:/i.test(process.env.APP_URL ?? '') ? '; Secure' : ''}`
const clearGateCookie = () => `${GATE_COOKIE}=; Path=/assets/; Max-Age=0; HttpOnly; SameSite=Strict`
const readGateCookie = (req) => {
  const raw = String(req.headers.cookie ?? '')
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === GATE_COOKIE) return rest.join('=')
  }
  return ''
}

const writeResponse = (res, status, body, headers = {}) => {
  // respostas que entregam uma sessão nova (login, cadastro, 2FA) também liberam o código do aplicativo
  if (body && typeof body === 'object' && typeof body.token === 'string' && body.token.length >= 32 && !headers['Set-Cookie']) {
    headers = { ...headers, 'Set-Cookie': gateCookie(body.token) }
  }
  const payload = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_SECURITY_HEADERS, ...headers })
  res.end(payload)
}

const send = (res, status, body, headers = {}) => {
  if (!db.isPostgres) return writeResponse(res, status, body, headers)
  let completed = false
  const respond = (responseStatus, responseBody) => {
    if (completed || res.writableEnded) return
    completed = true
    writeResponse(res, responseStatus, responseBody, headers)
  }
  return db.flush()
    .then(() => respond(status, body))
    .catch((error) => {
      console.error('[db] Não foi possível confirmar a gravação no PostgreSQL.', error)
      respond(503, { error: 'Não foi possível salvar os dados no PostgreSQL. Tente novamente.' })
    })
}

const readBody = (req, limit) =>
  new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        reject(new HttpError(413, `Conteúdo maior que o limite permitido (${Math.round(limit / 1048576)} MB). Divida a importação em partes menores.`))
        settled = true
        // Consome o restante para permitir uma resposta 413 limpa.
        req.resume()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!settled) {
        settled = true
        resolve(Buffer.concat(chunks))
      }
    })
    req.on('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  })

/** Resumo leve de um plano de corte para listagens (sem peças, mapas de corte nem G-code). */
const summarizeCutPlan = (plan) => {
  const { pieces, groups, gcode: _gcode, ...rest } = plan
  const sheets = Array.isArray(groups) ? groups.reduce((sum, group) => sum + (group.offcutId ? 0 : (group.sheets?.length ?? 0)), 0) : 0
  return {
    ...rest,
    offcutCount: Array.isArray(groups) ? groups.filter((group) => group.offcutId).length : (plan.offcutCount ?? 0),
    summary: true,
    pieceLines: Array.isArray(pieces) ? pieces.length : (plan.pieceLines ?? 0),
    pieceCount: Array.isArray(pieces) ? pieces.reduce((sum, piece) => sum + (Number(piece.quantity) || 1), 0) : (plan.pieceCount ?? 0),
    sheetCount: sheets,
  }
}

const readJson = async (req, limit = MAX_JSON) => {
  const buf = await readBody(req, limit)
  if (buf.length === 0) return {}
  try {
    return JSON.parse(buf.toString('utf8'))
  } catch {
    throw new HttpError(400, 'JSON inválido.')
  }
}

const publicUser = (u) => {
  if (!u) return null
  // segredos nunca saem do servidor (hash da senha; sobras do antigo 2FA também são descartadas)
  const { passwordHash, totpEnabled, totpSecret, totpPendingSecret, totpLastStep, recoveryCodes, shopfloorPinHash, ...rest } = u
  return { ...rest, hasShopfloorPin: Boolean(shopfloorPinHash) }
}

const refUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  position: u.position ?? '',
  active: u.active !== false,
  photoFileId: u.photoFileId ?? null,
  color: u.color ?? null,
})

// Atrás do Caddy (docker compose) o IP real vem em X-Forwarded-For; só confie nele com TRUST_PROXY=1.
const clientIp = (req) => {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    if (forwarded) return forwarded
  }
  return req.socket.remoteAddress ?? ''
}

// ------------------------------------------------------------------- audit
const labelOf = (doc) => doc?.name ?? doc?.title ?? doc?.code ?? doc?.description ?? doc?.number ?? doc?.id ?? ''

const audit = (user, action, collection, doc, extra = {}) =>
  db.audit({
    userId: user?.id ?? null,
    userName: user?.name ?? 'sistema',
    action,
    collection,
    docId: doc?.id ?? null,
    label: String(labelOf(doc)).slice(0, 140),
    ...extra,
  })

const changedKeys = (before, after) =>
  Object.keys(after).filter(
    (k) => !['updatedAt', 'createdAt', 'passwordHash', 'shopfloorPinHash'].includes(k) && JSON.stringify(before[k]) !== JSON.stringify(after[k]),
  )

// ------------------------------------------------------------------- trash
const CASCADES = {
  projects: (id) => ({
    tasks: (d) => d.projectId === id,
    taskLists: (d) => d.projectId === id,
    timeEntries: (d) => d.projectId === id,
    taskComments: (d) => d.projectId === id,
    projectDocs: (d) => d.projectId === id,
  }),
  tasks: (id) => ({
    tasks: (d) => d.parentId === id,
    taskComments: (d) => d.taskId === id,
    timeEntries: (d) => d.taskId === id,
  }),
}

const moveToTrash = (user, collection, doc) => {
  const cascade = {}
  const rules = CASCADES[collection]?.(doc.id) ?? {}
  for (const [name, predicate] of Object.entries(rules)) {
    const removed = db.removeWhere(name, predicate)
    if (removed.length) cascade[name] = removed
  }
  const entry = db.insert('trash', {
    collection,
    doc,
    cascade,
    label: String(labelOf(doc)).slice(0, 140),
    deletedAt: new Date().toISOString(),
    deletedBy: user.id,
    deletedByName: user.name,
  })
  const trash = db.col('trash')
  if (trash.length > TRASH_LIMIT) for (const old of trash.slice(0, trash.length - TRASH_LIMIT)) db.remove('trash', old.id)
  return entry
}

// -------------------------------------------------------------- permissions
/** Módulos do perfil, limitados ao que o plano da empresa inclui (e nenhum com o acesso bloqueado). */
const userModules = (user) => {
  const modules = resolveModules(user)
  const company = companyOf(user)
  if (!company) return modules
  if (!companyAccess(company).allowed) return []
  const included = new Set(getPlanModules(company.planId))
  return modules.filter((key) => included.has(key))
}

const canUseCollection = (user, name, mode) => {
  const rule = COLLECTIONS[name]
  if (!rule) return false
  if (rule.readOnly && mode === 'write') return false
  if (mode === 'read' && rule.readAll) return true
  const mods = userModules(user)
  return rule.modules.some((m) => mods.includes(m))
}

/** Quem pode aprovar/reprovar compras (o solicitante, em geral PCP, não aprova a própria solicitação). */
const canDecidePurchase = (user) => ['admin', 'gerente', 'financeiro'].includes(user.role)
const canApproveBudget = (user) => ['admin', 'gerente', 'comercial'].includes(user.role)

/** Uma rodada do agendador (notificações e automações por prazo). */
async function runSchedulerOnce(now = new Date()) {
  let automations = null
  try {
    automations = await import('../src/domain/automations.ts')
  } catch {
    /* Node sem type stripping: só notificações */
  }
  // Cada empresa roda no próprio contexto, para que os registros criados fiquem nela.
  const tenants = [null, ...db.all('companies').filter((company) => companyAccess(company, now.getTime()).allowed).map((company) => company.id)]
  const total = { notified: 0, automationsRun: 0, tasksTouched: 0, autoPaused: 0 }
  for (const tenantId of tenants) {
    const summary = db.runAsTenant(tenantId, () => runScheduler(db, { now, automations }))
    for (const key of Object.keys(summary)) total[key] = (total[key] ?? 0) + (summary[key] ?? 0)
    total.autoPaused += db.runAsTenant(tenantId, () => autoPauseForgotten(now))
  }
  return total
}

/** Chão de fábrica: pausa as etapas esquecidas rodando (fim do expediente ou horas demais seguidas). */
function autoPauseForgotten(now) {
  const settings = db.get('settings', 'company') ?? {}
  const maxRunHours = settings.shopfloorMaxRunHours ?? 10
  const found = forgottenTimers(db.col('productionOrders'), { shiftEnd: settings.shopfloorShiftEnd, maxRunHours, timeZone: settings.timeZone || 'America/Sao_Paulo' }, now.getTime())
  let paused = 0
  for (const { order, op, at, reason } of found) {
    try {
      const fresh = db.get('productionOrders', order.id)
      const note = reason === 'fim_turno' ? 'Pausa automática: fim do expediente com o cronômetro ligado' : `Pausa automática: mais de ${maxRunHours} h seguidas sem pausa`
      const result = applyOperationAction(fresh, op.id, 'pause', { user: { id: 'system', name: 'Pausa automática' }, now: at, reason, note })
      const updated = db.update('productionOrders', order.id, { operations: result.operations })
      audit(null, 'operation_autopause', 'productionOrders', updated, { operationId: op.id, operatorId: op.operatorId ?? null })
      if (op.operatorId)
        notify(db, { userId: op.operatorId, kind: 'shopfloor', title: 'Etapa pausada automaticamente', body: `${order.code ?? 'OP'} · ${op.name || 'etapa'} — ${note.replace('Pausa automática: ', '')}. Confira o tempo apontado.`, path: '/chao-de-fabrica', key: `autopause:${order.id}:${op.id}:${op.runningSince}` })
      paused += 1
    } catch (error) {
      console.error('[chão de fábrica] Falha na pausa automática', order.id, error?.message ?? error)
    }
  }
  return paused
}

const requireModule = (user, key) => {
  if (!userModules(user).includes(key)) throw new HttpError(403, `Sem permissão para o módulo "${MODULES[key] ?? key}".`)
}

// ---------------------------------------------------------- doc sanitizing
const RESERVED = new Set(['id', 'createdAt', 'updatedAt', 'createdBy', 'createdByName', 'companyId'])
const cleanBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Corpo da requisição inválido.')
  return Object.fromEntries(Object.entries(body).filter(([k]) => !RESERVED.has(k) && !k.startsWith('_')))
}

const prepareUserWrite = (actor, input, existing) => {
  const out = { ...input }
  delete out.passwordHash
  for (const key of ['totpSecret', 'totpPendingSecret', 'totpEnabled', 'totpLastStep', 'recoveryCodes', 'shopfloorPinHash', 'hasShopfloorPin']) delete out[key]
  // PIN do chão de fábrica: só o hash é gravado; vazio remove
  if ('shopfloorPin' in out) {
    const pin = String(out.shopfloorPin ?? '').trim()
    delete out.shopfloorPin
    if (pin && !/^\d{4,6}$/.test(pin)) throw new HttpError(400, 'O PIN do chão de fábrica deve ter de 4 a 6 números.')
    if (pin && /^(\d)\1+$/.test(pin)) throw new HttpError(400, 'Escolha um PIN sem repetir o mesmo número.')
    out.shopfloorPinHash = pin ? hashPassword(pin) : null
  }
  const password = out.password
  delete out.password
  if (typeof password === 'string' && password.length > 0) {
    const problem = passwordProblem(password, { email: out.email ?? existing?.email, name: out.name ?? existing?.name })
    if (problem) throw new HttpError(400, problem)
    out.passwordHash = hashPassword(password)
    out.passwordMustChange = existing ? existing.id !== actor.id : true
  }
  if (out.email !== undefined) {
    out.email = String(out.email).trim().toLowerCase()
    const dup = db.all('users').find((u) => u.email === out.email && u.id !== existing?.id)
    if (dup) throw new HttpError(409, 'Já existe um usuário com este e-mail.')
  }
  if (actor.role !== 'admin') {
    if (out.role === 'admin' || (existing && existing.role === 'admin')) throw new HttpError(403, 'Somente administradores gerenciam administradores.')
    delete out.deniedModules
  }
  return out
}

const activeAdmins = (excludeId) => db.col('users').filter((u) => u.role === 'admin' && u.active !== false && u.id !== excludeId)

// ---------------------------------------------------------------- handlers
// Acesso da empresa (cobrança) e contexto devolvidos ao cliente em login e /auth/me.
const companySummary = (company) => {
  if (!company) return null
  const access = companyAccess(company)
  return {
    id: company.id,
    name: company.name,
    planId: company.planId,
    planName: company.planName,
    planPrice: company.planPrice,
    status: company.status,
    billingMethod: company.billingMethod ?? null,
    paidUntil: company.paidUntil ?? null,
    cancelAtPeriodEnd: Boolean(company.cancelAtPeriodEnd),
    limits: getPlanLimits(company.planId),
    planModules: getPlanModules(company.planId),
    access,
  }
}

const isLocalUrl = (value) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.(localhost|local|test|lan))(:\d+)?(\/|$)/i.test(String(value ?? ''))
const isUsableAppUrl = (value) => /^https:\/\//i.test(String(value ?? '')) || isLocalUrl(value)

const publicOrigin = (req) => {
  // Em desenvolvimento a porta do Vite varia: o retorno do pagamento volta para a origem que fez a chamada.
  const origin = String(req?.headers?.origin ?? '')
  if (gatewayMode() === 'live') {
    // Com cobrança real o retorno do pagamento só pode apontar para o endereço configurado em APP_URL
    // (https público ou, enquanto não há domínio, um endereço local como http://localhost:5174).
    if (!isUsableAppUrl(process.env.APP_URL)) throw new HttpError(503, 'APP_URL não está configurada no servidor (use https://seu-dominio ou http://localhost:5174).')
    return String(process.env.APP_URL).replace(/\/$/, '')
  }
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
  const configured = process.env.APP_URL
  if (configured) return String(configured).replace(/\/$/, '')
  const host = req?.headers?.['x-forwarded-host'] ?? req?.headers?.host
  return host ? `${req.headers['x-forwarded-proto'] ?? 'http'}://${host}` : 'http://localhost:5174'
}

const billingMethods = () => ({
  card: { label: 'Cartão de crédito', recurring: true, description: 'Assinatura mensal com renovação automática.' },
  pix: { label: 'PIX', recurring: false, months: PIX_MONTH_OPTIONS, description: 'Pagamento único que libera o plano por 1, 3 ou 6 meses.' },
})

const billingStatusPayload = (company) => ({
  company: companySummary(company),
  planId: company.planId,
  planName: company.planName,
  limits: getPlanLimits(company.planId),
  usage: companyUsage(company.id),
  plans: publicPlans(),
  methods: billingMethods(),
  mode: gatewayMode(),
  gateway: 'mercadopago',
  canCancel: company.billingMethod === 'card' && Boolean(company.mpSubscriptionId) && !company.cancelAtPeriodEnd,
  lastPaymentAt: company.lastPaymentAt ?? null,
  lastPaymentError: company.lastPaymentError ?? null,
})

const isCompanyAdmin = (user) => user.role === 'admin' || user.companyRole === 'owner'

/** Confere usuário e senha (limite de tentativas, bloqueio e tempo constante). Usado pelo login do site e do aplicativo. */
function checkCredentials(req, body) {
  const login = String(body.login ?? body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!login || !password) throw new HttpError(400, 'Informe usuário e senha.')
  rateLimit(`login:${clientIp(req)}`, LIMITS.login, 600_000)
  const lockId = `${login}|${clientIp(req)}`
  const locked = sessions.isLocked(lockId)
  if (locked) throw new HttpError(429, `Muitas tentativas. Tente novamente em ${locked} min.`)
  const user = db.all('users').find((u) => u.email === login || u.email.split('@')[0] === login)
  // sempre verifica um hash: o tempo de resposta não revela se o usuário existe
  const passwordOk = verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  // acesso bloqueado pelo administrador: só informa a quem acertou a senha (não revela e-mails)
  if (user && user.active === false && passwordOk) {
    db.runAsTenant(user.companyId ?? null, () => db.audit({ userId: user.id, userName: user.name, action: 'login_blocked', collection: 'auth', ip: clientIp(req) }))
    throw new HttpError(403, 'Seu acesso está bloqueado. Fale com o administrador da sua empresa ou com a Core Cut pelo WhatsApp (21) 99307-9682.')
  }
  const ok = Boolean(user) && user.active !== false && passwordOk
  if (!ok) {
    sessions.fail(lockId)
    metrics.loginFailed()
    db.audit({ userId: user?.id ?? null, userName: user?.name ?? login, action: 'login_failed', collection: 'auth', ip: clientIp(req) })
    throw new HttpError(401, 'Usuário ou senha inválidos.')
  }
  return { user, lockId }
}

/** Abre a sessão e monta a resposta do login (site e aplicativo). */
async function completeLogin(req, user, lockId) {
  sessions.clearFailures(lockId)
  metrics.loginOk()
  const token = sessions.create(user.id, { ip: clientIp(req), agent: req.headers['user-agent'] })
  db.update('users', user.id, { lastLoginAt: new Date().toISOString() })
  db.runAsTenant(user.companyId ?? null, () => db.audit({ userId: user.id, userName: user.name, action: 'login', collection: 'auth', ip: clientIp(req) }))
  let company = companyOf(user)
  if (company) company = await billing.reconcile(company)
  const fresh = db.get('users', user.id)
  return { token, user: publicUser(fresh), modules: userModules(fresh), company: companySummary(company) }
}

/** Quem pode usar e baixar o aplicativo: planos Profissional e Industrial (e a administração da plataforma). */
const appEntitlement = (user) => {
  if (!user.companyId) return { eligible: true, reason: null, planName: 'Plataforma' }
  const company = companyOf(user)
  if (!company) return { eligible: false, reason: 'empresa', message: 'Empresa não encontrada.', planName: null }
  const planName = company.planName ?? company.planId
  if (!planHasMobileApp(company.planId)) {
    return { eligible: false, reason: 'plano', message: 'O aplicativo Android faz parte dos planos Profissional e Industrial. Faça o upgrade em Configurações → Assinatura.', planName }
  }
  const access = companyAccess(company)
  if (!access.allowed) return { eligible: false, reason: 'pagamento', message: access.message || 'A assinatura precisa estar ativa para baixar o aplicativo.', planName }
  return { eligible: true, reason: null, planName }
}

/** Texto curto do aparelho (nome e sistema) para o registro de acessos. */
const deviceLabel = (value) =>
  value && typeof value === 'object'
    ? [value.name, value.platform, value.version].filter((x) => typeof x === 'string' && x).join(' · ').slice(0, 120)
    : String(value ?? '').slice(0, 120)

const FACE_CONSENT_VERSION = '2026-10'

async function handleAuth(req, res, path, query) {
  // ---- aviso automático da Focus NFe (webhook): atualiza a nota quando a SEFAZ responde ----
  if (path === '/api/public/fiscal-webhook' && req.method === 'POST') {
    rateLimit(`fiscal-hook:${clientIp(req)}`, 600, 60_000)
    const secret = String(process.env.FOCUS_WEBHOOK_SECRET ?? '')
    const given = String(req.headers.authorization ?? '').replace(/^(Bearer|Basic)\s+/i, '').trim()
    const a = createHash('sha256').update(given).digest()
    const b = createHash('sha256').update(secret).digest()
    if (!secret || !timingSafeEqual(a, b)) throw new HttpError(401, 'Não autorizado.')
    const body = await readJson(req, 64 * 1024)
    const ref = String(body.ref ?? '')
    const invoice = ref ? db.all('invoices').find((i) => i.ref === ref) : null
    if (invoice) {
      db.runAsTenant(invoice.companyId ?? null, () => {
        const mapped = mapFocusResponse(body, focus.baseOf(invoice.environment))
        if (mapped.status === 'rascunho') return
        db.update('invoices', invoice.id, {
          status: mapped.status,
          message: mapped.message ?? (mapped.status === 'autorizada' ? null : invoice.message),
          ...(mapped.number ? { number: mapped.number } : {}),
          ...(mapped.serie ? { serie: mapped.serie } : {}),
          ...(mapped.accessKey ? { accessKey: mapped.accessKey } : {}),
          ...(mapped.protocol ? { protocol: mapped.protocol } : {}),
          ...(mapped.xmlUrl ? { xmlUrl: mapped.xmlUrl } : {}),
          ...(mapped.danfeUrl ? { danfeUrl: mapped.danfeUrl } : {}),
          ...(mapped.status === 'autorizada' && !invoice.authorizedAt ? { authorizedAt: new Date().toISOString() } : {}),
        })
      })
    }
    // sempre 200: a Focus repete o envio se receber erro
    return send(res, 200, { ok: true })
  }

  // ---- portal do cliente (público, por link secreto) -----------------------
  const portalMatch = path.match(/^\/api\/public\/portal\/([^/]+)(\/request)?$/)
  if (portalMatch) {
    const code = portalMatch[1]
    rateLimit(`portal:${clientIp(req)}`, 120, 60_000)
    const project = validPortalToken(code) ? portal.findProject(code) : null
    // mesma resposta para link inexistente, revogado ou malformado
    if (!project) throw new HttpError(404, 'Este link não está mais disponível. Peça um novo à marcenaria.')
    if (portalMatch[2]) {
      if (req.method !== 'POST') throw new HttpError(405, 'Método não permitido.')
      rateLimit(`portal-req:${code}`, 5, 3_600_000)
      rateLimit(`portal-req-ip:${clientIp(req)}`, 10, 3_600_000)
      const result = portal.request(project, await readJson(req, 16 * 1024))
      if (result.error) throw new HttpError(400, result.error)
      return send(res, 201, result)
    }
    if (req.method !== 'GET') throw new HttpError(405, 'Método não permitido.')
    return send(res, 200, portal.view(project), { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' })
  }
  if (path === '/api/billing/plans' && req.method === 'GET') {
    return send(res, 200, { plans: publicPlans(), methods: billingMethods(), mode: gatewayMode(), gateway: 'mercadopago', simulationAllowed: simulationAllowed() })
  }

  // Retorno do pagamento e polling do QR Code: confere direto no Mercado Pago (funciona sem webhook).
  if (path === '/api/billing/checkout-status' && req.method === 'GET') {
    rateLimit(`status:${clientIp(req)}`, LIMITS.status, 60_000)
    const ref = String(query.ref ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(ref)) throw new HttpError(400, 'Pagamento inválido.')
    const result = await billing.checkoutStatus(ref)
    const company = result.company
    return send(res, 200, {
      state: result.state,
      method: result.method ?? null,
      companyStatus: company?.status ?? null,
      paidUntil: company?.paidUntil ?? null,
      planName: company?.planName ?? null,
      mobileApp: company ? planHasMobileApp(company.planId) : false,
    })
  }

  // Notificações do Mercado Pago (payment, subscription_preapproval, subscription_authorized_payment).
  if (path === '/api/billing/webhook' && req.method === 'POST') {
    const raw = (await readBody(req, MAX_JSON)).toString('utf8')
    let payload = {}
    try {
      payload = raw ? JSON.parse(raw) : {}
    } catch {
      throw new HttpError(400, 'Notificação inválida.')
    }
    const dataId = String(query['data.id'] ?? payload?.data?.id ?? '')
    const type = String(payload?.type ?? query.type ?? query.topic ?? '')
    verifyMercadoPagoSignature({
      signature: req.headers['x-signature'],
      requestId: req.headers['x-request-id'],
      dataId,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    })
    const result = await billing.handleNotification({ type, dataId })
    console.log(`[billing] webhook recebido: tipo=${type || '-'} id=${dataId || '-'} tratado=${Boolean(result?.handled ?? result?.state)}`)
    return send(res, 200, { received: true, handled: Boolean(result?.handled ?? result?.state) })
  }

  if (path === '/api/auth/register-company' && req.method === 'POST') {
    const body = await readJson(req)
    const companyName = String(body.companyName ?? '').trim().slice(0, 160)
    const legalName = String(body.legalName ?? companyName).trim().slice(0, 180)
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    const plan = findPlan(String(body.planId ?? ''))
    const method = body.paymentMethod === 'pix' ? 'pix' : 'card'
    const months = method === 'pix' ? Number(body.pixMonths) || 1 : 1
    const simulate = body.simulate === true || query.simulate === 'true'
    const trial = body.trial === true && !simulate
    const ip = clientIp(req)
    rateLimit(`register:${ip}`, LIMITS.register, 3_600_000)
    if (trial) rateLimit(`trial:${ip}`, LIMITS.trial, 86_400_000)
    if (!simulate && body.acceptTerms !== true) throw new HttpError(400, 'Aceite os Termos de Uso e a Política de Privacidade para continuar.')
    if (companyName.length < 2) throw new HttpError(400, 'Informe o nome da empresa.')
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Informe um e-mail válido.')
    const weakPassword = passwordProblem(password, { email, name: String(body.ownerName ?? '') })
    if (weakPassword) throw new HttpError(400, weakPassword)
    if (!plan) throw new HttpError(400, 'Selecione um plano válido.')
    if (!trial && method === 'pix' && !PIX_MONTH_OPTIONS.includes(months)) throw new HttpError(400, 'Escolha 1, 3 ou 6 meses para o PIX.')
    if (simulate && !simulationAllowed()) throw new HttpError(403, 'A simulação de pagamento está desativada neste ambiente.')

    // Cadastro anterior sem pagamento: quem prova a senha retoma o mesmo cadastro.
    const existing = db.all('users').find((entry) => entry.email === email)
    let company
    let owner
    let resumed = false
    if (existing) {
      const previous = existing.companyId ? billing.findCompany(existing.companyId) : null
      const pending = previous && ['pending_payment'].includes(previous.status) && existing.companyRole === 'owner'
      if (!pending) throw new HttpError(409, 'Já existe uma conta com este e-mail. Entre com sua senha.')
      if (!verifyPassword(password, existing.passwordHash)) {
        throw new HttpError(409, 'Já existe um cadastro com este e-mail aguardando pagamento. Use a mesma senha do cadastro anterior ou entre no sistema para concluir o pagamento.')
      }
      company = db.update('companies', previous.id, {
        name: companyName,
        legalName,
        document: String(body.document ?? '').trim().slice(0, 30),
        phone: String(body.phone ?? '').trim().slice(0, 40),
        planId: plan.id,
        planName: plan.name,
        planPrice: plan.price,
      })
      owner = existing
      resumed = true
    } else {
      // Um cadastro por CPF/CNPJ: evita repetir o teste gratuito com o mesmo documento.
      const documentDigits = String(body.document ?? '').replace(/\D/g, '')
      if (documentDigits.length >= 11 && db.all('companies').some((entry) => String(entry.document ?? '').replace(/\D/g, '') === documentDigits)) {
        throw new HttpError(409, 'Já existe um cadastro com este CPF/CNPJ. Entre com a sua conta ou fale com a Core Cut.')
      }
      company = db.insert('companies', {
        name: companyName,
        legalName,
        document: String(body.document ?? '').trim().slice(0, 30),
        phone: String(body.phone ?? '').trim().slice(0, 40),
        email,
        status: simulate ? 'active' : trial ? 'trial' : 'pending_payment',
        planId: plan.id,
        planName: plan.name,
        planPrice: plan.price,
        billingStatus: simulate ? 'active' : trial ? 'trial' : 'incomplete',
        billingMethod: simulate ? 'simulated' : trial ? 'trial' : null,
        ...(trial ? { trialEndsAt: new Date(Date.now() + TRIAL_HOURS * 3_600_000).toISOString(), trialStartedAt: new Date().toISOString() } : {}),
        termsAcceptedAt: new Date().toISOString(),
        signupIp: ip,
        gateway: 'mercadopago',
      })
      // O titular entra no ERP mesmo antes de pagar: vê apenas a tela de assinatura.
      owner = db.insert('users', {
        name: String(body.ownerName ?? companyName).trim().slice(0, 120),
        email,
        role: 'admin',
        active: true,
        companyId: company.id,
        companyRole: 'owner',
        position: 'Administrador da empresa',
        phone: String(body.phone ?? '').trim().slice(0, 40),
        passwordHash: hashPassword(password),
        passwordMustChange: false,
      })
      db.runAsTenant(company.id, () => seedCompanyDefaults(db, company))
    }

    const actor = { id: owner.id, name: owner.name, role: owner.role }
    if (trial) {
      if (resumed) {
        const start = Date.now()
        company = db.update('companies', company.id, { status: 'trial', billingStatus: 'trial', billingMethod: 'trial', trialStartedAt: new Date(start).toISOString(), trialEndsAt: new Date(start + TRIAL_HOURS * 3_600_000).toISOString() })
      }
      db.runAsTenant(company.id, () => audit(actor, 'company_trial_start', 'companies', company, { planId: plan.id }))
      // Já devolve a sessão: a pessoa entra direto no sistema.
      const token = sessions.create(owner.id, { ip, agent: req.headers['user-agent'] })
      db.update('users', owner.id, { lastLoginAt: new Date().toISOString() })
      db.runAsTenant(company.id, () => db.audit({ userId: owner.id, userName: owner.name, action: 'login', collection: 'auth', ip }))
      const fresh = db.get('users', owner.id)
      return send(res, 201, {
        trial: true,
        companyId: company.id,
        trialEndsAt: company.trialEndsAt,
        token,
        user: publicUser(fresh),
        modules: userModules(fresh),
        company: companySummary(db.all('companies').find((entry) => entry.id === company.id)),
      })
    }
    if (simulate) {
      db.update('companies', company.id, { status: 'active', billingStatus: 'active', billingMethod: 'simulated' })
      db.runAsTenant(company.id, () => audit(actor, 'company_signup', 'companies', company, { planId: plan.id, simulated: true }))
      return send(res, 201, { companyId: company.id, plan: publicPlans().find((entry) => entry.id === plan.id), simulated: true })
    }

    try {
      const checkout = await billing.createCheckout({ company, planId: plan.id, method, months, origin: publicOrigin(req), email, payerName: owner.name })
      db.runAsTenant(company.id, () => audit(actor, resumed ? 'company_signup_resume' : 'company_signup', 'companies', company, { planId: plan.id, method }))
      return send(res, 201, {
        companyId: company.id,
        ref: checkout.ref,
        method,
        months: checkout.months,
        plan: publicPlans().find((entry) => entry.id === plan.id),
        ...(checkout.checkoutUrl ? { checkoutUrl: checkout.checkoutUrl } : {}),
        ...(checkout.pix ? { pix: checkout.pix } : {}),
      })
    } catch (error) {
      if (!resumed) {
        // Cadastro novo que não chegou ao pagamento: não deixa registros órfãos.
        db.purgeTenant(company.id)
        db.remove('users', owner.id)
        db.remove('companies', company.id)
      }
      throw error
    }
  }

  // ---- recuperação de senha por e-mail ------------------------------------
  if (path === '/api/auth/forgot-password' && req.method === 'POST') {
    const body = await readJson(req)
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 160)
    rateLimit(`forgot:${clientIp(req)}`, LIMITS.forgot, 3_600_000)
    if (email) rateLimit(`forgot-email:${email}`, 3, 3_600_000)
    const answer = { ok: true, message: 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por 30 minutos.' }
    const user = email ? db.all('users').find((u) => u.email === email) : null
    // limpeza de tokens vencidos (e de iscas) para a coleção não crescer
    const staleBefore = Date.now() - 24 * 3_600_000
    for (const old of db.all('passwordResets').filter((r) => Date.parse(r.expiresAt) < staleBefore)) db.remove('passwordResets', old.id)
    if (email && (!user || user.active === false)) {
      db.audit({ userId: user?.id ?? null, userName: user ? user.name : email, action: 'password_reset_unknown', collection: 'auth', ip: clientIp(req) })
    }
    if (!user || user.active === false) {
      // isca: mesma gravação do caso real, para que o tempo de resposta não revele se o e-mail existe
      db.insert('passwordResets', { userId: null, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), usedAt: new Date().toISOString(), decoy: true, ip: clientIp(req) })
    }
    if (user && user.active !== false) {
      const token = randomBytes(32).toString('hex')
      // tokens anteriores deixam de valer: só o último link funciona
      for (const old of db.all('passwordResets').filter((r) => r.userId === user.id && !r.usedAt)) db.update('passwordResets', old.id, { usedAt: new Date().toISOString(), superseded: true })
      db.insert('passwordResets', { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), usedAt: null, ip: clientIp(req) })
      let origin
      try {
        origin = publicOrigin(req)
      } catch {
        origin = appUrl()
      }
      // sem esperar: o tempo de resposta não revela se o e-mail existe
      void mailer.sendMail({ to: user.email, ...emails.passwordReset({ name: user.name, url: `${origin}/redefinir-senha?token=${token}` }) })
      db.runAsTenant(user.companyId ?? null, () => db.audit({ userId: user.id, userName: user.name, action: 'password_reset_requested', collection: 'auth', ip: clientIp(req) }))
    }
    return send(res, 200, answer)
  }

  if (path === '/api/auth/reset-password' && req.method === 'POST') {
    const body = await readJson(req)
    rateLimit(`reset:${clientIp(req)}`, LIMITS.forgot * 2, 3_600_000)
    const token = String(body.token ?? '')
    const next = String(body.newPassword ?? '')
    const hash = createHash('sha256').update(token).digest('hex')
    const record = token.length >= 32 ? db.all('passwordResets').find((r) => r.tokenHash === hash) : null
    const user = record ? db.get('users', record.userId) : null
    if (!record || record.usedAt || Date.parse(record.expiresAt) < Date.now() || !user || user.active === false) {
      throw new HttpError(400, 'Este link é inválido ou expirou. Peça um novo em "Esqueci minha senha".')
    }
    const resetProblem = passwordProblem(next, { email: user.email, name: user.name })
    if (resetProblem) throw new HttpError(400, resetProblem)
    db.update('passwordResets', record.id, { usedAt: new Date().toISOString() })
    const updated = db.update('users', user.id, { passwordHash: hashPassword(next), passwordMustChange: false })
    sessions.destroyAllFor(user.id) // quem tinha a senha antiga (ou um token roubado) perde o acesso
    sessions.clearFailures(`${user.email}|${clientIp(req)}`)
    db.runAsTenant(user.companyId ?? null, () => db.audit({ userId: user.id, userName: user.name, action: 'password_reset', collection: 'auth', ip: clientIp(req) }))
    return send(res, 200, { ok: true, email: updated.email })
  }

  if (path === '/api/auth/login' && req.method === 'POST') {
    const body = await readJson(req)
    const { user, lockId } = checkCredentials(req, body)
    return send(res, 200, await completeLogin(req, user, lockId))
  }
  // ---- aplicativo Android: senha + verificação facial ---------------
  if (path === '/api/mobile/login' && req.method === 'POST') {
    const body = await readJson(req)
    const { user, lockId } = checkCredentials(req, body)
    const entitlement = appEntitlement(user)
    if (!entitlement.eligible && entitlement.reason === 'plano') {
      db.runAsTenant(user.companyId ?? null, () => db.audit({ userId: user.id, userName: user.name, action: 'app_blocked_plan', collection: 'auth', ip: clientIp(req), label: String(entitlement.planName ?? '') }))
      throw new HttpError(403, entitlement.message)
    }
    const engine = await faceEngine.available()
    if (!engine.ok) {
      db.runAsTenant(user.companyId ?? null, () => db.audit({ userId: user.id, userName: user.name, action: 'face_unavailable', collection: 'auth', ip: clientIp(req), label: String(engine.reason ?? '').slice(0, 120) }))
      // sem motor facial no servidor o app não abre (nunca cai para "só senha" sem aviso)
      throw new HttpError(503, 'A verificação facial não está disponível no servidor agora. Tente em instantes ou use o site.')
    }
    const profile = db.runAsTenant(user.companyId ?? null, () => faces.profileOf(user.id))
    const ticket = faceTickets.create(user.id, { lockId, ip: clientIp(req), device: deviceLabel(body.device) })
    return send(res, 200, {
      faceRequired: true,
      enrolled: Boolean(profile),
      ticket,
      name: String(user.name ?? '').split(/\s+/)[0] || 'olá',
      consentVersion: FACE_CONSENT_VERSION,
    })
  }

  // ---- download do aplicativo: link temporário, sem sessão, só para quem já foi liberado ---------
  const appDownload = path.match(/^\/api\/public\/app-download\/([0-9a-f]{48})$/)
  if (appDownload && req.method === 'GET') {
    rateLimit(`app-download:${clientIp(req)}`, 30, 600_000)
    const grant = appDownloads.get(appDownload[1])
    if (!grant || grant.expires < Date.now() || grant.uses >= 3) {
      appDownloads.delete(appDownload[1])
      throw new HttpError(410, 'Este link de download expirou. Volte à página do aplicativo e gere um novo.')
    }
    if (!existsSync(appApkPath)) throw new HttpError(404, 'O arquivo do aplicativo ainda não foi publicado neste servidor.')
    grant.uses += 1
    db.runAsTenant(grant.companyId ?? null, () => db.audit({ userId: grant.userId, userName: grant.userName, action: 'app_download', collection: 'auth', ip: clientIp(req), label: grant.planName }))
    const size = statSync(appApkPath).size
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="CoreCut-ERP.apk"',
      'Content-Length': size,
      'Cache-Control': 'no-store',
    })
    return createReadStream(appApkPath).pipe(res)
  }

  const faceStep = path.match(/^\/api\/mobile\/face\/(enroll|verify)$/)
  if (faceStep && req.method === 'POST') {
    rateLimit(`face:${clientIp(req)}`, 60, 600_000)
    const body = await readJson(req, 900 * 1024)
    const ticket = faceTickets.get(body.ticket)
    if (!ticket) throw new HttpError(401, 'A verificação expirou. Entre com usuário e senha de novo.')
    const user = db.get('users', ticket.userId)
    if (!user || user.active === false) throw new HttpError(401, 'Usuário inativo.')
    const kind = faceStep[1]
    const image = decodeImage(body.image)
    if (!image) throw new HttpError(400, 'Foto inválida. Tire a foto de novo.')
    const store = (fn) => db.runAsTenant(user.companyId ?? null, fn)
    const described = await faceEngine.describe(image)
    const miss = (result, message, status = 400) => {
      store(() => faces.recordCheck({ userId: user.id, userName: user.name, result, kind, photo: image, ip: clientIp(req), device: ticket.device }))
      throw new HttpError(status, message)
    }

    if (!described.ok) {
      faceTickets.fail(body.ticket)
      return miss(described.reason, FACE_MESSAGES[described.reason] ?? 'Não foi possível analisar a foto.')
    }

    if (kind === 'enroll') {
      if (store(() => faces.profileOf(user.id))) throw new HttpError(409, 'Este usuário já tem um rosto cadastrado. Peça ao administrador para redefinir.')
      if (body.consent !== true) throw new HttpError(400, 'É preciso aceitar o uso da imagem do rosto para continuar.')
      store(() => {
        faces.saveProfile({ userId: user.id, userName: user.name, descriptor: described.descriptor, photo: image, device: ticket.device, consentVersion: FACE_CONSENT_VERSION })
        faces.recordCheck({ userId: user.id, userName: user.name, result: 'cadastrado', kind: 'enroll', photo: image, ip: clientIp(req), device: ticket.device })
        db.audit({ userId: user.id, userName: user.name, action: 'face_enroll', collection: 'auth', ip: clientIp(req) })
      })
    } else {
      const profile = store(() => faces.profileOf(user.id))
      if (!profile) throw new HttpError(409, 'Nenhum rosto cadastrado para este usuário.')
      const reference = faces.descriptorOf(profile)
      const distance = euclidean(reference, described.descriptor)
      if (!(distance <= FACE_MATCH_DISTANCE)) {
        const left = faceTickets.fail(body.ticket)
        store(() => db.audit({ userId: user.id, userName: user.name, action: 'face_failed', collection: 'auth', ip: clientIp(req) }))
        sessions.fail(ticket.lockId)
        metrics.loginFailed()
        return miss('recusado', left > 0 ? `Não reconhecemos o rosto. Restam ${left} tentativa(s).` : 'Não reconhecemos o rosto. Entre de novo com usuário e senha.', 401)
      }
      store(() => faces.recordCheck({ userId: user.id, userName: user.name, result: 'aprovado', kind, distance, photo: image, ip: clientIp(req), device: ticket.device }))
    }
    faceTickets.consume(body.ticket)
    return send(res, 200, { ...(await completeLogin(req, user, ticket.lockId)), face: true })
  }

  return null
}

async function handleAuthenticated(req, res, path, query, user, token) {
  const method = req.method
  const url = path
  let company = companyOf(user)

  // Canal ao vivo: só avisa quais coleções mudaram (as telas recarregam pela rota normal)
  if (url === '/api/events' && method === 'GET') {
    live.connect(req, res, { tenant: user.companyId ?? null, canRead: (name) => canUseCollection(user, name, 'read'), alive: () => Boolean(sessions.resolve(token)) })
    return
  }

  // Relato de erro do navegador (tela que quebrou): vai para o Monitoramento do Painel Admin.
  if (url === '/api/auth/client-error' && method === 'POST') {
    const body = await readJson(req, 16 * 1024)
    metrics.recordClientError({ page: body.page, message: body.message, where: body.where, stack: body.stack, user: `${user.name} <${user.email}>` })
    console.error(`[navegador] ${user.email} ${String(body.page ?? '').slice(0, 120)}: ${String(body.message ?? '').slice(0, 300)}`)
    return send(res, 200, { ok: true })
  }

  // ---- aplicativo Android: quem tem direito (planos Profissional e Industrial) -------------------
  if (url === '/api/mobile/app-info' && method === 'GET') {
    const entitlement = appEntitlement(user)
    return send(res, 200, { ...entitlement, version: appVersionInfo(), available: existsSync(appApkPath) })
  }
  if (url === '/api/mobile/download-link' && method === 'POST') {
    rateLimit(`app-link:${user.id}`, 20, 600_000)
    const entitlement = appEntitlement(user)
    if (!entitlement.eligible) throw new HttpError(403, entitlement.message)
    if (!existsSync(appApkPath)) throw new HttpError(404, 'O arquivo do aplicativo ainda não foi publicado neste servidor.')
    const code = randomBytes(24).toString('hex')
    for (const [key, grant] of appDownloads) if (grant.expires < Date.now()) appDownloads.delete(key)
    appDownloads.set(code, { userId: user.id, userName: user.name, companyId: user.companyId ?? null, planName: entitlement.planName, expires: Date.now() + 10 * 60_000, uses: 0 })
    audit(user, 'app_download_link', 'auth', user)
    return send(res, 200, { url: `/api/public/app-download/${code}`, expiresInSeconds: 600 })
  }

  // ---- aplicativo: nova checagem do rosto ao reabrir (sessão já aberta) --------------------------
  if (url === '/api/mobile/face/recheck' && method === 'POST') {
    rateLimit(`face-recheck:${user.id}`, 20, 600_000)
    const body = await readJson(req, 900 * 1024)
    const image = decodeImage(body.image)
    if (!image) throw new HttpError(400, 'Foto inválida. Tire a foto de novo.')
    const profile = faces.profileOf(user.id)
    if (!profile) throw new HttpError(409, 'Nenhum rosto cadastrado.')
    const described = await faceEngine.describe(image)
    if (!described.ok) {
      faces.recordCheck({ userId: user.id, userName: user.name, result: described.reason, kind: 'recheck', photo: image, ip: clientIp(req) })
      throw new HttpError(400, FACE_MESSAGES[described.reason] ?? 'Não foi possível analisar a foto.')
    }
    const distance = euclidean(faces.descriptorOf(profile), described.descriptor)
    const approved = distance <= FACE_MATCH_DISTANCE
    faces.recordCheck({ userId: user.id, userName: user.name, result: approved ? 'aprovado' : 'recusado', kind: 'recheck', distance, photo: image, ip: clientIp(req) })
    db.audit({ userId: user.id, userName: user.name, action: approved ? 'face_recheck_ok' : 'face_recheck_failed', collection: 'auth', ip: clientIp(req) })
    // 403 (e não 401) para o aplicativo não confundir com sessão vencida
    if (!approved) throw new HttpError(403, 'Não reconhecemos o rosto.')
    return send(res, 200, { ok: true })
  }
  if (url === '/api/mobile/face/status' && method === 'GET') {
    return send(res, 200, { enrolled: Boolean(faces.profileOf(user.id)) })
  }

  if (url === '/api/auth/me' && method === 'GET') {
    if (company) company = await billing.reconcile(company)
    return send(res, 200, { user: publicUser(user), modules: userModules(user), company: companySummary(company) })
  }

  // ---- assinatura e cobrança ------------------------------------------------
  if (url === '/api/billing/status' && method === 'GET') {
    if (!company) throw new HttpError(404, 'Este usuário não pertence a uma empresa com assinatura.')
    company = await billing.reconcile(company)
    return send(res, 200, billingStatusPayload(company))
  }
  if (url === '/api/billing/company-usage' && method === 'GET') {
    if (!company) throw new HttpError(404, 'Este usuário não pertence a uma empresa com assinatura.')
    const status = billingStatusPayload(company)
    return send(res, 200, { limits: status.limits, usage: status.usage, planId: company.planId, planName: company.planName })
  }
  if (url === '/api/billing/checkout' && method === 'POST') {
    if (!company) throw new HttpError(404, 'Este usuário não pertence a uma empresa com assinatura.')
    if (!isCompanyAdmin(user)) throw new HttpError(403, 'Somente administradores gerenciam a assinatura.')
    const body = await readJson(req)
    const planId = body.planId ?? company.planId
    const method_ = body.paymentMethod === 'pix' ? 'pix' : 'card'
    const checkout = await billing.createCheckout({ company, planId, method: method_, months: Number(body.pixMonths) || 1, origin: publicOrigin(req), email: user.email, payerName: user.name })
    audit(user, 'billing_checkout', 'companies', company, { planId, method: method_ })
    return send(res, 201, {
      ref: checkout.ref,
      method: method_,
      months: checkout.months,
      ...(checkout.checkoutUrl ? { checkoutUrl: checkout.checkoutUrl } : {}),
      ...(checkout.pix ? { pix: checkout.pix } : {}),
    })
  }
  if (url === '/api/billing/cancel' && method === 'POST') {
    if (!company) throw new HttpError(404, 'Este usuário não pertence a uma empresa com assinatura.')
    if (!isCompanyAdmin(user)) throw new HttpError(403, 'Somente administradores gerenciam a assinatura.')
    const updated = await billing.cancelSubscription(company)
    audit(user, 'billing_cancel', 'companies', company)
    return send(res, 200, billingStatusPayload(updated))
  }
  if (url === '/api/admin/companies' && method === 'GET') {
    if (user.companyId || user.role !== 'admin') throw new HttpError(403, 'Somente a administração da plataforma lista empresas.')
    const items = db.all('companies').map((entry) => ({
      id: entry.id,
      name: entry.name,
      email: entry.email,
      planName: entry.planName,
      status: entry.status,
      billingMethod: entry.billingMethod ?? null,
      paidUntil: entry.paidUntil ?? null,
      createdAt: entry.createdAt,
      access: companyAccess(entry),
      usage: companyUsage(entry.id),
      limits: getPlanLimits(entry.planId),
    }))
    return send(res, 200, { items })
  }
  if (url === '/api/auth/logout' && method === 'POST') {
    sessions.destroy(token)
    db.audit({ userId: user.id, userName: user.name, action: 'logout', collection: 'auth' })
    return send(res, 200, { ok: true }, { 'Set-Cookie': clearGateCookie() })
  }
  if (url === '/api/auth/change-password' && method === 'POST') {
    const body = await readJson(req)
    if (!verifyPassword(String(body.currentPassword ?? ''), user.passwordHash)) throw new HttpError(400, 'Senha atual incorreta.')
    const next = String(body.newPassword ?? '')
    const problem = passwordProblem(next, { email: user.email, name: user.name })
    if (problem) throw new HttpError(400, problem)
    if (next === body.currentPassword) throw new HttpError(400, 'A nova senha deve ser diferente da atual.')
    const updated = db.update('users', user.id, { passwordHash: hashPassword(next), passwordMustChange: false })
    sessions.destroyOthers(user.id, token) // quem tinha a senha antiga (ou um token roubado) perde o acesso
    audit(user, 'password_change', 'users', updated)
    return send(res, 200, { user: publicUser(updated), modules: userModules(updated) })
  }
  if (url === '/api/auth/profile' && method === 'PUT') {
    const body = cleanBody(await readJson(req))
    const allowed = ['name', 'phone', 'photoFileId', 'color']
    const patch = Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k)))
    const updated = db.update('users', user.id, patch)
    return send(res, 200, { user: publicUser(updated) })
  }

  if (url === '/api/meta' && method === 'GET') {
    return send(res, 200, {
      name: 'Core Cut ERP',
      version: '1.0.0',
      time: new Date().toISOString(),
      catalog: { items: catalog.items.length, generatedAt: catalog.meta.generatedAt },
    })
  }

  // ---- catálogo Leo Madeiras -------------------------------------------
  const budgetApproval = url.match(/^\/api\/budgets\/([^/]+)\/approve$/)
  if (budgetApproval && method === 'POST') {
    requireModule(user, 'budgets')
    if (!canApproveBudget(user)) throw new HttpError(403, 'Somente administração, gerência e comercial aprovam orçamentos.')
    const budget = db.get('budgets', budgetApproval[1])
    if (!budget) throw new HttpError(404, 'Orçamento não encontrado.')
    if (!['rascunho', 'enviado', 'aprovado'].includes(budget.status)) throw new HttpError(400, 'Este orçamento não pode ser aprovado.')
    if (!Array.isArray(budget.items) || budget.items.length === 0) throw new HttpError(400, 'Adicione ao menos um item antes de aprovar o orçamento.')

    const body = await readJson(req)
    const total = budgetTotal(budget)
    const dueOffset = Math.max(Number(budget.deliveryDays) || 30, 1)
    const project = budget.projectId && db.get('projects', budget.projectId)
      ? db.get('projects', budget.projectId)
      : db.insert('projects', {
          code: db.nextCode('PRJ'),
          name: budget.title,
          clientId: budget.clientId,
          stageId: 'planejamento',
          priority: 'media',
          managerId: budget.responsibleId ?? user.id,
          memberIds: [user.id],
          startDate: dateOnly(),
          dueDate: dateOnly(dueOffset),
          contractValue: total,
          estimatedCost: (budget.items ?? []).reduce((sum, item) => sum + Number(item.quantity) * Number(item.unitCost), 0),
          description: `Projeto criado a partir do orçamento ${budget.code ?? budget.id}.`,
          archived: false,
          tags: ['origem:orcamento'],
        })

    if (!budget.projectId) {
      const list = db.insert('taskLists', { projectId: project.id, name: 'Planejamento inicial', color: '#2f8f8a', order: 1000 })
      for (const [index, title] of ['Validar medidas e escopo', 'Liberar engenharia para produção', 'Programar corte e usinagem', 'Conferir qualidade antes da entrega'].entries())
        db.insert('tasks', { projectId: project.id, listId: list.id, title, status: 'todo', priority: 'normal', assigneeIds: [], dueDate: dateOnly(Math.max(1, Math.round((dueOffset * (index + 1)) / 4))), order: (index + 1) * 1000, tags: [], checklists: [] })
    }

    let productionOrder = db.col('productionOrders').find((order) => order.budgetId === budget.id)
    if (!productionOrder) {
      const items = budget.items.map((item) => ({ id: randomUUID(), bomId: item.bomId, name: item.description, quantity: Number(item.quantity) || 1, notes: item.group }))
      const operations = []
      for (const item of items) {
        const bom = item.bomId ? db.get('boms', item.bomId) : null
        for (const route of bom?.routing ?? []) {
          const center = db.get('workCenters', route.workCenterId)
          operations.push({ id: randomUUID(), workCenterId: route.workCenterId, name: center?.name ?? 'Operação', order: operations.length + 1, plannedMinutes: Number(route.minutes) * item.quantity, actualSeconds: 0, status: 'pendente', runningSince: null, operatorId: null, operatorName: null, quantityDone: 0, startedAt: null, finishedAt: null })
        }
      }
      productionOrder = db.insert('productionOrders', { code: db.nextCode('OP'), title: `Produção — ${budget.title}`, budgetId: budget.id, projectId: project.id, clientId: budget.clientId, status: 'planejada', priority: 'media', startDate: dateOnly(), dueDate: dateOnly(dueOffset), items, operations, materialsPosted: false, cutPlanIds: [], notes: `Gerada pela aprovação do orçamento ${budget.code ?? budget.id}.` })
    }

    let receivables = db.col('receivables').filter((entry) => entry.budgetId === budget.id)
    if (!receivables.length && total > 0) {
      const requested = Array.isArray(body.installments) ? body.installments : []
      const installments = requested.length ? requested : [{ label: 'Entrada', percent: 50, dueDate: dateOnly() }, { label: 'Entrega', percent: 50, dueDate: dateOnly(dueOffset) }]
      let allocated = 0
      receivables = installments.filter((part) => Number(part.percent) > 0).map((part, index, list) => {
        const amount = index === list.length - 1 ? round2(total - allocated) : round2(total * Number(part.percent) / 100)
        allocated += amount
        return db.insert('receivables', { description: `${budget.code ?? budget.title} — ${part.label ?? `Parcela ${index + 1}`}`, amount, dueDate: String(part.dueDate ?? dateOnly(index ? dueOffset : 0)), status: 'pendente', category: 'Orçamento aprovado', clientId: budget.clientId, projectId: project.id, budgetId: budget.id, installmentLabel: part.label ?? `Parcela ${index + 1}` })
      })
    }

    const updated = db.update('budgets', budget.id, { status: 'aprovado', approvedAt: budget.approvedAt ?? new Date().toISOString(), projectId: project.id, productionOrderId: productionOrder.id, receivableIds: receivables.map((entry) => entry.id) })
    audit(user, 'approve', 'budgets', updated, { changes: ['projeto', 'ordem de produção', 'contas a receber'] })
    return send(res, 200, { budget: updated, project, productionOrder, receivables, created: { project: !budget.projectId, productionOrder: !budget.productionOrderId, receivables: receivables.length > 0 } })
  }

  if (url === '/api/catalog/leo' && method === 'GET') {
    requireModule(user, 'inventory')
    const supplier = ensureLeoSupplier()
    return send(res, 200, { ...catalog.search(query), supplier: supplierReference(supplier) })
  }
  if (url === '/api/catalog/leo/facets' && method === 'GET') {
    requireModule(user, 'inventory')
    const supplier = ensureLeoSupplier()
    return send(res, 200, { ...catalog.facets(), supplier: supplierReference(supplier) })
  }
  if (url === '/api/catalog/leo/import' && method === 'POST') {
    requireModule(user, 'inventory')
    const { ids = [] } = await readJson(req)
    const fresh = ids.slice(0, 500).filter((id) => {
      const item = catalog.find(id)
      return item && !db.col('materials').some((m) => m.catalogId === item.id)
    })
    if (fresh.length) assertCapacity('materials', user.companyId, fresh.length)
    const supplier = ensureLeoSupplier()
    const created = []
    const skipped = []
    const materials = []
    for (const id of ids.slice(0, 500)) {
      const item = catalog.find(id)
      if (!item) continue
      const existing = db.col('materials').find((m) => m.catalogId === item.id)
      if (existing) {
        skipped.push(existing.id)
        materials.push(existing)
        continue
      }
      const doc = db.insert('materials', materialFromCatalog(item, supplier.id))
      created.push(doc)
      materials.push(doc)
    }
    if (created.length) audit(user, 'catalog_import', 'materials', { id: null, name: `${created.length} itens da Leo Madeiras` })
    return send(res, 200, { created, skipped, materials, supplier: supplierReference(supplier), initialStock: 0 })
  }
  if (url === '/api/catalog/leo/purchase' && method === 'POST') {
    requireModule(user, 'inventory')
    requireModule(user, 'purchases')
    const body = await readJson(req)
    const supplier = ensureLeoSupplier()
    const lines = Array.isArray(body.items) ? body.items : []
    const items = []
    const materials = []
    for (const line of lines.slice(0, 500)) {
      const item = catalog.find(String(line.id ?? ''))
      const quantity = round2(Number(line.quantity))
      if (!item || quantity <= 0) continue
      let material = db.col('materials').find((m) => m.catalogId === item.id)
      if (!material) material = db.insert('materials', materialFromCatalog(item, supplier.id))
      materials.push(material)
      items.push({ materialId: material.id, description: item.name, unit: item.unit, quantity, unitCost: round2(item.price ?? 0), received: 0 })
    }
    if (!items.length) throw new HttpError(400, 'Selecione ao menos um produto e informe uma quantidade válida.')
    const purchase = db.insert('purchases', {
      code: db.nextCode('PC'),
      status: 'rascunho',
      supplierId: supplier.id,
      items,
      notes: 'Pedido gerado a partir do catálogo Leo Madeiras.',
      createdBy: user.id,
      createdByName: user.name,
    })
    audit(user, 'create_from_catalog', 'purchases', purchase, { supplierId: supplier.id, items: items.length })
    return send(res, 201, { purchase, supplier: supplierReference(supplier), materials })
  }
  if (url === '/api/catalog/leo/sync-prices' && method === 'POST') {
    requireModule(user, 'inventory')
    if (query.reload === '1') catalog.reload()
    const now = new Date().toISOString()
    let updated = 0
    let unchanged = 0
    let missing = 0
    const changes = []
    for (const m of db.col('materials')) {
      if (!m.catalogId) continue
      const item = catalog.find(m.catalogId)
      if (!item) {
        missing += 1
        continue
      }
      if (item.price === null || item.price === m.cost) {
        unchanged += 1
        continue
      }
      const history = [...(m.priceHistory ?? []), { at: now, price: m.cost }].slice(-24)
      db.update('materials', m.id, { cost: item.price, priceUpdatedAt: now, priceHistory: history, imageUrl: m.imageUrl ?? item.image })
      changes.push({ id: m.id, name: m.name, from: m.cost, to: item.price })
      updated += 1
    }
    audit(user, 'catalog_sync', 'materials', { id: null, name: `Preços atualizados: ${updated}` })
    return send(res, 200, { updated, unchanged, missing, changes: changes.slice(0, 100), generatedAt: catalog.meta.generatedAt })
  }

  // ---- producao: reserva e consumo de materiais ------------------------
  const qualityStart = url.match(/^\/api\/production-orders\/([^/]+)\/quality\/start$/)
  if (qualityStart && method === 'POST') {
    requireModule(user, 'production')
    const order = db.get('productionOrders', qualityStart[1])
    if (!order) throw new HttpError(404, 'Ordem de producao nao encontrada.')
    if (!['liberada', 'em_producao', 'qualidade'].includes(order.status)) throw new HttpError(409, 'A ordem precisa estar liberada ou em producao para iniciar a qualidade.')
    return send(res, 200, startQualityInspection(user, order))
  }

  // ---- chão de fábrica: troca de operador por PIN ----------------------
  if (url === '/api/shopfloor/operators' && method === 'GET') {
    requireModule(user, 'shopfloor')
    const operators = db
      .col('users')
      .filter((u) => u.active !== false && userModules(u).includes('shopfloor'))
      .map((u) => ({ id: u.id, name: u.name, position: u.position ?? '', photoFileId: u.photoFileId ?? null, hasPin: Boolean(u.shopfloorPinHash) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return send(res, 200, operators)
  }

  if (url === '/api/shopfloor/operator' && method === 'POST') {
    requireModule(user, 'shopfloor')
    const body = await readJson(req)
    const userId = String(body.userId ?? '')
    rateLimit(`shopfloor-pin:${user.id}`, 20, 10 * 60_000)
    rateLimit(`shopfloor-pin-user:${userId}`, 6, 10 * 60_000)
    const operator = db.get('users', userId)
    const valid = operator && operator.active !== false && userModules(operator).includes('shopfloor')
    const ok = verifyPassword(String(body.pin ?? ''), valid && operator.shopfloorPinHash ? operator.shopfloorPinHash : DUMMY_HASH) && valid && operator.shopfloorPinHash
    if (!ok) throw new HttpError(401, valid && !operator.shopfloorPinHash ? 'Este operador ainda não tem PIN. Peça para cadastrar em Equipe.' : 'PIN incorreto.')
    const ticket = operatorTickets.create(operator.id, { sessionUserId: user.id })
    audit(user, 'shopfloor_operator', 'users', operator)
    return send(res, 200, { ticket, operator: { id: operator.id, name: operator.name } })
  }

  // operador saiu (botão Sair ou inatividade no tablet): o tíquete deixa de valer
  if (url === '/api/shopfloor/operator' && method === 'DELETE') {
    const ticket = operatorTickets.get(req.headers['x-operator'])
    if (ticket && ticket.sessionUserId === user.id) operatorTickets.consume(req.headers['x-operator'])
    return send(res, 200, { ok: true })
  }

  // ---- chão de fábrica: apontamento por etapa (relógio do servidor) ----
  const operationAction = url.match(/^\/api\/production-orders\/([^/]+)\/operations\/([^/]+)\/(start|pause|finish)$/)
  if (operationAction && method === 'POST') {
    requireModule(user, 'shopfloor')
    const order = db.get('productionOrders', operationAction[1])
    if (!order) throw new HttpError(404, 'Ordem de producao nao encontrada.')
    const action = operationAction[3]
    const body = await readJson(req)
    const operator = shopfloorOperator(req, user)
    // apontamento feito sem internet: o aparelho diz há quanto tempo foi (sem depender do relógio dele)
    const lagMs = Math.min(Math.max(Math.round(Number(body.elapsedMs) || 0), 0), 12 * 60 * 60_000)
    const result = applyOperationAction(order, decodeURIComponent(operationAction[2]), action, {
      now: Date.now() - lagMs,
      user: operator,
      quantity: body.quantity,
      reason: body.reason,
      note: body.note,
      running: action === 'start' ? runningOperationsOf(db.col('productionOrders'), operator.id) : [],
    })
    if (result.unchanged) return send(res, 200, { productionOrder: order, inspection: null })
    let updated = db.update('productionOrders', order.id, { operations: result.operations, ...(result.status ? { status: result.status } : {}) })
    audit(user, `operation_${action}`, 'productionOrders', updated, { operationId: operationAction[2], operatorId: operator.id, operatorName: operator.name })
    // roteiro completo: a ordem segue sozinha para a inspeção de qualidade
    let inspection = null
    if (result.finished) ({ productionOrder: updated, inspection } = startQualityInspection(user, updated))
    return send(res, 200, { productionOrder: updated, inspection })
  }

  const qualityDecision = url.match(/^\/api\/production-orders\/([^/]+)\/quality\/(approve|reject)$/)
  if (qualityDecision && method === 'POST') {
    requireModule(user, 'quality')
    const order = db.get('productionOrders', qualityDecision[1])
    if (!order) throw new HttpError(404, 'Ordem de producao nao encontrada.')
    const inspection = db.col('qualityInspections').find((item) => item.id === order.qualityInspectionId && item.status === 'pending')
    if (!inspection) throw new HttpError(409, 'Nao existe uma inspecao de qualidade pendente para esta ordem.')
    const decision = qualityDecision[2]
    const body = await readJson(req)
    const now = new Date().toISOString()
    if (decision === 'reject') {
      const notes = String(body.notes ?? '').trim()
      if (!notes) throw new HttpError(400, 'Informe o motivo da reprovacao.')
      const rejectedInspection = db.update('qualityInspections', inspection.id, { status: 'rejected', notes: notes.slice(0, 2000), rejectedAt: now, rejectedBy: user.id, rejectedByName: user.name, checkedAt: now, checkedBy: user.id, checkedByName: user.name })
      const updated = db.update('productionOrders', order.id, { status: 'em_producao', qualityStatus: 'rejected' })
      audit(user, 'quality_reject', 'productionOrders', updated, { inspectionId: inspection.id })
      return send(res, 200, { productionOrder: updated, inspection: rejectedInspection })
    }
    const approvedInspection = db.update('qualityInspections', inspection.id, { status: 'approved', checkedAt: now, checkedBy: user.id, checkedByName: user.name })
    const updated = db.update('productionOrders', order.id, { status: 'concluida', qualityStatus: 'approved', completedAt: order.completedAt ?? now })
    audit(user, 'quality_approve', 'productionOrders', updated, { inspectionId: inspection.id })
    return send(res, 200, { productionOrder: updated, inspection: approvedInspection })
  }

  const releaseProduction = url.match(/^\/api\/production-orders\/([^/]+)\/release$/)
  if (releaseProduction && method === 'POST') {
    requireModule(user, 'production')
    const order = db.get('productionOrders', releaseProduction[1])
    if (!order) throw new HttpError(404, 'Ordem de producao nao encontrada.')
    if (order.status === 'cancelada') throw new HttpError(409, 'Uma ordem cancelada nao pode ser liberada.')
    if (!['planejada', 'liberada'].includes(order.status)) throw new HttpError(409, 'A ordem precisa estar planejada para ser liberada.')

    const existing = db.col('inventoryReservations').filter((reservation) => reservation.productionOrderId === order.id && reservation.status === 'reserved')
    if (existing.length) {
      const current = order.status === 'liberada' ? order : db.update('productionOrders', order.id, { status: 'liberada', releasedAt: order.releasedAt ?? new Date().toISOString(), reservationIds: existing.map((reservation) => reservation.id), reservationStatus: 'reserved' })
      return send(res, 200, { productionOrder: current, reservations: existing, needs: existing })
    }

    const needs = productionMaterialNeeds(order)
    for (const need of needs) {
      if (!need.material) throw new HttpError(409, 'A ficha tecnica referencia um material que nao existe mais.')
      const available = Number(need.material.stock ?? 0) - activeReservationsFor(need.materialId, order.id)
      if (Number(need.quantity) > available) throw new HttpError(409, `Saldo disponivel insuficiente para "${need.material.name}" (disponivel para reserva: ${Math.max(available, 0)}).`)
    }

    const reservations = needs.map((need) => db.insert('inventoryReservations', {
      code: db.nextCode('RES'),
      productionOrderId: order.id,
      materialId: need.materialId,
      materialName: need.material.name,
      quantity: need.quantity,
      unit: need.material.unit,
      status: 'reserved',
      projectId: order.projectId ?? null,
      createdBy: user.id,
      createdByName: user.name,
    }))
    const updated = db.update('productionOrders', order.id, {
      status: 'liberada',
      releasedAt: order.releasedAt ?? new Date().toISOString(),
      reservationIds: reservations.map((reservation) => reservation.id),
      reservationStatus: 'reserved',
    })
    audit(user, 'release', 'productionOrders', updated, { reservationIds: reservations.map((reservation) => reservation.id) })
    return send(res, 200, { productionOrder: updated, reservations, needs })
  }

  const consumeProduction = url.match(/^\/api\/production-orders\/([^/]+)\/consume$/)
  if (consumeProduction && method === 'POST') {
    requireModule(user, 'production')
    const order = db.get('productionOrders', consumeProduction[1])
    if (!order) throw new HttpError(404, 'Ordem de producao nao encontrada.')
    if (order.materialsPosted) return send(res, 200, { productionOrder: order, reservations: db.col('inventoryReservations').filter((reservation) => reservation.productionOrderId === order.id) })
    const reservations = db.col('inventoryReservations').filter((reservation) => reservation.productionOrderId === order.id && reservation.status === 'reserved')
    if (!reservations.length) throw new HttpError(409, 'Libere a ordem antes de consumir os materiais.')
    for (const reservation of reservations) {
      const material = db.get('materials', reservation.materialId)
      if (!material || Number(reservation.quantity) > Number(material.stock ?? 0)) throw new HttpError(409, `Saldo insuficiente para consumir "${reservation.materialName}".`)
    }
    const consumedAt = new Date().toISOString()
    for (const reservation of reservations) {
      applyMovement(user, { materialId: reservation.materialId, type: 'exit', quantity: reservation.quantity, reason: `Consumo da ${order.code}`, productionOrderId: order.id, projectId: order.projectId })
      db.update('inventoryReservations', reservation.id, { status: 'consumed', consumedAt, consumedBy: user.id, consumedByName: user.name })
    }
    const updated = db.update('productionOrders', order.id, { materialsPosted: true, reservationStatus: 'consumed' })
    audit(user, 'consume', 'productionOrders', updated, { reservationIds: reservations.map((reservation) => reservation.id) })
    return send(res, 200, { productionOrder: updated, reservations: db.col('inventoryReservations').filter((reservation) => reservation.productionOrderId === order.id) })
  }

  const purchaseProduction = url.match(/^\/api\/production-orders\/([^/]+)\/purchase$/)
  if (purchaseProduction && method === 'POST') {
    requireModule(user, 'production')
    requireModule(user, 'purchases')
    const order = db.get('productionOrders', purchaseProduction[1])
    if (!order) throw new HttpError(404, 'Ordem de producao nao encontrada.')
    const existingPurchase = db.col('purchases').find((purchase) => purchase.productionOrderId === order.id && !['cancelado', 'recebido'].includes(purchase.status))
    if (existingPurchase) return send(res, 200, { purchase: existingPurchase, existing: true, shortages: existingPurchase.items ?? [] })

    const needs = productionMaterialNeeds(order)
    const shortages = []
    for (const need of needs) {
      if (!need.material) throw new HttpError(409, 'A ficha tecnica referencia um material que nao existe mais.')
      const available = Number(need.material.stock ?? 0) - activeReservationsFor(need.materialId, order.id)
      const quantity = round2(Math.max(Number(need.quantity) - available, 0))
      if (quantity > 0) shortages.push({ materialId: need.materialId, description: need.material.name, unit: need.material.unit, quantity, unitCost: Number(need.material.cost ?? 0), received: 0 })
    }
    if (!shortages.length) throw new HttpError(409, 'Nao ha materiais em falta para esta ordem.')
    const body = await readJson(req)
    const purchase = db.insert('purchases', {
      code: db.nextCode('PC'),
      status: 'rascunho',
      supplierId: body.supplierId ?? null,
      projectId: order.projectId ?? null,
      productionOrderId: order.id,
      items: shortages,
      notes: String(body.notes ?? `Gerado a partir da ${order.code} — materiais em falta.`).slice(0, 500),
      createdBy: user.id,
      createdByName: user.name,
    })
    audit(user, 'create_from_production', 'purchases', purchase, { productionOrderId: order.id, items: shortages.length })
    return send(res, 201, { purchase, existing: false, shortages })
  }

  // ---- estoque -----------------------------------------------------------
  if (url === '/api/inventory/movement' && method === 'POST') {
    requireModule(user, 'inventory')
    const body = await readJson(req)
    const movement = applyMovement(user, body)
    return send(res, 200, movement)
  }

  // ---- compras: recebimento ---------------------------------------------
  const receive = url.match(/^\/api\/purchases\/([^/]+)\/receive$/)
  if (receive && method === 'POST') {
    requireModule(user, 'purchases')
    const order = db.get('purchases', receive[1])
    if (!order) throw new HttpError(404, 'Pedido de compra não encontrado.')
    const body = await readJson(req)
    const lines = Array.isArray(body.lines) ? body.lines : []
    const items = order.items.map((it) => ({ ...it }))
    for (const line of lines) {
      const it = items[line.index]
      const qty = Number(line.quantity)
      if (!it || !(qty > 0)) continue
      const remaining = Math.max(Number(it.quantity) - Number(it.received ?? 0), 0)
      const accepted = Math.min(qty, remaining > 0 ? remaining : qty)
      it.received = round2(Number(it.received ?? 0) + accepted)
      if (it.materialId) {
        applyMovement(user, {
          materialId: it.materialId,
          type: 'entry',
          quantity: accepted,
          reason: `Recebimento do pedido ${order.code}`,
          purchaseId: order.id,
          unitCost: Number(it.unitCost) || undefined,
        })
      }
    }
    const allDone = items.every((it) => Number(it.received ?? 0) >= Number(it.quantity))
    const anyDone = items.some((it) => Number(it.received ?? 0) > 0)
    const status = allDone ? 'recebido' : anyDone ? 'parcial' : order.status
    const patch = { items, status }
    if (allDone) patch.receivedAt = new Date().toISOString()
    if (body.invoiceNumber) patch.invoiceNumber = String(body.invoiceNumber)
    const updated = db.update('purchases', order.id, patch)
    audit(user, 'receive', 'purchases', updated)
    let autoReservation = null
    const production = order.productionOrderId ? db.get('productionOrders', order.productionOrderId) : null
    if (allDone && production?.status === 'planejada') {
      try {
        const reserved = reserveProductionMaterials(production, user)
        if (reserved.created && reserved.reservations.length) {
          const updatedProduction = db.update('productionOrders', production.id, {
            reservationIds: reserved.reservations.map((reservation) => reservation.id),
            reservationStatus: 'reserved',
            materialsAvailableAt: new Date().toISOString(),
          })
          audit(user, 'auto_reserve', 'productionOrders', updatedProduction, { purchaseId: order.id, reservationIds: reserved.reservations.map((reservation) => reservation.id) })
          autoReservation = { created: true, productionOrderId: production.id, reservationIds: reserved.reservations.map((reservation) => reservation.id) }
        } else {
          autoReservation = { created: false, productionOrderId: production.id, reservationIds: reserved.reservations.map((reservation) => reservation.id) }
        }
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error
        autoReservation = { created: false, productionOrderId: production.id, reason: error.message }
      }
    }
    return send(res, 200, autoReservation ? { ...updated, autoReservation } : updated)
  }

  // ---- notificações ------------------------------------------------------
  if (url === '/api/notifications' && method === 'GET') {
    const mine = db
      .col('notifications')
      .filter((n) => n.userId === user.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return send(res, 200, { items: mine.slice(0, 100), unread: mine.filter((n) => !n.readAt).length })
  }
  if (url === '/api/notifications/read' && method === 'POST') {
    const body = await readJson(req)
    const ids = new Set(Array.isArray(body.ids) ? body.ids : [])
    const now = new Date().toISOString()
    let changed = 0
    for (const n of db.col('notifications')) {
      if (n.userId !== user.id || n.readAt) continue
      if (body.all || ids.has(n.id)) {
        db.update('notifications', n.id, { readAt: now })
        changed += 1
      }
    }
    return send(res, 200, { changed })
  }
  if (url === '/api/admin/scheduler/run' && method === 'POST') {
    if (user.role !== 'admin' || user.companyId) throw new HttpError(403, 'Somente a administração da plataforma.')
    const body = await readJson(req)
    return send(res, 200, await runSchedulerOnce(body.now ? new Date(body.now) : new Date()))
  }

  // ---- compras: aprovação -------------------------------------------------
  const decision = url.match(/^\/api\/purchases\/([^/]+)\/decision$/)
  if (decision && method === 'POST') {
    requireModule(user, 'purchases')
    if (!canDecidePurchase(user)) throw new HttpError(403, 'Somente administração, gerência e financeiro aprovam ou reprovam compras.')
    const order = db.get('purchases', decision[1])
    if (!order) throw new HttpError(404, 'Pedido de compra não encontrado.')
    const body = await readJson(req)
    if (!['rascunho', 'solicitado', 'cotacao', 'reprovado', 'aprovado'].includes(order.status))
      throw new HttpError(400, 'Este pedido já avançou e não pode mais ser aprovado ou reprovado.')
    const now = new Date().toISOString()
    let patch
    if (body.decision === 'aprovar') patch = { status: 'aprovado', decidedBy: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: undefined }
    else if (body.decision === 'reprovar') {
      const reason = String(body.reason ?? '').trim().slice(0, 500)
      if (!reason) throw new HttpError(400, 'Informe o motivo da reprovação.')
      patch = { status: 'reprovado', decidedBy: user.id, decidedByName: user.name, decidedAt: now, rejectedReason: reason }
    } else if (body.decision === 'reabrir') patch = { status: 'rascunho', decidedBy: undefined, decidedByName: undefined, decidedAt: undefined, rejectedReason: undefined }
    else throw new HttpError(400, 'Decisão inválida.')
    const updated = db.update('purchases', order.id, patch)
    audit(user, body.decision === 'aprovar' ? 'approve' : body.decision === 'reprovar' ? 'reject' : 'reopen', 'purchases', updated)
    return send(res, 200, updated)
  }

  // ---- mapas: endereço, rota e rastreamento da equipe em campo --------------
  if (url === '/api/geo/geocode' && method === 'GET') {
    rateLimit(`geo:${user.id}`, LIMITS.geo, 60_000)
    const found = await geo.geocode(query.q)
    return send(res, 200, { found: Boolean(found), ...(found ?? {}) })
  }
  if (url === '/api/geo/reverse' && method === 'GET') {
    rateLimit(`geo:${user.id}`, LIMITS.geo, 60_000)
    const found = await geo.reverse(Number(query.lat), Number(query.lng))
    return send(res, 200, { label: found?.label ?? null })
  }
  if (url === '/api/geo/route' && method === 'GET') {
    rateLimit(`geo:${user.id}`, LIMITS.geo, 60_000)
    const result = await geo.route({ lat: Number(query.fromLat), lng: Number(query.fromLng) }, { lat: Number(query.toLat), lng: Number(query.toLng) })
    return send(res, 200, { found: Boolean(result), ...(result ?? {}) })
  }
  const geoInstall = url.match(/^\/api\/installations\/([^/]+)\/(track|destination)$/)
  if (geoInstall && method === 'POST') {
    requireModule(user, 'logistics')
    const job = db.get('installations', geoInstall[1])
    if (!job) throw new HttpError(404, 'Agendamento não encontrado.')
    const body = await readJson(req)

    if (geoInstall[2] === 'destination') {
      // endereço do agendamento (ou do projeto) → coordenadas do destino
      const project = job.projectId ? db.get('projects', job.projectId) : null
      const text = String(body.address ?? job.address ?? project?.address ?? '').trim()
      if (text.length < 4) throw new HttpError(400, 'Informe o endereço do agendamento ou do projeto.')
      rateLimit(`geo:${user.id}`, LIMITS.geo, 60_000)
      const found = await geo.geocode(text)
      if (!found) throw new HttpError(404, 'Não encontrei esse endereço no mapa. Inclua rua, número e cidade.')
      const updated = db.update('installations', job.id, { destLat: found.lat, destLng: found.lng, destLabel: found.label })
      return send(res, 200, updated)
    }

    // rastreamento: só quem está na equipe do agendamento (ou gestão) envia a própria posição
    const isTeam = (job.teamIds ?? []).includes(user.id)
    if (!isTeam && !isManagerRole(user.role)) throw new HttpError(403, 'Somente a equipe deste agendamento envia a localização.')
    rateLimit(`track:${user.id}`, LIMITS.track, 60_000)
    const lat = Number(body.lat)
    const lng = Number(body.lng)
    if (!isLat(lat) || !isLng(lng)) throw new HttpError(400, 'Coordenadas inválidas.')
    const accuracy = Number(body.accuracy)
    const at = new Date().toISOString()
    const point = { lat: Math.round(lat * 1e5) / 1e5, lng: Math.round(lng * 1e5) / 1e5, at }
    const trail = Array.isArray(job.track) ? job.track : []
    const last = trail.at(-1)
    // descarta pontos redundantes (parado) e limita o rastro
    const keep = !last || distanceMeters(last, point) >= 15 || Date.parse(at) - Date.parse(last.at) > 120_000
    const nextTrail = keep ? [...trail, point].slice(-400) : trail
    const updated = db.update('installations', job.id, {
      track: nextTrail,
      lastLocation: { ...point, accuracy: Number.isFinite(accuracy) ? Math.round(accuracy) : undefined, userId: user.id, userName: user.name },
    })
    return send(res, 200, { ok: true, lastLocation: updated.lastLocation, points: nextTrail.length })
  }

  // ---- plano de corte: orçamento e solicitação de compras -------------------
  // ---- nota fiscal (NF-e de produto por provedor fiscal) ------------------------------
  if (url.startsWith('/api/fiscal/')) {
    requireModule(user, 'financial')
    const settings = () => db.get('settings', 'company') ?? {}
    const environmentOf = () => (settings().fiscalEnvironment === 'producao' ? 'producao' : 'homologacao')
    const secretRow = () => db.col('fiscalSecrets').find((row) => row.kind === 'focus')
    // token da própria empresa (cifrado) ou, se a plataforma liberou, o token da plataforma (variável do servidor)
    const platformToken = (environment) => String((environment === 'producao' ? process.env.FOCUS_TOKEN_PRODUCAO : process.env.FOCUS_TOKEN_HOMOLOGACAO) ?? '').trim() || null
    const platformAllowed = () => !user.companyId || Boolean(company?.fiscalPlatform)
    const ownToken = (environment) => {
      const blob = secretRow()?.[environment]
      return blob ? fiscalSecrets.open(blob) : null
    }
    const tokenFor = (environment) => ownToken(environment) ?? (platformAllowed() ? platformToken(environment) : null)
    const tokenSource = (environment) => (ownToken(environment) ? 'empresa' : platformAllowed() && platformToken(environment) ? 'plataforma' : null)
    const sameCnpjElsewhere = (cnpj) =>
      Boolean(cnpj) &&
      db.all('settings').some((s) => String(s.id).split(':').pop() === 'company' && (s.companyId ?? null) !== (user.companyId ?? null) && String(s.cnpj ?? '').replace(/\D/g, '') === cnpj)
    const invoiceById = (id) => {
      const invoice = db.get('invoices', id)
      if (!invoice) throw new HttpError(404, 'Nota fiscal não encontrada.')
      return invoice
    }
    const cleanDraft = (body, base = {}) => {
      const pick = (v, max) => String(v ?? '').trim().slice(0, max)
      const r = body.recipient ?? base.recipient ?? {}
      const items = Array.isArray(body.items) ? body.items : base.items ?? []
      if (items.length > 200) throw new HttpError(400, 'A nota aceita até 200 itens.')
      const draft = {
        sourceType: body.sourceType === 'projeto' ? 'projeto' : body.sourceType === 'orcamento' ? 'orcamento' : base.sourceType ?? 'orcamento',
        budgetId: body.budgetId ?? base.budgetId,
        projectId: body.projectId ?? base.projectId,
        clientId: body.clientId ?? base.clientId,
        natureOfOperation: pick(body.natureOfOperation ?? base.natureOfOperation ?? 'Venda de mercadoria', 60),
        recipient: {
          name: pick(r.name, 60), document: pick(r.document, 20), ie: pick(r.ie, 20), zip: pick(r.zip, 12), address: pick(r.address, 60),
          number: pick(r.number, 20), district: pick(r.district, 60), city: pick(r.city, 60), state: pick(r.state, 2).toUpperCase(),
          phone: pick(r.phone, 20), email: pick(r.email, 80),
        },
        items: items.map((i, index) => ({
          id: pick(i.id, 40) || String(index + 1),
          code: pick(i.code, 60), description: pick(i.description, 120), ncm: pick(i.ncm, 12), cfop: pick(i.cfop, 6),
          unit: pick(i.unit || 'UN', 6).toUpperCase(), quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0,
          origin: pick(i.origin ?? '0', 1), taxSituation: pick(i.taxSituation, 4), service: Boolean(i.service),
        })),
        freight: Number(body.freight ?? base.freight) || 0,
        discount: Number(body.discount ?? base.discount) || 0,
        installments: Array.isArray(body.installments)
          ? body.installments.slice(0, 24).map((p, i) => ({ number: pick(p.number ?? String(i + 1).padStart(3, '0'), 10), dueDate: pick(p.dueDate, 10), amount: Number(p.amount) || 0 }))
          : base.installments ?? [],
        notes: pick(body.notes ?? base.notes, 2000),
      }
      const t = totalsOf(draft)
      draft.items = t.items
      draft.freight = t.freight
      draft.discount = t.discount
      draft.total = t.total
      return draft
    }

    if (url === '/api/fiscal/status' && method === 'GET') {
      const row = secretRow()
      return send(res, 200, {
        provider: 'focusnfe',
        environment: environmentOf(),
        tokens: { homologacao: Boolean(tokenFor('homologacao')), producao: Boolean(tokenFor('producao')) },
        sources: { homologacao: tokenSource('homologacao'), producao: tokenSource('producao') },
        own: { homologacao: Boolean(row?.homologacao), producao: Boolean(row?.producao) },
        platform: { available: Boolean(platformToken('homologacao') || platformToken('producao')), allowed: platformAllowed() },
        problems: companyProblems(settings()),
      })
    }
    if (url === '/api/fiscal/token' && method === 'PUT') {
      if (!isManagerRole(user.role)) throw new HttpError(403, 'Somente o administrador ou gerente configura o provedor fiscal.')
      const body = await readJson(req)
      const environment = body.environment === 'producao' ? 'producao' : 'homologacao'
      const token = String(body.token ?? '').trim()
      if (token && (token.length < 10 || token.length > 200 || /\s/.test(token))) throw new HttpError(400, 'Token inválido. Copie o token inteiro, sem espaços, no painel da Focus NFe.')
      const row = secretRow()
      const value = token ? fiscalSecrets.seal(token) : null
      if (row) db.update('fiscalSecrets', row.id, { [environment]: value })
      else db.insert('fiscalSecrets', { kind: 'focus', [environment]: value })
      audit(user, token ? 'fiscal_token_set' : 'fiscal_token_clear', 'settings', { id: 'fiscal' }, { environment })
      return send(res, 200, { environment, set: Boolean(token) })
    }

    if (url === '/api/fiscal/invoices' && method === 'POST') {
      const body = await readJson(req)
      const draft = cleanDraft(body)
      const invoice = db.insert('invoices', { ...draft, code: db.nextCode('NF'), status: 'rascunho', environment: environmentOf(), createdByName: user.name })
      audit(user, 'invoice_create', 'invoices', invoice)
      return send(res, 201, invoice)
    }

    const invoiceMatch = url.match(/^\/api\/fiscal\/invoices\/([^/]+)(?:\/(emit|refresh|cancel))?$/)
    if (invoiceMatch) {
      const invoice = invoiceById(invoiceMatch[1])
      const action = invoiceMatch[2]
      const editable = invoice.status === 'rascunho' || invoice.status === 'rejeitada'

      if (!action && method === 'PUT') {
        if (!editable) throw new HttpError(409, 'Esta nota já foi enviada e não pode mais ser editada.')
        const draft = cleanDraft(await readJson(req), invoice)
        return send(res, 200, db.update('invoices', invoice.id, draft))
      }
      if (!action && method === 'DELETE') {
        if (invoice.status !== 'rascunho') throw new HttpError(409, 'Só rascunhos podem ser excluídos. Notas enviadas são canceladas.')
        db.remove('invoices', invoice.id)
        audit(user, 'invoice_delete', 'invoices', invoice)
        return send(res, 200, { ok: true })
      }
      if (!action && method === 'GET') return send(res, 200, invoice)

      if (action === 'emit' && method === 'POST') {
        if (!editable) throw new HttpError(409, invoice.status === 'autorizada' ? 'Esta nota já foi autorizada.' : 'Esta nota já está em processamento.')
        const company = settings()
        const problems = [...companyProblems(company), ...invoiceProblems(invoice, company)]
        if (problems.length) throw new HttpError(400, `Faltam dados para emitir: ${problems.join(' ')}`)
        const environment = invoice.environment === 'producao' ? 'producao' : 'homologacao'
        if (environment === 'producao' && environmentOf() !== 'producao') throw new HttpError(409, 'O ambiente da empresa mudou para homologação. Crie a nota de novo.')
        const token = tokenFor(environment)
        if (!token) {
          const hasPlatform = platformToken(environment) && !platformAllowed()
          throw new HttpError(
            400,
            hasPlatform
              ? 'A emissão de nota fiscal ainda não foi liberada para a sua empresa. Fale com o suporte do Core Cut para ativar.'
              : `Informe o token da Focus NFe (${environment === 'producao' ? 'produção' : 'homologação'}) em Configurações → Empresa → Nota fiscal.`,
          )
        }
        // com o token da plataforma, um CNPJ só pode ser usado por uma empresa (evita emitir em nome de outra)
        if (tokenSource(environment) === 'plataforma' && sameCnpjElsewhere(String(company.cnpj ?? '').replace(/\D/g, ''))) {
          throw new HttpError(409, 'Este CNPJ já está cadastrado em outra empresa do sistema. Fale com o suporte.')
        }
        rateLimit(`fiscal-emit:${user.id}`, 60, 3_600_000)
        const ref = invoice.ref ?? `cc-${invoice.id.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`
        let result
        try {
          result = await focus.emit({ token, environment, ref, payload: buildFocusPayload({ invoice, company }) })
        } catch (error) {
          console.error('[fiscal] falha ao falar com o provedor:', error?.message ?? error)
          throw new HttpError(502, 'Não foi possível falar com o provedor fiscal agora. Tente novamente em instantes.')
        }
        if (result.httpStatus >= 500) throw new HttpError(502, 'O provedor fiscal está indisponível. Tente novamente em instantes.')
        if (result.httpStatus === 401 || result.httpStatus === 403) throw new HttpError(400, 'O provedor recusou o token. Confira o token e o ambiente (homologação ou produção).')
        const mapped = mapFocusResponse(result.json, result.base)
        const rejected = result.httpStatus >= 400
        const updated = db.update('invoices', invoice.id, {
          ref,
          status: rejected ? 'rejeitada' : mapped.status === 'rascunho' ? 'processando' : mapped.status,
          message: mapped.message ?? (rejected ? 'O provedor recusou a nota.' : undefined),
          issuedAt: new Date().toISOString(),
          ...(mapped.number ? { number: mapped.number } : {}),
          ...(mapped.serie ? { serie: mapped.serie } : {}),
          ...(mapped.accessKey ? { accessKey: mapped.accessKey } : {}),
          ...(mapped.protocol ? { protocol: mapped.protocol } : {}),
          ...(mapped.xmlUrl ? { xmlUrl: mapped.xmlUrl } : {}),
          ...(mapped.danfeUrl ? { danfeUrl: mapped.danfeUrl } : {}),
          ...(mapped.status === 'autorizada' ? { authorizedAt: new Date().toISOString() } : {}),
        })
        audit(user, 'invoice_emit', 'invoices', updated, { environment, status: updated.status })
        return send(res, rejected ? 422 : 200, rejected ? { error: updated.message, invoice: updated } : updated)
      }

      if (action === 'refresh' && method === 'POST') {
        if (!invoice.ref) throw new HttpError(409, 'Esta nota ainda não foi enviada ao provedor.')
        const environment = invoice.environment === 'producao' ? 'producao' : 'homologacao'
        const token = tokenFor(environment)
        if (!token) throw new HttpError(400, 'Token do provedor não configurado.')
        let result
        try {
          result = await focus.consult({ token, environment, ref: invoice.ref })
        } catch {
          throw new HttpError(502, 'Não foi possível consultar o provedor agora.')
        }
        if (result.httpStatus >= 500) throw new HttpError(502, 'O provedor fiscal está indisponível.')
        const mapped = mapFocusResponse(result.json, result.base)
        if (result.httpStatus === 404) return send(res, 200, invoice)
        const updated = db.update('invoices', invoice.id, {
          status: mapped.status === 'rascunho' ? invoice.status : mapped.status,
          message: mapped.message ?? (mapped.status === 'autorizada' ? null : invoice.message),
          ...(mapped.number ? { number: mapped.number } : {}),
          ...(mapped.serie ? { serie: mapped.serie } : {}),
          ...(mapped.accessKey ? { accessKey: mapped.accessKey } : {}),
          ...(mapped.protocol ? { protocol: mapped.protocol } : {}),
          ...(mapped.xmlUrl ? { xmlUrl: mapped.xmlUrl } : {}),
          ...(mapped.danfeUrl ? { danfeUrl: mapped.danfeUrl } : {}),
          ...(mapped.status === 'autorizada' && !invoice.authorizedAt ? { authorizedAt: new Date().toISOString() } : {}),
        })
        return send(res, 200, updated)
      }

      if (action === 'cancel' && method === 'POST') {
        if (invoice.status !== 'autorizada') throw new HttpError(409, 'Só uma nota autorizada pode ser cancelada.')
        const body = await readJson(req)
        const reason = String(body.reason ?? '').trim()
        if (reason.length < 15 || reason.length > 255) throw new HttpError(400, 'Informe a justificativa do cancelamento (15 a 255 caracteres).')
        const environment = invoice.environment === 'producao' ? 'producao' : 'homologacao'
        const token = tokenFor(environment)
        if (!token) throw new HttpError(400, 'Token do provedor não configurado.')
        let result
        try {
          result = await focus.cancel({ token, environment, ref: invoice.ref, reason })
        } catch {
          throw new HttpError(502, 'Não foi possível falar com o provedor agora.')
        }
        const mapped = mapFocusResponse(result.json, result.base)
        if (result.httpStatus >= 400 || mapped.status !== 'cancelada') {
          throw new HttpError(422, mapped.message ?? 'O provedor não aceitou o cancelamento (confira o prazo permitido pela SEFAZ).')
        }
        const updated = db.update('invoices', invoice.id, { status: 'cancelada', cancelReason: reason, cancelledAt: new Date().toISOString() })
        audit(user, 'invoice_cancel', 'invoices', updated, { reason })
        return send(res, 200, updated)
      }
    }
    throw new HttpError(404, 'Rota não encontrada.')
  }

  // ---- portal e avisos ao cliente ----------------------------------------
  const projectAction = url.match(/^\/api\/projects\/([^/]+)\/(portal|notify-client)$/)
  if (projectAction) {
    requireModule(user, 'projects')
    const project = db.get('projects', projectAction[1])
    if (!project) throw new HttpError(404, 'Projeto não encontrado.')
    const origin = (() => {
      try {
        return publicOrigin(req)
      } catch {
        return appUrl()
      }
    })()
    const portalUrl = (token) => `${origin}/acompanhar/${token}`
    if (projectAction[2] === 'portal') {
      if (method === 'DELETE') {
        db.update('projects', project.id, { portalEnabled: false })
        audit(user, 'portal_revoke', 'projects', project)
        return send(res, 200, { enabled: false })
      }
      if (method !== 'POST') throw new HttpError(405, 'Método não permitido.')
      const body = await readJson(req)
      // gera o link na primeira vez; "regenerar" troca o código e invalida o link anterior
      const regenerate = Boolean(body.regenerate) && Boolean(project.portalToken)
      const token = !project.portalToken || regenerate ? newPortalToken() : project.portalToken
      db.update('projects', project.id, { portalToken: token, portalEnabled: true })
      audit(user, regenerate ? 'portal_regenerate' : 'portal_enable', 'projects', project)
      return send(res, 200, { enabled: true, token, url: portalUrl(token) })
    }
    // notify-client
    if (method !== 'POST') throw new HttpError(405, 'Método não permitido.')
    rateLimit(`notify:${user.id}`, 30, 3_600_000)
    const body = await readJson(req)
    const message = String(body.message ?? '').trim().slice(0, 2000)
    if (message.length < 3) throw new HttpError(400, 'Escreva a mensagem para o cliente.')
    const client = project.clientId ? db.get('clients', project.clientId) : null
    if (!client?.email) throw new HttpError(400, 'O cliente deste projeto não tem e-mail cadastrado.')
    const settings = db.get('settings', 'company') ?? {}
    const link = project.portalToken && project.portalEnabled !== false ? portalUrl(project.portalToken) : null
    const result = await mailer.sendMail({
      to: client.email,
      replyTo: settings.email || undefined,
      ...emails.clientUpdate({ clientName: client.name, companyName: settings.name, projectName: project.name, message, url: link }),
    })
    if (!result.ok) {
      throw new HttpError(503, result.reason === 'smtp-desligado' ? 'O envio de e-mail ainda não foi configurado neste servidor (SMTP). Use o WhatsApp ou peça ao administrador para configurar.' : 'Não foi possível enviar o e-mail agora. Tente de novo em instantes.')
    }
    audit(user, 'client_notified', 'projects', project, { channel: 'email', to: client.email })
    return send(res, 200, { ok: true, to: client.email })
  }

  const planAction = url.match(/^\/api\/cut-plans\/([^/]+)\/(sync-budget|purchase-request)$/)
  if (planAction && method === 'POST') {
    const mods = userModules(user)
    if (!mods.includes('cutplan') && !mods.includes('production')) throw new HttpError(403, 'Sem permissão para o módulo "Plano de corte".')
    const plan = db.get('cutPlans', planAction[1])
    if (!plan) throw new HttpError(404, 'Plano de corte não encontrado.')
    let flow
    try {
      flow = await import('../src/domain/planFlow.ts')
    } catch {
      throw new HttpError(500, 'Este recurso exige Node.js 22.18 ou superior.')
    }
    const materials = new Map(db.col('materials').map((m) => [m.id, m]))

    if (planAction[2] === 'sync-budget') {
      if (!plan.projectId) throw new HttpError(400, 'Vincule o plano a um projeto para somar ao orçamento.')
      if (!plan.groups?.length) throw new HttpError(400, 'Calcule e salve o plano antes de somar ao orçamento.')
      const project = db.get('projects', plan.projectId)
      if (!project) throw new HttpError(404, 'Projeto do plano não encontrado.')
      const items = flow.budgetItemsFromPlan(plan, materials, () => randomUUID())
      const budgets = db.col('budgets').filter((b) => b.projectId === plan.projectId && !['recusado', 'expirado'].includes(b.status))
      const pool = budgets.some((b) => b.status !== 'aprovado') ? budgets.filter((b) => b.status !== 'aprovado') : budgets
      let budget = [...pool].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0]
      let created = false
      if (!budget) {
        budget = db.insert('budgets', {
          code: db.nextCode('ORC'),
          title: `Orçamento — ${project.name}`,
          clientId: project.clientId,
          projectId: project.id,
          status: 'rascunho',
          items,
          marginPercent: 30,
          createdBy: user.id,
          createdByName: user.name,
        })
        created = true
      } else {
        const kept = (budget.items ?? []).filter((it) => it.cutPlanId !== plan.id)
        budget = db.update('budgets', budget.id, { items: [...kept, ...items] })
      }
      audit(user, 'budget_sync', 'budgets', budget, { changes: [`plano ${plan.code ?? plan.id}: ${items.length} itens`] })
      return send(res, 200, { budget, created, items: items.length, cost: round2(items.reduce((s, i) => s + i.quantity * i.unitCost, 0)) })
    }

    // solicitação de compras
    const body = await readJson(req)
    const lines = Array.isArray(body.items) ? body.items : []
    const valid = lines
      .map((l) => ({
        materialId: l.materialId ? String(l.materialId) : undefined,
        description: String(l.description ?? '').slice(0, 200),
        unit: l.unit ? String(l.unit).slice(0, 12) : undefined,
        quantity: round2(l.quantity),
        unitCost: round2(l.unitCost),
        supplierId: l.supplierId ? String(l.supplierId) : undefined,
      }))
      .filter((l) => l.description && l.quantity > 0)
    if (!valid.length) throw new HttpError(400, 'Selecione ao menos um item com quantidade.')
    const bySupplier = new Map()
    for (const l of valid) {
      const supplierId = l.supplierId ?? (l.materialId ? materials.get(l.materialId)?.supplierId : undefined) ?? ''
      if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, [])
      bySupplier.get(supplierId).push({ materialId: l.materialId, description: l.description, unit: l.unit, quantity: l.quantity, unitCost: l.unitCost })
    }
    const createdOrders = []
    for (const [supplierId, items] of bySupplier) {
      const doc = db.insert('purchases', {
        code: db.nextCode('PC'),
        supplierId: supplierId || undefined,
        projectId: plan.projectId,
        productionOrderId: plan.productionOrderId,
        cutPlanId: plan.id,
        status: 'solicitado',
        items,
        requestedBy: user.id,
        notes: `Solicitação gerada do plano de corte ${plan.code ?? ''} — ${plan.title ?? ''}${body.notes ? `\n${String(body.notes).slice(0, 500)}` : ''}`.trim(),
        createdBy: user.id,
        createdByName: user.name,
      })
      createdOrders.push(doc)
      audit(user, 'create', 'purchases', doc)
    }
    // quanto sobra do orçamento do projeto depois desta compra
    let balance = null
    if (plan.projectId) {
      const request = valid.reduce((s, l) => s + l.quantity * l.unitCost, 0)
      balance = flow.projectPurchaseBalance({
        projectId: plan.projectId,
        budgets: db.col('budgets'),
        purchases: db.col('purchases'),
        excludePurchaseIds: createdOrders.map((o) => o.id),
        request,
      })
    }
    return send(res, 201, { purchases: createdOrders, balance })
  }

  // ---- arquivos ----------------------------------------------------------
  if (url === '/api/files/upload' && method === 'POST') {
    const name = String(query.name ?? 'arquivo').slice(0, 180)
    const buf = await readBody(req, MAX_FILE)
    if (buf.length === 0) throw new HttpError(400, 'Arquivo vazio.')
    const id = randomUUID()
    writeFileSync(join(filesDir, id), buf)
    const meta = db.insert('files', {
      id,
      name,
      size: buf.length,
      mime: String(req.headers['content-type'] ?? 'application/octet-stream').split(';')[0],
      folder: String(query.folder ?? 'Geral'),
      projectId: query.projectId || null,
      clientId: query.clientId || null,
      refType: query.refType || null,
      refId: query.refId || null,
      visibility: ['interno', 'compartilhado', 'financeiro'].includes(query.visibility) ? query.visibility : 'interno',
      uploadedBy: user.id,
      uploadedByName: user.name,
    })
    audit(user, 'upload', 'files', meta)
    return send(res, 201, meta)
  }
  const download = url.match(/^\/api\/files\/([^/]+)\/download$/)
  if (download && method === 'GET') {
    const meta = db.get('files', download[1])
    if (!meta) throw new HttpError(404, 'Arquivo não encontrado.')
    if (meta.visibility === 'financeiro' && !userModules(user).includes('financial')) throw new HttpError(403, 'Arquivo restrito ao financeiro.')
    const path = join(filesDir, meta.id)
    if (!existsSync(path)) throw new HttpError(404, 'Conteúdo do arquivo ausente.')
    // Só tipos sem risco de script são exibidos no navegador; o restante é sempre baixado.
    const INLINE_SAFE = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf']
    const disposition = query.inline === '1' && INLINE_SAFE.includes(meta.mime) ? 'inline' : 'attachment'
    res.writeHead(200, {
      'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      'Content-Type': meta.mime || 'application/octet-stream',
      'Content-Length': statSync(path).size,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    })
    return createReadStream(path).pipe(res)
  }

  // ---- administração -----------------------------------------------------
  if (url === '/api/admin/backup' && method === 'GET') {
    requireModule(user, 'settings')
    const snapshot = user.companyId ? db.tenantSnapshot(user.companyId) : db.snapshot()
    audit(user, 'backup', 'system', { id: null, name: 'Backup completo' })
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="arcoplan-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    })
    return res.end(JSON.stringify(snapshot))
  }
  if (url === '/api/admin/restore' && method === 'POST') {
    if (user.role !== 'admin') throw new HttpError(403, 'Somente administradores restauram backups.')
    if (user.companyId) throw new HttpError(403, 'A restauração de backup é feita pela administração da plataforma. Entre em contato com o suporte.')
    const snapshot = await readJson(req)
    if (!snapshot?.collections || !snapshot.collections.users?.length) throw new HttpError(400, 'Arquivo de backup inválido.')
    db.replaceAll(snapshot)
    audit(user, 'restore', 'system', { id: null, name: 'Backup restaurado' })
    return send(res, 200, { ok: true })
  }
  if (url === '/api/admin/demo' && method === 'POST') {
    if (user.role !== 'admin') throw new HttpError(403, 'Somente administradores carregam dados de demonstração.')
    if (user.companyId) throw new HttpError(403, 'Dados de demonstração não estão disponíveis para empresas assinantes.')
    const { loadDemo } = await import('./lib/demo.mjs')
    const counts = await loadDemo(db, { catalog, ensureLeoSupplier, materialFromCatalog, filesDir })
    audit(user, 'demo_load', 'system', { id: null, name: 'Dados de demonstração' })
    return send(res, 200, { ok: true, counts })
  }
  if (url === '/api/admin/demo' && method === 'DELETE') {
    if (user.role !== 'admin') throw new HttpError(403, 'Somente administradores removem dados de demonstração.')
    if (user.companyId) throw new HttpError(403, 'Dados de demonstração não estão disponíveis para empresas assinantes.')
    const removed = {}
    for (const name of Object.keys(db.state.collections)) {
      if (name === 'users' || name === 'settings' || name === 'auditLogs') continue
      const gone = db.removeWhere(name, (d) => d.demo === true)
      if (gone.length) removed[name] = gone.length
    }
    db.removeWhere('users', (d) => d.demo === true)
    audit(user, 'demo_clear', 'system', { id: null, name: 'Dados de demonstração removidos' })
    return send(res, 200, { ok: true, removed })
  }
  const restore = url.match(/^\/api\/trash\/([^/]+)\/restore$/)
  if (restore && method === 'POST') {
    requireModule(user, 'settings')
    const entry = db.get('trash', restore[1])
    if (!entry) throw new HttpError(404, 'Item não encontrado na lixeira.')
    if (!COLLECTIONS[entry.collection]) throw new HttpError(400, 'Coleção inválida na lixeira.')
    assertCapacity(entry.collection, user.companyId)
    db.restore(entry.collection, entry.doc)
    for (const [name, docs] of Object.entries(entry.cascade ?? {})) if (COLLECTIONS[name]) for (const doc of docs) db.restore(name, doc)
    db.remove('trash', entry.id)
    audit(user, 'restore_item', entry.collection, entry.doc)
    return send(res, 200, entry.doc)
  }
  if (url.match(/^\/api\/trash\/[^/]+$/) && method === 'DELETE') {
    requireModule(user, 'settings')
    db.remove('trash', url.split('/').pop())
    return send(res, 200, { ok: true })
  }

  // ---- CRUD genérico -----------------------------------------------------
  const crud = url.match(/^\/api\/data\/([A-Za-z]+)(?:\/([^/]+))?$/)
  if (crud) return handleCrud(req, res, crud[1], crud[2], query, user)

  throw new HttpError(404, 'Rota não encontrada.')
}

function ensureLeoSupplier() {
  let supplier = db.col('suppliers').find((s) => s.name === 'Leo Madeiras')
  if (!supplier) {
    supplier = db.insert('suppliers', {
      code: db.nextCode('FOR'),
      name: 'Leo Madeiras',
      category: 'chapas',
      contact: '',
      phone: '',
      email: '',
      website: 'https://www.leomadeiras.com.br',
      address: '',
      paymentTerms: '',
      leadTimeDays: 3,
      rating: 4,
      status: 'ativo',
      notes: 'Fornecedor principal de chapas, ferragens e fitas de borda. Catálogo e preços em R$ sincronizados do IROD-Orça.',
    })
  }
  return supplier
}

function supplierReference(supplier) {
  return { id: supplier.id, name: supplier.name, code: supplier.code, status: supplier.status }
}

function materialFromCatalog(item, supplierId) {
  const categoryMap = { chapa: 'chapa', ferragem: 'ferragem', fita: 'fita_borda' }
  return {
    code: item.code,
    catalogId: item.id,
    name: item.name,
    category: categoryMap[item.kind] ?? 'insumo',
    subcategory: item.category,
    unit: item.unit,
    cost: item.price ?? 0,
    priceSource: 'leo_madeiras',
    priceUpdatedAt: item.updatedAt ?? new Date().toISOString(),
    brand: item.brand ?? '',
    thickness: item.thickness,
    sheetWidth: item.kind === 'chapa' ? item.width : null,
    sheetHeight: item.kind === 'chapa' ? item.height : null,
    stock: 0,
    minStock: 0,
    location: '',
    supplierId,
    imageUrl: item.image,
    sourceUrl: item.url,
    active: true,
  }
}

function applyMovement(user, body) {
  const material = db.get('materials', body.materialId)
  if (!material) throw new HttpError(404, 'Material não encontrado.')
  const type = body.type
  const qty = Number(body.quantity)
  if (!['entry', 'exit', 'adjustment', 'reserve'].includes(type)) throw new HttpError(400, 'Tipo de movimentação inválido.')
  if (!Number.isFinite(qty) || qty < 0 || (type !== 'adjustment' && qty === 0)) throw new HttpError(400, 'Quantidade inválida.')
  const before = Number(material.stock ?? 0)
  let after = before
  if (type === 'entry') after = before + qty
  else if (type === 'exit') {
    if (qty > before && !body.allowNegative) throw new HttpError(409, `Saldo insuficiente de "${material.name}" (disponível: ${before}).`)
    after = before - qty
  } else if (type === 'adjustment') after = qty
  after = round2(after)
  if (type !== 'reserve') {
    const patch = { stock: after }
    if (type === 'entry' && Number(body.unitCost) > 0) {
      const history = [...(material.priceHistory ?? []), { at: new Date().toISOString(), price: material.cost }].slice(-24)
      patch.cost = round2(body.unitCost)
      patch.priceHistory = history
      patch.priceUpdatedAt = new Date().toISOString()
    }
    db.update('materials', material.id, patch)
  }
  return db.insert('inventoryMovements', {
    materialId: material.id,
    materialName: material.name,
    type,
    quantity: qty,
    stockBefore: before,
    stockAfter: after,
    unit: material.unit,
    reason: String(body.reason ?? '').slice(0, 240),
    projectId: body.projectId ?? null,
    productionOrderId: body.productionOrderId ?? null,
    purchaseId: body.purchaseId ?? null,
    unitCost: Number(body.unitCost) || null,
    userId: user.id,
    userName: user.name,
    occurredAt: body.occurredAt ?? new Date().toISOString(),
  })
}

/** Avisa menções em comentários e responsáveis de tarefas recém-criadas. */
function notifyOnCreate(user, name, doc) {
  if (name === 'taskComments' && doc.kind !== 'system') {
    const task = db.get('tasks', doc.taskId)
    const mentioned = new Set(Array.isArray(doc.mentions) ? doc.mentions : [])
    const targets = new Set([...mentioned, ...(task?.assigneeIds ?? [])])
    targets.delete(user.id)
    for (const userId of targets)
      notify(db, {
        userId,
        kind: mentioned.has(userId) ? 'mention' : 'comment',
        title: mentioned.has(userId) ? `${user.name} mencionou você` : `Novo comentário de ${user.name}`,
        body: `${task?.title ?? 'Tarefa'}: ${String(doc.body).slice(0, 120)}`,
        path: `/projetos/${doc.projectId}?tarefa=${doc.taskId}`,
        taskId: doc.taskId,
        projectId: doc.projectId,
        key: `comment:${doc.id}`,
      })
  }
  if (name === 'tasks' && doc.assigneeIds?.length && !doc.parentId) {
    for (const userId of doc.assigneeIds.filter((a) => a !== user.id))
      notify(db, { userId, kind: 'assigned', title: 'Tarefa atribuída a você', body: `${doc.title} — por ${user.name}`, path: `/projetos/${doc.projectId}?tarefa=${doc.id}`, taskId: doc.id, projectId: doc.projectId, key: `assigned:${doc.id}` })
  }
  // problema apontado no chão de fábrica: avisa quem coordena a produção
  if (name === 'qualityRecords' && doc.productionOrderId) {
    const leaders = db.col('users').filter((u) => u.active !== false && u.id !== user.id && ['admin', 'gerente', 'pcp'].includes(u.role))
    for (const leader of leaders)
      notify(db, { userId: leader.id, kind: 'quality', title: `Problema na produção — ${user.name}`, body: `${doc.title}: ${String(doc.description ?? '').slice(0, 120)}`, path: '/qualidade', projectId: doc.projectId ?? undefined, key: `quality:${doc.id}` })
  }
}

/** Mantém só coordenadas válidas (e arredonda a ~1 m) nos registros de ponto e de entrega. */
function sanitizeGeoInput(name, input) {
  const out = { ...input }
  if (name === 'timeclock') {
    // atualizações parciais (ex.: só o endereço legível) não podem apagar a posição já gravada
    if ('lat' in out || 'lng' in out) {
      const lat = Number(out.lat)
      const lng = Number(out.lng)
      if (isLat(lat) && isLng(lng) && out.lat !== null && out.lat !== '' && out.lng !== null && out.lng !== '') {
        out.lat = Math.round(lat * 1e5) / 1e5
        out.lng = Math.round(lng * 1e5) / 1e5
        const accuracy = Number(out.accuracy)
        if ('accuracy' in out) out.accuracy = Number.isFinite(accuracy) && accuracy >= 0 ? Math.round(Math.min(accuracy, 99999)) : undefined
      } else {
        delete out.lat
        delete out.lng
        delete out.accuracy
        delete out.place
      }
    }
    if ('place' in out) out.place = out.place ? String(out.place).slice(0, 240) : undefined
    if ('locationStatus' in out && !['granted', 'denied', 'unavailable'].includes(out.locationStatus)) delete out.locationStatus
  }
  if (name === 'installations') {
    // o rastro e a última posição só entram pelo endpoint de rastreamento
    delete out.track
    delete out.lastLocation
    for (const key of ['destLat', 'destLng']) if (out[key] !== undefined && out[key] !== null) out[key] = Number(out[key])
    if (!(isLat(out.destLat) && isLng(out.destLng))) {
      delete out.destLat
      delete out.destLng
      delete out.destLabel
    }
  }
  return out
}

function handleCrud(req, res, name, id, query, user) {
  const rule = COLLECTIONS[name]
  if (!rule) throw new HttpError(404, 'Coleção desconhecida.')
  const method = req.method
  // Configurações de cada empresa usam ids lógicos ("company"); o prefixo da empresa fica só no servidor.
  const viewerModules = userModules(user)
  const outDoc = (doc) => redactDoc(name, name === 'settings' ? { ...doc, id: db.clientId(name, doc.id) } : doc, viewerModules)

  if (method === 'GET') {
    if (!canUseCollection(user, name, 'read')) throw new HttpError(403, 'Sem permissão para esta coleção.')
    if (id) {
      const doc = db.get(name, id)
      if (!doc) throw new HttpError(404, 'Registro não encontrado.')
      return send(res, 200, name === 'users' ? publicUser(doc) : outDoc(doc))
    }
    let list = db.list(name)
    if (name === 'users') {
      const full = userModules(user).includes('team')
      list = list.map((u) => (full ? publicUser(u) : refUser(u)))
    }
    if (rule.own && !isManagerRole(user.role)) list = list.filter((d) => d[rule.own] === user.id)
    if (name === 'files') {
      const canFin = userModules(user).includes('financial')
      list = list.filter((f) => f.visibility !== 'financeiro' || canFin)
    }
    for (const [k, v] of Object.entries(query)) {
      if (['limit', 'offset', 'since', 'token', 'full'].includes(k)) continue
      list = list.filter((d) => String(d[k]) === v)
    }
    if (query.since) list = list.filter((d) => d.updatedAt > query.since)
    if (query.limit) {
      const off = Number(query.offset ?? 0)
      list = list.slice(off, off + Number(query.limit))
    }
    // Planos de corte importados do Promob chegam a vários MB: a listagem devolve só o resumo
    // (peças e mapas de corte vêm ao abrir o plano, em GET /data/cutPlans/:id ou com ?full=1).
    if (name === 'cutPlans' && query.full !== '1') list = list.map(summarizeCutPlan)
    return send(res, 200, list.map(outDoc))
  }

  if (!canUseCollection(user, name, 'write')) throw new HttpError(403, 'Sem permissão para alterar esta coleção.')

  if (method === 'POST' && !id) {
    return readJson(req, MAX_CRUD_JSON).then((raw) => {
      let input = sanitizeGeoInput(name, cleanBody(raw))
      if (name === 'users') {
        input = prepareUserWrite(user, input, null)
        if (!input.passwordHash) throw new HttpError(400, 'Informe uma senha inicial (mínimo 8 caracteres).')
        if (!input.email || !input.name) throw new HttpError(400, 'Nome e e-mail são obrigatórios.')
        input.role ??= 'producao'
        input.active ??= true
      }
      if (name === 'settings' && typeof raw.id === 'string' && raw.id) {
        // Configuração com id lógico: grava por cima se já existir.
        const current = db.get(name, raw.id)
        if (current) {
          const next = db.update(name, raw.id, input)
          return send(res, 200, outDoc(next))
        }
        input.id = raw.id
      }
      if (rule.prefix && !input.code) input.code = db.nextCode(rule.prefix)
      if (rule.own) input[rule.own] = isManagerRole(user.role) && input[rule.own] ? input[rule.own] : user.id
      input.createdBy = user.id
      input.createdByName = user.name
      const doc = db.insert(name, input)
      audit(user, 'create', name, doc)
      notifyOnCreate(user, name, doc)
      return send(res, 201, name === 'users' ? publicUser(doc) : outDoc(doc))
    })
  }

  if ((method === 'PUT' || method === 'PATCH') && id) {
    return readJson(req, MAX_CRUD_JSON).then((raw) => {
      const existing = db.get(name, id)
      if (!existing) throw new HttpError(404, 'Registro não encontrado.')
      if (rule.own && !isManagerRole(user.role) && existing[rule.own] !== user.id) throw new HttpError(403, 'Registro de outro usuário.')
      let input = sanitizeGeoInput(name, cleanBody(raw))
      if (name === 'productionOrders' && input.status === 'liberada' && existing.status !== 'liberada')
        throw new HttpError(400, 'Use a acao de liberacao para reservar os materiais desta ordem.')
      if (name === 'productionOrders' && input.status === 'qualidade' && existing.status !== 'qualidade')
        throw new HttpError(400, 'Use a acao de inicio da qualidade para registrar a inspecao.')
      if (name === 'productionOrders' && input.status === 'concluida' && (existing.status !== 'qualidade' || existing.qualityStatus !== 'approved'))
        throw new HttpError(400, 'A ordem precisa ser aprovada pela qualidade antes da conclusao.')
      if (name === 'purchases' && input.status && input.status !== existing.status && ['aprovado', 'reprovado'].includes(input.status) && !canDecidePurchase(user))
        throw new HttpError(403, 'Somente administração, gerência e financeiro aprovam ou reprovam compras.')
      if (name === 'users') {
        input = prepareUserWrite(user, input, existing)
        if (existing.id === user.id && input.active === false) throw new HttpError(400, 'Você não pode desativar o próprio usuário.')
        const demotes = existing.role === 'admin' && (input.role && input.role !== 'admin' || input.active === false)
        if (demotes && activeAdmins(existing.id).length === 0) throw new HttpError(400, 'É necessário manter ao menos um administrador ativo.')
        if (input.active === false || input.passwordHash) sessions.destroyAllFor(existing.id)
        if (existing.active === false && input.active === true) assertCapacity('users', user.companyId)
      }
      let next = db.update(name, id, input)
      if (name === 'productionOrders' && input.status === 'cancelada') {
        const released = releaseProductionReservations(next, user)
        if (released) next = db.update(name, id, { reservationStatus: 'released' })
      }
      audit(user, 'update', name, next, { changes: changedKeys(existing, next).slice(0, 20) })
      if (name === 'tasks' && Array.isArray(input.assigneeIds)) {
        const added = input.assigneeIds.filter((a) => !(existing.assigneeIds ?? []).includes(a) && a !== user.id)
        for (const userId of added)
          notify(db, { userId, kind: 'assigned', title: 'Tarefa atribuída a você', body: `${next.title} — por ${user.name}`, path: `/projetos/${next.projectId}?tarefa=${next.id}`, taskId: next.id, projectId: next.projectId, key: `assigned:${next.id}:${Date.now()}` })
      }
      return send(res, 200, name === 'users' ? publicUser(next) : outDoc(next))
    })
  }

  if (method === 'DELETE' && id) {
    const existing = db.get(name, id)
    if (!existing) throw new HttpError(404, 'Registro não encontrado.')
    if (rule.own && !isManagerRole(user.role) && existing[rule.own] !== user.id) throw new HttpError(403, 'Registro de outro usuário.')
    if (name === 'users') {
      if (existing.id === user.id) throw new HttpError(400, 'Você não pode excluir o próprio usuário.')
      if (existing.role === 'admin' && activeAdmins(existing.id).length === 0) throw new HttpError(400, 'É necessário manter ao menos um administrador ativo.')
      sessions.destroyAllFor(existing.id)
    }
    if (name === 'productionOrders') releaseProductionReservations(existing, user)
    db.remove(name, id)
    live.changed(existing.companyId ?? null, name)
    if (name !== 'trash') moveToTrash(user, name, existing)
    audit(user, 'delete', name, existing)
    return send(res, 200, { ok: true })
  }

  throw new HttpError(405, 'Método não permitido.')
}

// ------------------------------------------------------------ static files
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.apk': 'application/vnd.android.package-archive',
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // geolocation=(self): o ponto e a rota de entrega pedem a localização (só com a permissão da pessoa)
  // camera=(self): o chão de fábrica lê o QR das etiquetas pela câmera (também só com a permissão da pessoa)
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(self), payment=()',
  ...(/^https:\/\//i.test(process.env.APP_URL ?? '') ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob: https://images.cws.digital https://tile.openstreetmap.org https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
}

let privateAssetsCache = null
/** Arquivos do aplicativo (gerados no build por scripts/mark-private-assets.mjs). Vazio = tudo público. */
const privateAssets = () => {
  if (privateAssetsCache) return privateAssetsCache
  let list = []
  try {
    list = JSON.parse(readFileSync(join(distDir, 'private-assets.json'), 'utf8'))
  } catch {
    /* build antigo ou desenvolvimento: sem portão */
  }
  privateAssetsCache = new Set(Array.isArray(list) ? list : [])
  return privateAssetsCache
}

function serveStatic(req, res, path) {
  if (!existsSync(distDir)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Core Cut ERP API em execução. Execute "npm run build" para servir a interface, ou use "npm run dev".')
  }
  let rel = normalize(decodeURIComponent(path)).replace(/^([/\\])+/, '')
  const relUrl = rel.split(sep).join('/')
  // o aplicativo Android só sai por link temporário de quem tem o plano (nunca pela pasta pública)
  if (relUrl === 'private-assets.json' || relUrl.endsWith('.apk')) {
    res.writeHead(404, SECURITY_HEADERS)
    return res.end('Não encontrado')
  }
  // código das telas internas: só com sessão válida
  if (privateAssets().has(relUrl)) {
    const session = sessions.resolve(readGateCookie(req))
    if (!session) {
      rateLimit(`gate:${clientIp(req)}`, 60, 60_000)
      res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end('Entre na sua conta para carregar o aplicativo.')
    }
  }
  let file = join(distDir, rel)
  if (!file.startsWith(distDir + sep) && file !== distDir) {
    res.writeHead(403)
    return res.end()
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    if (extname(rel)) {
      res.writeHead(404)
      return res.end('Não encontrado')
    }
    file = join(distDir, 'index.html')
    rel = 'index.html'
  }
  const hashed = /[-.][A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(rel)
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': statSync(file).size,
    'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : rel.startsWith('site/') ? 'public, max-age=86400' : 'no-cache',
    ...(rel.endsWith('.apk') ? { 'Content-Disposition': 'attachment; filename="CoreCut-ERP.apk"' } : {}),
  })
  createReadStream(file).pipe(res)
}

// --------------------------------------------------------------- the server
const handleRequest = async (req, res) => {
  const started = Date.now()
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname
    const query = Object.fromEntries(url.searchParams.entries())

    if (!path.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD', ...SECURITY_HEADERS })
        return res.end()
      }
      return serveStatic(req, res, path)
    }
    if (path !== '/api/billing/webhook') rateLimit(`api:${clientIp(req)}`, LIMITS.api, 60_000)

    if (path === '/api/health') {
      if (db.isPostgres) {
        try {
          await db.checkHealth()
        } catch (error) {
          console.error('[db] Verificação de saúde do PostgreSQL falhou.', error)
          return writeResponse(res, 503, { status: 'unavailable', error: 'Banco de dados indisponível.' })
        }
      }
      return send(res, 200, {
        status: 'ok',
        database: db.isPostgres ? 'postgresql' : 'json',
        schemaVersion: db.schemaVersion ?? 'json',
        time: new Date().toISOString(),
        uptime: Math.round(process.uptime()),
      })
    }

    await handleAuth(req, res, path, query)
    // resposta já iniciada (ex.: arquivo em transferência): nada mais a fazer aqui
    if (res.writableEnded || res.headersSent) return

    const header = req.headers.authorization ?? ''
    // O token na URL só vale para baixar/visualizar arquivos (<img>, links); o resto exige o cabeçalho.
    const urlTokenAllowed = /^\/api\/files\/[^/]+\/download$/.test(path)
    const token = header.startsWith('Bearer ') ? header.slice(7) : urlTokenAllowed ? query.token : undefined
    const session = sessions.resolve(token)
    if (!session) throw new HttpError(401, 'Sessão expirada. Faça login novamente.')
    const user = db.get('users', session.userId)
    if (!user || user.active === false) throw new HttpError(401, 'Usuário inativo.')
    sessions.slide(session)
    // quem volta com a sessão guardada (sem passar pelo login) recebe de novo a liberação do código do aplicativo
    if (header.startsWith('Bearer ') && readGateCookie(req) !== token) res.setHeader('Set-Cookie', gateCookie(token))

    if (user.passwordMustChange && !path.startsWith('/api/auth/')) {
      throw new HttpError(403, 'Troque a senha provisória antes de continuar.')
    }
    const company = companyOf(user)
    if (user.companyId && !company) throw new HttpError(403, 'Empresa não encontrada. Entre em contato com o suporte.')
    // Sem pagamento ativo só funcionam login/sessão e as rotas de cobrança.
    const billingRoute = path.startsWith('/api/auth/') || path.startsWith('/api/billing/')
    if (company && !billingRoute) {
      const access = companyAccess(company)
      if (!access.allowed) throw new HttpError(402, access.message)
    }
    if (path.startsWith('/api/platform/')) {
      if (user.companyId || user.role !== 'admin') throw new HttpError(403, 'Somente a administração da plataforma acessa este painel.')
      const handled = await platform({ req, res, path, query, user, readJson, send })
      if (handled) return
      throw new HttpError(404, 'Rota não encontrada.')
    }
    await db.runAsTenant(user.companyId ?? null, () => handleAuthenticated(req, res, path, query, user, token))
    if (!res.writableEnded && !res.headersSent) throw new HttpError(404, 'Rota não encontrada.')
  } catch (error) {
    if (res.headersSent) return res.end()
    const status = error instanceof HttpError ? error.status : 500
    if (status === 500) {
      console.error(`[erro] ${req.method} ${req.url}`, error)
      metrics.recordError({ method: req.method, path: req.url ?? '', message: error?.message ?? error })
    }
    send(res, status, { error: status === 500 ? 'Erro interno do servidor.' : error.message }, error?.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {})
  } finally {
    if ((req.url ?? '').startsWith('/api/')) {
      metrics.record({ method: req.method ?? 'GET', path: req.url ?? '', status: res.statusCode, ms: Date.now() - started })
    }
    if (process.env.ARCOPLAN_LOG === '1') console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`)
  }
}
const server = createServer((req, res) => requestContext.run(contextFor(req), () => handleRequest(req, res)))

const platform = createPlatform({
  db,
  sessions,
  billing,
  publicOrigin,
  metrics,
  mailer,
  seedCompany: (company) => db.runAsTenant(company.id, () => seedCompanyDefaults(db, company)),
  trialHours: TRIAL_HOURS,
  limiter,
  dataDir,
  HttpError,
  hashPassword,
  verifyAccess: (company) => companyAccess(company),
  findPlan,
  getPlanLimits,
  companyUsage,
  assertCapacity,
  faces,
  faceEngine,
})

// A verificação em duas etapas do site foi removida: apaga as sementes e os códigos que ainda estiverem guardados.
{
  let cleared = 0
  for (const entry of db.all('users')) {
    if (entry.totpEnabled || entry.totpSecret || entry.totpPendingSecret || (Array.isArray(entry.recoveryCodes) && entry.recoveryCodes.length)) {
      db.update('users', entry.id, { totpEnabled: false, totpSecret: null, totpPendingSecret: null, recoveryCodes: [], totpLastStep: null })
      cleared += 1
    }
  }
  if (cleared) console.log(`[segurança] 2FA do site removido: dados de ${cleared} usuário(s) apagados.`)
}

// Proteção contra conexões lentas/penduradas e queda por erro isolado.
server.headersTimeout = 20_000
server.requestTimeout = 5 * 60_000
server.keepAliveTimeout = 65_000
process.on('unhandledRejection', (reason) => {
  console.error('[erro] promessa rejeitada sem tratamento:', reason)
  metrics.recordError({ method: 'PROCESS', path: 'promessa-rejeitada', message: reason?.message ?? reason })
})
process.on('uncaughtException', (error) => {
  console.error('[fatal] exceção não tratada:', error)
  process.exit(1) // o Docker (restart: unless-stopped) sobe de novo
})

// Ordens criadas antes do espelhamento só ganham a tarefa no projeto se isso for pedido (PRODUCTION_TASKS_BACKFILL=1):
// por padrão a publicação não grava nada nos dados já existentes.
if (process.env.PRODUCTION_TASKS_BACKFILL === '1') setTimeout(() => {
  try {
    const n = productionTasks.backfill()
    if (n) console.log(`[produção] ${n} ordem(ns) espelhada(s) nas tarefas dos projetos.`)
  } catch (error) {
    console.error('[produção] Falha no espelhamento inicial:', error?.message ?? error)
  }
}, 3000).unref()

const shutdown = () => {
  if (!db.isPostgres) {
    db.flush()
    process.exit(0)
    return
  }
  server.close(() => {
    db.close().then(
      () => process.exit(0),
      (error) => {
        console.error('[db] Falha ao fechar a conexão PostgreSQL corretamente.', error)
        process.exit(1)
      },
    )
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
if (!db.isPostgres) process.on('exit', () => db.flush())

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. Defina outra com a variável PORT (ex.: set PORT=4500).`)
    process.exit(1)
  }
  throw error
})

// webhook opcional: cada notificação criada é enviada em JSON (integração com WhatsApp, e-mail, n8n…)
const WEBHOOK = process.env.ARCOPLAN_WEBHOOK_URL
if (WEBHOOK) {
  setNotifyHook((n) => {
    const to = db.get('users', n.userId)
    void fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: n.kind, title: n.title, body: n.body, path: n.path, user: to ? { name: to.name, email: to.email, phone: to.phone } : null, at: n.createdAt }),
    }).catch(() => {})
  })
}

// rodada do agendador na inicialização e a cada 15 minutos
const SCHEDULER_MS = Number(process.env.ARCOPLAN_SCHEDULER_MS ?? 15 * 60 * 1000)
if (SCHEDULER_MS > 0) {
  const tick = () => {
    void runSchedulerOnce().catch((e) => console.error('[scheduler]', e))
    void billingEmails.run().catch((e) => console.error('[email] cobrança:', e))
  }
  setTimeout(tick, 5000).unref()
  setInterval(tick, SCHEDULER_MS).unref()
}

server.listen(PORT, HOST, () => {
  console.log(`Core Cut ERP API em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}  (dados: ${db.isPostgres ? 'PostgreSQL' : dataDir})`)
})

export { server, db }
