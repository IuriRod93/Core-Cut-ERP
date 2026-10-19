import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Bateria de segurança contra o servidor em configuração de produção:
 * credencial "live" do Mercado Pago, NODE_ENV=production, HSTS e limites padrão.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = 5900 + Math.floor(Math.random() * 300)
const base = `http://127.0.0.1:${port}/api`
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-security-'))
const TRIAL_LIMIT = 8

let child
let masterToken
let A
let B
let seq = 0

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
    /* sem JSON */
  }
  return { status: res.status, json, text, headers: res.headers }
}

/** Requisição HTTP sem normalização de caminho (para testar `..` e `%2e`). */
const rawRequest = (path) =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let text = ''
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }))
    })
    req.on('error', reject)
    req.end()
  })

async function startTrial(label) {
  seq += 1
  const email = `${label}${seq}-${Date.now()}@teste.com`
  const res = await call('POST', '/auth/register-company', {
    body: { companyName: `Empresa ${label} ${seq}`, ownerName: 'Dono Teste', email, password: 'Senha-Forte-123', planId: 'profissional', phone: '21999990000', trial: true, acceptTerms: true },
  })
  return { email, password: 'Senha-Forte-123', res }
}

const login = (email, password) => call('POST', '/auth/login', { body: { login: email, password } })

before(async () => {
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: '',
      PORT: String(port),
      HOST: '127.0.0.1',
      ARCOPLAN_DATA_DIR: dataDir,
      ARCOPLAN_SCHEDULER_MS: '0',
      MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-token-de-producao-falso',
      MERCADOPAGO_API_BASE: 'http://127.0.0.1:1',
      MERCADOPAGO_MODE: '',
      APP_URL: 'https://www.cutcore.com.br',
      RATE_TRIAL_PER_DAY: String(TRIAL_LIMIT),
      STRIPE_SECRET_KEY: '',
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
  const admin = await login('admin', 'arcoplan123')
  assert.equal(admin.status, 200)
  const changed = await call('POST', '/auth/change-password', { token: admin.json.token, body: { currentPassword: 'arcoplan123', newPassword: 'Senha-Forte-123' } })
  assert.equal(changed.status, 200)
  masterToken = admin.json.token

  A = await startTrial('a')
  B = await startTrial('b')
  assert.equal(A.res.status, 201, JSON.stringify(A.res.json))
  assert.equal(B.res.status, 201, JSON.stringify(B.res.json))
})

after(() => {
  child?.kill()
  rmSync(dataDir, { recursive: true, force: true })
})

// ------------------------------------------------------------- cobrança
test('cadastro "simulado" (sem pagar) é recusado em produção', async () => {
  const body = { companyName: 'Fraude LTDA', ownerName: 'Fulano', email: `fraude-${Date.now()}@teste.com`, password: 'Senha-Forte-123', planId: 'industrial', simulate: true }
  assert.equal((await call('POST', '/auth/register-company', { body })).status, 403)
  assert.equal((await call('POST', '/auth/register-company?simulate=true', { body: { ...body, simulate: false } })).status, 403)
  // e a lista pública de planos não oferece o botão de simulação
  const plans = await call('GET', '/billing/plans')
  assert.equal(plans.json.simulationAllowed, false)
  assert.equal(plans.json.mode, 'live')
})

test('webhook falso ou sem assinatura não altera nada', async () => {
  const forged = { type: 'payment', data: { id: '123' } }
  assert.equal((await call('POST', '/billing/webhook?data.id=123&type=payment', { raw: JSON.stringify(forged) })).status, 503) // sem segredo configurado: recusa
  assert.equal((await call('POST', '/billing/webhook?data.id=123&type=payment', { raw: JSON.stringify(forged), headers: { 'x-signature': 'ts=1,v1=abc', 'x-request-id': 'x' } })).status, 503)
})

