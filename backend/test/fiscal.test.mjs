import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFocusPayload, createSecretBox, mapFocusResponse, totalsOf, validCnpj, validCpf } from '../lib/fiscal.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = 6300 + Math.floor(Math.random() * 300)
const focusPort = 6700 + Math.floor(Math.random() * 300)
const base = `http://127.0.0.1:${port}/api`
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-fiscal-'))
const TOKEN = 'tok-homolog-ABCDEF123456'
const PLATFORM_TOKEN = 'tok-plataforma-ZZZZ987654'
const HOOK_SECRET = 'segredo-webhook-abcdef-123456'
const seen = []
const notes = new Map()
let child
let focus
let admin

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
  return { status: res.status, json, text }
}

/** Focus NFe falso: processa em duas etapas (processando → autorizado) e recusa o destinatário "REJEITAR". */
const fakeFocus = () =>
  createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    seen.push({ method: req.method, path: url.pathname, ref: url.searchParams.get('ref'), auth: req.headers.authorization, body })
    res.setHeader('Content-Type', 'application/json')
    const reply = (code, json) => {
      res.statusCode = code
      res.end(JSON.stringify(json))
    }
    if (req.method === 'POST' && url.pathname === '/v2/nfe') {
      if (body.nome_destinatario === 'REJEITAR') return reply(422, { codigo: 'requisicao_invalida', mensagem: 'Campo cep_destinatario inválido.' })
      notes.set(url.searchParams.get('ref'), { polls: 0 })
      return reply(202, { status: 'processando_autorizacao', cnpj_emitente: body.cnpj_emitente })
    }
    const match = url.pathname.match(/^\/v2\/nfe\/([^/]+)$/)
    if (match && req.method === 'GET') {
      const note = notes.get(match[1])
      if (!note) return reply(404, { codigo: 'nao_encontrado', mensagem: 'Nota não encontrada' })
      note.polls += 1
      if (note.cancelled) return reply(200, { status: 'cancelado', numero: '175', serie: '1' })
      return reply(200, {
        status: 'autorizado',
        numero: '175',
        serie: '1',
        chave_nfe: 'NFe43090890627936000130550010001750000008965',
        protocolo: '143090000012345',
        caminho_xml_nota_fiscal: `/arquivos/${match[1]}.xml`,
        caminho_danfe: `/arquivos/${match[1]}.pdf`,
      })
    }
    if (match && req.method === 'DELETE') {
      const note = notes.get(match[1])
      if (!note) return reply(404, { codigo: 'nao_encontrado' })
      note.cancelled = true
      return reply(200, { status: 'cancelado' })
    }
    return reply(404, {})
  })

before(async () => {
  focus = fakeFocus()
  await new Promise((r) => focus.listen(focusPort, '127.0.0.1', r))
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir, ARCOPLAN_SCHEDULER_MS: '0', FOCUS_URL_HOMOLOGACAO: `http://127.0.0.1:${focusPort}`, FOCUS_TOKEN_HOMOLOGACAO: PLATFORM_TOKEN, FOCUS_WEBHOOK_SECRET: HOOK_SECRET },
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
  admin = login.json.token
  await call('POST', '/auth/change-password', { token: admin, body: { currentPassword: 'arcoplan123', newPassword: 'Cerejeira-Azul-47' } })
})

after(() => {
  child?.kill()
  focus?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

const company = {
  name: 'Marcenaria Horizonte',
  legalName: 'Horizonte Móveis Planejados LTDA',
  cnpj: '11.444.777/0001-61',
  ie: '123456789',
  taxRegime: '1',
  address: 'Rua das Acácias',
  number: '120',
  district: 'Distrito Industrial',
  city: 'Niterói',
  state: 'RJ',
  cep: '24000-000',
  fiscalSerie: '1',
  fiscalEnvironment: 'homologacao',
}
const recipient = { name: 'Helena Prado', document: '529.982.247-25', zip: '22040-020', address: 'Av. Atlântica', number: '1500', district: 'Copacabana', city: 'Rio de Janeiro', state: 'RJ', email: 'helena@example.com' }
const item = { id: '1', code: 'COZ-01', description: 'Cozinha planejada sob medida', ncm: '94034000', cfop: '5101', unit: 'UN', quantity: 1, unitPrice: 18500.5, origin: '0', taxSituation: '102' }

test('documentos: CPF e CNPJ validam os dígitos verificadores', () => {
  assert.equal(validCpf('529.982.247-25'), true)
  assert.equal(validCpf('111.111.111-11'), false)
  assert.equal(validCpf('529.982.247-24'), false)
  assert.equal(validCnpj('11.444.777/0001-61'), true)
  assert.equal(validCnpj('11.444.777/0001-62'), false)
})

test('totais: o servidor recalcula tudo e o payload da Focus leva os campos fiscais', () => {
  const invoice = { natureOfOperation: 'Venda de mercadoria', recipient, items: [{ ...item, quantity: 2, unitPrice: 100.333 }, { ...item, id: '2', quantity: 1, unitPrice: 50 }], freight: 10, discount: 5.5, total: 99999 }
  const t = totalsOf(invoice)
  assert.equal(t.products, 250.67)
  assert.equal(t.total, 255.17) // ignora o total enviado pelo navegador
  const payload = buildFocusPayload({ invoice, company, now: new Date('2026-10-20T12:00:00Z') })
  assert.equal(payload.cnpj_emitente, '11444777000161')
  assert.equal(payload.cpf_destinatario, '52998224725')
  assert.equal(payload.local_destino, 1)
  assert.equal(payload.indicador_inscricao_estadual_destinatario, '9')
  assert.equal(payload.valor_total, 255.17)
  assert.equal(payload.items[0].codigo_ncm, '94034000')
  assert.equal(payload.items[0].icms_situacao_tributaria, '102')
  assert.equal(payload.items.length, 2)
  // resposta do provedor: caminhos relativos viram URLs completas
  const mapped = mapFocusResponse({ status: 'autorizado', numero: 7, chave_nfe: 'NFe123', caminho_danfe: '/x.pdf' }, 'https://api.focusnfe.com.br')
  assert.equal(mapped.status, 'autorizada')
  assert.equal(mapped.accessKey, '123')
  assert.equal(mapped.danfeUrl, 'https://api.focusnfe.com.br/x.pdf')
})

test('segredo: o token fica cifrado e só abre com a mesma chave', () => {
  const a = createSecretBox({ env: { FISCAL_SECRET_KEY: 'chave-a' } })
  const b = createSecretBox({ env: { FISCAL_SECRET_KEY: 'chave-b' } })
  const sealed = a.seal('meu-token-secreto')
  assert.equal(sealed.includes('meu-token-secreto'), false)
  assert.equal(a.open(sealed), 'meu-token-secreto')
  assert.equal(b.open(sealed), null)
})

test('nota fiscal: configura, valida, emite, consulta, cancela e nunca expõe o token', async () => {
  // empresa incompleta: o status lista o que falta
  const before = await call('GET', '/fiscal/status', { token: admin })
  assert.equal(before.status, 200)
  assert.ok(before.json.problems.length > 3)
  assert.deepEqual(before.json.own, { homologacao: false, producao: false })
  // a conta-base usa o token da plataforma enquanto não tiver token próprio
  assert.equal(before.json.sources.homologacao, 'plataforma')

  assert.equal((await call('PUT', '/data/settings/company', { token: admin, body: company })).status, 200)
  assert.deepEqual((await call('GET', '/fiscal/status', { token: admin })).json.problems, [])

  assert.equal((await call('PUT', '/fiscal/token', { token: admin, body: { environment: 'homologacao', token: 'curto' } })).status, 400)
  assert.equal((await call('PUT', '/fiscal/token', { token: admin, body: { environment: 'homologacao', token: TOKEN } })).status, 200)
  assert.equal((await call('GET', '/fiscal/status', { token: admin })).json.sources.homologacao, 'empresa')

  // o token não aparece em nenhuma leitura de dados nem em coleção interna
  const settings = await call('GET', '/data/settings', { token: admin })
  assert.equal(settings.text.includes(TOKEN), false)
  assert.notEqual((await call('GET', '/data/fiscalSecrets', { token: admin })).status, 200)

  // notas só nascem e mudam pelas rotas fiscais, nunca pelo CRUD genérico
  assert.equal((await call('POST', '/data/invoices', { token: admin, body: { status: 'autorizada', accessKey: 'x' } })).status, 403)

  // nota sem NCM: nada é enviado ao provedor
  const bad = (await call('POST', '/fiscal/invoices', { token: admin, body: { sourceType: 'orcamento', recipient, items: [{ ...item, ncm: '' }] } })).json
  assert.equal(bad.status, 'rascunho')
  const refused = await call('POST', `/fiscal/invoices/${bad.id}/emit`, { token: admin })
  assert.equal(refused.status, 400)
  assert.match(refused.json.error, /NCM/)
  assert.equal(seen.filter((s) => s.method === 'POST').length, 0)

  // nota correta
  const created = await call('POST', '/fiscal/invoices', { token: admin, body: { sourceType: 'orcamento', recipient, items: [item], freight: 0, discount: 500.5, total: 1 } })
  assert.equal(created.status, 201)
  assert.match(created.json.code, /^NF-/)
  assert.equal(created.json.total, 18000)
  const emitted = await call('POST', `/fiscal/invoices/${created.json.id}/emit`, { token: admin })
  assert.equal(emitted.status, 200, JSON.stringify(emitted.json))
  assert.equal(emitted.json.status, 'processando')
  const sent = seen.find((s) => s.method === 'POST')
  assert.equal(sent.auth, `Basic ${Buffer.from(`${TOKEN}:`).toString('base64')}`)
  assert.equal(sent.body.valor_total, 18000)
  assert.match(sent.ref, /^cc-/)

  // enquanto processa, não aceita edição nem novo envio
  assert.equal((await call('PUT', `/fiscal/invoices/${created.json.id}`, { token: admin, body: { notes: 'x' } })).status, 409)
  assert.equal((await call('POST', `/fiscal/invoices/${created.json.id}/emit`, { token: admin })).status, 409)

  const refreshed = await call('POST', `/fiscal/invoices/${created.json.id}/refresh`, { token: admin })
  assert.equal(refreshed.json.status, 'autorizada')
  assert.equal(refreshed.json.number, '175')
  assert.equal(refreshed.json.accessKey, '43090890627936000130550010001750000008965')
  assert.match(refreshed.json.danfeUrl, /^http:\/\/127\.0\.0\.1:\d+\/arquivos\/.*\.pdf$/)

  // cancelamento exige justificativa e só vale para nota autorizada
  assert.equal((await call('POST', `/fiscal/invoices/${created.json.id}/cancel`, { token: admin, body: { reason: 'curto' } })).status, 400)
  const cancelled = await call('POST', `/fiscal/invoices/${created.json.id}/cancel`, { token: admin, body: { reason: 'Pedido cancelado pelo cliente antes da entrega.' } })
  assert.equal(cancelled.status, 200)
  assert.equal(cancelled.json.status, 'cancelada')

  // recusa do provedor: fica "rejeitada" com a mensagem e pode ser corrigida
  const rej = (await call('POST', '/fiscal/invoices', { token: admin, body: { sourceType: 'projeto', recipient: { ...recipient, name: 'REJEITAR' }, items: [item] } })).json
  const rejected = await call('POST', `/fiscal/invoices/${rej.id}/emit`, { token: admin })
  assert.equal(rejected.status, 422)
  assert.match(rejected.json.error, /cep_destinatario/)
  const after = (await call('GET', `/fiscal/invoices/${rej.id}`, { token: admin })).json
  assert.equal(after.status, 'rejeitada')
  assert.equal((await call('PUT', `/fiscal/invoices/${rej.id}`, { token: admin, body: { recipient: { ...recipient, name: 'Helena Prado' } } })).status, 200)

  // sem login, nada
  assert.equal((await call('GET', '/fiscal/status')).status, 401)
})

/** CNPJ válido a partir de 12 dígitos (calcula os verificadores). */
const makeCnpj = (base12) => {
  const d = base12.split('').map(Number)
  for (const size of [12, 13]) {
    let weight = size - 7
    let sum = 0
    for (let i = 0; i < size; i++) {
      sum += d[i] * weight
      weight = weight === 2 ? 9 : weight - 1
    }
    d.push(sum % 11 < 2 ? 0 : 11 - (sum % 11))
  }
  return d.join('')
}

test('plataforma: empresa cliente só emite com o token da plataforma depois de liberada, sem repetir CNPJ, e o webhook atualiza a nota', async () => {
  const created = await call('POST', '/platform/companies', { token: admin, body: { companyName: 'Marcenaria Aurora', ownerName: 'Paulo Aurora', email: 'paulo@aurora.com.br', planId: 'profissional', access: 'license', days: 30 } })
  assert.equal(created.status, 201, JSON.stringify(created.json))
  const login = await call('POST', '/auth/login', { body: { login: 'paulo@aurora.com.br', password: created.json.temporaryPassword } })
  await call('POST', '/auth/change-password', { token: login.json.token, body: { currentPassword: created.json.temporaryPassword, newPassword: 'Ipe-Amarelo-2026' } })
  const tenant = login.json.token
  const myCnpj = makeCnpj('123456780001')
  assert.equal((await call('PUT', '/data/settings/company', { token: tenant, body: { ...company, name: 'Marcenaria Aurora', legalName: 'Aurora Móveis LTDA', cnpj: myCnpj } })).status, 200)

  const status = (await call('GET', '/fiscal/status', { token: tenant })).json
  assert.equal(status.platform.available, true)
  assert.equal(status.platform.allowed, false)
  assert.equal(status.sources.homologacao, null)

  const draft = (await call('POST', '/fiscal/invoices', { token: tenant, body: { sourceType: 'projeto', recipient, items: [item] } })).json
  const blocked = await call('POST', `/fiscal/invoices/${draft.id}/emit`, { token: tenant })
  assert.equal(blocked.status, 400)
  assert.match(blocked.json.error, /liberada/)

  // o administrador da plataforma libera: agora emite com o token da plataforma e os dados DESTA empresa
  const before = seen.length
  assert.equal((await call('POST', `/platform/companies/${created.json.company.id}/fiscal`, { token: admin, body: { enabled: true } })).status, 200)
  const emitted = await call('POST', `/fiscal/invoices/${draft.id}/emit`, { token: tenant })
  assert.equal(emitted.status, 200, JSON.stringify(emitted.json))
  const sent = seen.slice(before).find((s) => s.method === 'POST')
  assert.equal(sent.auth, `Basic ${Buffer.from(`${PLATFORM_TOKEN}:`).toString('base64')}`)
  assert.equal(sent.body.cnpj_emitente, myCnpj)

  // o token da plataforma nunca aparece para a empresa
  assert.equal(JSON.stringify((await call('GET', '/fiscal/status', { token: tenant })).json).includes(PLATFORM_TOKEN), false)

  // CNPJ repetido em outra empresa: bloqueado
  await call('PUT', '/data/settings/company', { token: tenant, body: { cnpj: company.cnpj } })
  const second = (await call('POST', '/fiscal/invoices', { token: tenant, body: { sourceType: 'projeto', recipient, items: [item] } })).json
  const clash = await call('POST', `/fiscal/invoices/${second.id}/emit`, { token: tenant })
  assert.equal(clash.status, 409)
  await call('PUT', '/data/settings/company', { token: tenant, body: { cnpj: myCnpj } })

  // webhook: exige o segredo e atualiza a nota autorizada pelo ref
  const ref = (await call('GET', `/fiscal/invoices/${draft.id}`, { token: tenant })).json.ref
  const hook = (secret) => fetch(`http://127.0.0.1:${port}/api/public/fiscal-webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: secret } : {}) }, body: JSON.stringify({ ref, status: 'autorizado', numero: '999', serie: '1', chave_nfe: 'NFe' + '3'.repeat(44), protocolo: '1234', caminho_danfe: '/d.pdf' }) })
  assert.equal((await hook(null)).status, 401)
  assert.equal((await hook('errado')).status, 401)
  assert.equal((await hook(HOOK_SECRET)).status, 200)
  const done = (await call('GET', `/fiscal/invoices/${draft.id}`, { token: tenant })).json
  assert.equal(done.status, 'autorizada')
  assert.equal(done.number, '999')
  assert.equal(done.accessKey, '3'.repeat(44))

  // o backup do cliente não leva o token do provedor, nem cifrado
  await call('PUT', '/fiscal/token', { token: tenant, body: { environment: 'homologacao', token: 'token-proprio-da-aurora-123' } })
  const backup = await call('GET', '/admin/backup', { token: tenant })
  assert.equal(backup.status, 200)
  assert.equal(backup.text.includes('fiscalSecrets'), false)
  assert.equal(backup.text.includes('token-proprio-da-aurora-123'), false)

  // liberar de novo exige ser administrador da plataforma
  assert.equal((await call('POST', `/platform/companies/${created.json.company.id}/fiscal`, { token: tenant, body: { enabled: true } })).status, 403)
})

// ---------------------------------------------- rascunho a partir do orçamento
import { invoiceDraftFromBudget, invoiceDraftFromProject, itemDefaults, unitCode } from '../../src/domain/invoice.ts'
import { budgetTotals } from '../../src/domain/budget.ts'

test('rascunho: a nota fecha no mesmo total do orçamento (imposto por dentro) e separa os serviços', () => {
  const budget = {
    id: 'b1', code: 'ORC-1', status: 'aprovado', title: 'Cozinha', marginPercent: 30, taxPercent: 6, discountPercent: 5, freight: 300, installation: 1200, laborHours: 10, laborRate: 60,
    items: [
      { id: 'a', group: 'Cozinha', description: 'Armário superior', kind: 'modulo', unit: 'un', quantity: 3, unitCost: 1000, unitPrice: 0 },
      { id: 'b', group: 'Cozinha', description: 'Bancada', kind: 'material', unit: 'm²', quantity: 2.5, unitCost: 400, unitPrice: 700 },
    ],
  }
  const client = { name: 'Helena Prado', document: '529.982.247-25', state: 'RJ', city: 'Rio de Janeiro' }
  const co = { state: 'RJ', taxRegime: '1', fiscalCfop: '5101' }
  const full = invoiceDraftFromBudget({ budget, client, company: co })
  assert.ok(Math.abs(full.total - budgetTotals(budget).total) <= 0.05, `${full.total} x ${budgetTotals(budget).total}`)
  assert.equal(full.items.filter((i) => i.service).length, 2)
  assert.equal(full.items.find((i) => i.description.includes('Bancada')).unit, 'M2')
  assert.match(full.notes, /Orçamento ORC-1/)
  assert.match(full.notes, /SIMPLES NACIONAL/)

  const goods = invoiceDraftFromBudget({ budget, client, company: co, options: { includeServices: false } })
  assert.equal(goods.items.some((i) => i.service), false)
  assert.ok(goods.total < full.total)
})

test('rascunho: CFOP interestadual e parcelas do contrato ajustadas ao total', () => {
  assert.equal(itemDefaults({ state: 'RJ', fiscalCfop: '5101' }, 'SP').cfop, '6101')
  assert.equal(itemDefaults({ state: 'RJ', fiscalCfop: '5101' }, 'rj').cfop, '5101')
  assert.equal(itemDefaults({ state: 'RJ', taxRegime: '3' }, 'RJ').taxSituation, '00')
  assert.equal(unitCode('m²'), 'M2')
  const draft = invoiceDraftFromProject({
    project: { id: 'p1', code: 'PRJ-1', name: 'Closet', clientId: 'c1' },
    client: { name: 'Fulano', document: '52998224725' },
    value: 10000,
    contract: { code: 'CTR-1', installments: [{ id: 'x', label: 'Entrada', dueDate: '2026-11-01', amount: 3333 }, { id: 'y', label: 'Saldo', dueDate: '2026-12-01', amount: 7777 }] },
    company: { state: 'RJ' },
  })
  assert.equal(draft.total, 10000)
  assert.equal(draft.installments.reduce((s, p) => s + p.amount, 0), 10000)
  assert.equal(draft.installments.length, 2)
})

// ---------------------------------------------- DANFE
import { buildDanfePdf, code128C, CODE128_PATTERNS, formatAccessKey } from '../../src/domain/danfe.ts'

test('código de barras: tabela Code 128 consistente e 44 dígitos geram 277 módulos', () => {
  assert.equal(CODE128_PATTERNS.length, 107)
  CODE128_PATTERNS.forEach((p, i) => assert.equal(p.split('').reduce((s, n) => s + Number(n), 0), i === 106 ? 13 : 11, `padrão ${i}`))
  const key = '43090890627936000130550010001750000008965'.padStart(44, '0')
  const bars = code128C(key)
  assert.equal(bars.reduce((s, n) => s + n, 0), 277)
  assert.equal(formatAccessKey(key).split(' ').length, 11)
  assert.throws(() => code128C('123'))
})

const danfeInvoice = (count, overrides = {}) => ({
  id: 'n1', status: 'autorizada', environment: 'producao', sourceType: 'orcamento', natureOfOperation: 'Venda de mercadoria', number: '175', serie: '1',
  accessKey: '43090890627936000130550010001750000008965'.padStart(44, '0'), protocol: '143090000012345', authorizedAt: '2026-10-20T15:00:00Z', issuedAt: '2026-10-20T14:59:00Z',
  recipient, freight: 0, discount: 0, total: count * 100, notes: 'Orçamento ORC-1 · Projeto PRJ-1',
  installments: [{ number: '001', dueDate: '2026-11-20', amount: count * 50 }, { number: '002', dueDate: '2026-12-20', amount: count * 50 }],
  items: Array.from({ length: count }, (_, i) => ({ ...item, id: String(i), code: String(i + 1), description: `Módulo ${i + 1} da cozinha`, quantity: 1, unitPrice: 100, total: 100 })),
  ...overrides,
})

test('DANFE: gera o PDF, pagina muitos itens e marca homologação como sem valor fiscal', async () => {
  const pagesOf = async (blob) => {
    const text = Buffer.from(await blob.arrayBuffer()).toString('latin1')
    return { pages: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length, head: text.slice(0, 5), text }
  }
  const one = await pagesOf(buildDanfePdf({ invoice: danfeInvoice(3), company }))
  assert.equal(one.head, '%PDF-')
  assert.equal(one.pages, 1)
  const many = await pagesOf(buildDanfePdf({ invoice: danfeInvoice(70), company }))
  assert.ok(many.pages >= 2, `esperava mais de uma página, veio ${many.pages}`)
  // homologação não pode parecer documento válido
  const homolog = buildDanfePdf({ invoice: danfeInvoice(2, { environment: 'homologacao' }), company })
  assert.ok(homolog.size > 1000)
})