// ----------------------------------------------------------- autenticação
test('todas as rotas protegidas exigem login', async () => {
  const protectedRoutes = [
    ['GET', '/data/clients'],
    ['POST', '/data/clients'],
    ['GET', '/data/users'],
    ['GET', '/data/settings'],
    ['GET', '/auth/me'],
    ['GET', '/billing/status'],
    ['POST', '/billing/checkout'],
    ['POST', '/billing/cancel'],
    ['GET', '/platform/overview'],
    ['GET', '/platform/companies'],
    ['POST', '/platform/companies/x/grant'],
    ['GET', '/admin/backup'],
    ['POST', '/admin/restore'],
    ['GET', '/admin/companies'],
    ['GET', '/notifications'],
    ['POST', '/files/upload'],
    ['GET', '/files/abc/download'],
    ['GET', '/catalog/leo'],
  ]
  for (const [method, path] of protectedRoutes) {
    const res = await call(method, path, method === 'POST' ? { body: {} } : {})
    assert.equal(res.status, 401, `${method} ${path} respondeu ${res.status}`)
  }
  assert.equal((await call('GET', '/health')).status, 200)
  assert.equal((await call('GET', '/billing/plans')).status, 200)
})

test('token inventado ou adulterado é recusado', async () => {
  assert.equal((await call('GET', '/auth/me', { token: 'a'.repeat(64) })).status, 401)
  const real = A.res.json.token
  const tampered = `${real.slice(0, -1)}${real.endsWith('0') ? '1' : '0'}`
  assert.equal((await call('GET', '/auth/me', { token: tampered })).status, 401)
  assert.equal((await call('GET', '/auth/me', { token: real })).status, 200)
  assert.equal((await call('GET', `/data/clients?token=${'b'.repeat(64)}`)).status, 401)
  // token válido na URL só funciona para download de arquivo, nunca para as demais rotas
  assert.equal((await call('GET', `/data/clients?token=${encodeURIComponent(real)}`)).status, 401)
  assert.equal((await call('GET', `/auth/me?token=${encodeURIComponent(real)}`)).status, 401)
})

test('mensagens de login não revelam se o e-mail existe', async () => {
  const unknown = await login(`nao-existe-${Date.now()}@teste.com`, 'qualquer-senha')
  const wrongPassword = await login(B.email, 'senha-errada-123')
  assert.equal(unknown.status, 401)
  assert.equal(wrongPassword.status, 401)
  assert.equal(unknown.json.error, wrongPassword.json.error)
})

test('troca de senha encerra as outras sessões (token roubado deixa de valer)', async () => {
  const first = await login(A.email, A.password)
  const second = await login(A.email, A.password)
  assert.equal(first.status, 200)
  assert.equal(second.status, 200)
  const changed = await call('POST', '/auth/change-password', { token: first.json.token, body: { currentPassword: A.password, newPassword: 'Outra-Senha-456' } })
  assert.equal(changed.status, 200)
  A.password = 'Outra-Senha-456'
  assert.equal((await call('GET', '/auth/me', { token: first.json.token })).status, 200) // quem trocou segue logado
  assert.equal((await call('GET', '/auth/me', { token: second.json.token })).status, 401) // a outra sessão caiu
  assert.equal((await call('GET', '/auth/me', { token: A.res.json.token })).status, 401) // inclusive a do cadastro
})

// -------------------------------------------------------- isolamento/privilégio
test('uma empresa não acessa arquivos nem dados da outra', async () => {
  const a = (await login(A.email, A.password)).json
  const b = (await login(B.email, B.password)).json
  const client = await call('POST', '/data/clients', { token: a.token, body: { name: 'Cliente secreto da A', type: 'PF' } })
  assert.equal(client.status, 201)
  const upload = await fetch(`${base}/files/upload?name=segredo.txt`, { method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'text/plain' }, body: 'conteúdo confidencial da empresa A' })
  assert.equal(upload.status, 201)
  const file = await upload.json()

  assert.equal((await call('GET', `/data/clients/${client.json.id}`, { token: b.token })).status, 404)
  assert.equal((await call('PUT', `/data/clients/${client.json.id}`, { token: b.token, body: { name: 'invadido' } })).status, 404)
  assert.equal((await call('DELETE', `/data/clients/${client.json.id}`, { token: b.token })).status, 404)
  assert.deepEqual((await call('GET', '/data/clients', { token: b.token })).json, [])
  assert.equal((await call('GET', `/files/${file.id}/download`, { token: b.token })).status, 404)
  assert.equal((await call('GET', `/files/${file.id}/download?token=${encodeURIComponent(b.token)}`)).status, 404)
  assert.equal((await call('GET', `/files/${file.id}/download`, { token: a.token })).status, 200)
})

test('usuário comum não vira administrador nem acessa a plataforma', async () => {
  const owner = (await login(A.email, A.password)).json
  const created = await call('POST', '/data/users', {
    token: owner.token,
    body: { name: 'Vendedor', email: `vendedor-${Date.now()}@teste.com`, password: 'Senha-Forte-123', role: 'comercial' },
  })
  assert.equal(created.status, 201)
  const seller = await login(created.json.email, 'Senha-Forte-123')
  const changed = await call('POST', '/auth/change-password', { token: seller.json.token, body: { currentPassword: 'Senha-Forte-123', newPassword: 'Senha-Do-Vendedor-1' } })
  assert.equal(changed.status, 200)
  const token = seller.json.token
  const myId = seller.json.user.id

  assert.equal((await call('PUT', `/data/users/${myId}`, { token, body: { role: 'admin' } })).status, 403)
  assert.equal((await call('POST', '/data/users', { token, body: { name: 'Outro', email: `x-${Date.now()}@teste.com`, password: 'Senha-Forte-123', role: 'admin' } })).status, 403)
  const profile = await call('PUT', '/auth/profile', { token, body: { name: 'Vendedor Silva', role: 'admin', companyId: 'qualquer', active: false, extraModules: ['settings'] } })
  assert.equal(profile.status, 200)
  assert.equal(profile.json.user.role, 'comercial')
  assert.equal(profile.json.user.companyId, owner.user.companyId)
  assert.notEqual(profile.json.user.active, false)
  assert.equal((await call('GET', '/platform/overview', { token })).status, 403)
  assert.equal((await call('POST', '/admin/restore', { token, body: { collections: { users: [{}] } } })).status, 403)
  assert.equal((await call('POST', '/billing/checkout', { token, body: { paymentMethod: 'pix', pixMonths: 1 } })).status, 403)
  assert.equal((await call('GET', '/data/settings', { token })).status, 200) // leitura de referência continua permitida
  assert.equal((await call('PUT', '/data/settings/company', { token, body: { name: 'Hackeada' } })).status, 403)
})

test('respostas nunca expõem hash de senha nem rastros internos', async () => {
  const a = (await login(A.email, A.password)).json
  const samples = [
    JSON.stringify(a),
    (await call('GET', '/data/users', { token: a.token })).text,
    (await call('GET', '/auth/me', { token: a.token })).text,
    (await call('GET', '/platform/users', { token: masterToken })).text,
    (await call('GET', '/platform/companies', { token: masterToken })).text,
    (await call('GET', '/data/users', { token: masterToken })).text,
  ]
  for (const text of samples) {
    assert.ok(!text.includes('passwordHash'), 'vazou passwordHash')
    assert.ok(!text.includes('scrypt$'), 'vazou hash scrypt')
  }
  const missing = await call('GET', '/rota-que-nao-existe', { token: a.token })
  assert.equal(missing.status, 404)
  assert.ok(!/node:|\.mjs|at \w+ \(/.test(missing.text), 'resposta de erro expõe stack')
})

// ------------------------------------------------------ arquivos e entrada
test('caminhos maliciosos não expõem arquivos do servidor', async () => {
  const paths = [
    '/../backend/server.mjs',
    '/%2e%2e/backend/server.mjs',
    '/..%2fbackend%2fserver.mjs',
    '/site/../../backend/server.mjs',
    '/%2e%2e%2f%2e%2e%2f.env',
    '/.env',
    '/backend/server.mjs',
    '/backend/data/arcoplan-db.json',
    '/package.json',
    '/..\\..\\backend\\server.mjs',
  ]
  for (const path of paths) {
    const res = await rawRequest(path)
    assert.ok(!/createServer|DATABASE_URL|MERCADOPAGO_ACCESS_TOKEN|scrypt|"dependencies"/.test(res.text), `${path} expôs conteúdo (status ${res.status})`)
  }
})

test('páginas estáticas só aceitam GET e HEAD (TRACE, POST e PUT são recusados)', async () => {
  for (const method of ['TRACE', 'POST', 'PUT', 'DELETE', 'PATCH']) {
    const status = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/', method }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      })
      req.on('error', () => resolve(0))
      req.end()
    })
    assert.equal(status, 405, `${method} / respondeu ${status}`)
  }
  assert.equal((await rawRequest('/')).status, 200)
})

test('arquivo HTML enviado por usuário não executa script no domínio do sistema', async () => {
  const a = (await login(A.email, A.password)).json
  const upload = await fetch(`${base}/files/upload?name=evil.html`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'text/html' },
    body: '<script>fetch("/api/auth/me")</script><h1>oi</h1>',
  })
  assert.equal(upload.status, 201)
  const file = await upload.json()
  const download = await call('GET', `/files/${file.id}/download?inline=1`, { token: a.token })
  assert.equal(download.status, 200)
  assert.match(download.headers.get('content-disposition'), /^attachment/)
  assert.match(download.headers.get('content-security-policy'), /sandbox/)
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
})

test('corpo gigante e JSON malformado não derrubam o servidor', async () => {
  const huge = JSON.stringify({ companyName: 'x'.repeat(13 * 1024 * 1024) })
  try {
    const res = await call('POST', '/auth/register-company', { raw: huge })
    assert.equal(res.status, 413)
  } catch {
    /* conexão encerrada pelo servidor também é uma recusa válida */
  }
  const broken = await call('POST', '/auth/login', { raw: '{"login": "a", ' })
  assert.equal(broken.status, 400)
  const wrongType = await call('POST', '/auth/login', { raw: '[1,2,3]' })
  assert.ok([400, 401].includes(wrongType.status))
  assert.equal((await call('GET', '/health')).status, 200)
})

test('cabeçalhos de segurança estão presentes na interface e na API', async () => {
  const page = await rawRequest('/')
  assert.match(page.headers['content-security-policy'], /default-src 'self'/)
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.equal(page.headers['x-frame-options'], 'DENY')
  assert.equal(page.headers['x-content-type-options'], 'nosniff')
  assert.match(page.headers['strict-transport-security'], /max-age=31536000/)
  assert.equal(page.headers['x-powered-by'], undefined)

  const api = await call('GET', '/billing/plans')
  assert.equal(api.headers.get('x-frame-options'), 'DENY')
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(api.headers.get('cache-control'), 'no-store')
})

// ------------------------------------------------------------ força bruta
test('força bruta: após 6 senhas erradas o login é bloqueado, mesmo com a senha certa', async () => {
  const target = await startTrial('forca')
  assert.equal(target.res.status, 201)
  for (let i = 0; i < 6; i++) assert.equal((await login(target.email, `errada-${i}-xyz`)).status, 401)
  const blocked = await login(target.email, target.password)
  assert.equal(blocked.status, 429)
  assert.match(blocked.json.error, /Muitas tentativas/)
})

test('cadastros de teste são limitados por IP e respondem com Retry-After', async () => {
  let created = 0
  let limited = null
  for (let i = 0; i < TRIAL_LIMIT + 3; i++) {
    const attempt = await startTrial('lote')
    if (attempt.res.status === 201) created += 1
    else {
      limited = attempt.res
      break
    }
  }
  assert.ok(limited, 'o limite de cadastros de teste nunca foi acionado')
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  // A, B e "forca" já consumiram parte do limite
  assert.ok(created <= TRIAL_LIMIT - 3)
})
