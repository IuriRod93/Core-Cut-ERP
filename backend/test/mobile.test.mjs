import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFakeFaceEngine, createTickets, euclidean, FACE_MATCH_DISTANCE } from '../lib/face.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-mobile-'))
const apkFile = join(dataDir, 'app-teste.apk')
const versionFile = join(dataDir, 'app-version.json')
const APK_BYTES = Buffer.concat([Buffer.from('PK'), Buffer.from('conteudo-do-apk-de-teste'.repeat(40))])
let child
let base
let admin

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

const call = async (method, path, { body, token } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const buffer = Buffer.from(await res.arrayBuffer())
  let json = null
  try {
    json = JSON.parse(buffer.toString('utf8'))
  } catch {
    /* binário ou vazio */
  }
  return { status: res.status, json, buffer, headers: res.headers }
}

// "fotos" do motor de teste: texto "pessoa:<nome>" já em base64, com tamanho acima do mínimo aceito
const photo = (text) => Buffer.from(`${text}${' '.repeat(260)}`).toString('base64')

before(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}/api`
  writeFileSync(apkFile, APK_BYTES)
  writeFileSync(versionFile, JSON.stringify({ versionName: '9.9.9', versionCode: 99, sizeBytes: APK_BYTES.length, sha256: 'abc', builtAt: '2026-10-15T00:00:00Z' }))
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: { ...process.env, NODE_ENV: 'test', FACE_ENGINE: 'fake', APP_APK_PATH: apkFile, APP_VERSION_PATH: versionFile, DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir, ARCOPLAN_SCHEDULER_MS: '0' },
    stdio: 'pipe',
  })
  let up = false
  for (let i = 0; i < 150 && !up; i++) {
    try {
      up = (await fetch(`${base}/health`)).ok
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  assert.ok(up, 'o servidor de teste não subiu')
  const login = await call('POST', '/auth/login', { body: { login: 'admin', password: 'arcoplan123' } })
  admin = login.json.token
  await call('POST', '/auth/change-password', { token: admin, body: { currentPassword: 'arcoplan123', newPassword: 'Cerejeira-Azul-47' } })
})

after(() => {
  child?.kill()
  rmSync(dataDir, { recursive: true, force: true })
})

test('motor: distância, limite e tíquete com tentativas', () => {
  const engine = createFakeFaceEngine()
  assert.equal(euclidean([0, 0], [3, 4]), 5)
  assert.equal(euclidean([1], [1, 2]), Infinity)
  return engine.describe(Buffer.from('pessoa:ana')).then(async (a) => {
    const b = await engine.describe(Buffer.from('pessoa:ana'))
    const c = await engine.describe(Buffer.from('pessoa:beto'))
    assert.ok(euclidean(a.descriptor, b.descriptor) <= FACE_MATCH_DISTANCE)
    assert.ok(euclidean(a.descriptor, c.descriptor) > FACE_MATCH_DISTANCE)
    const tickets = createTickets({ maxTries: 2 })
    const id = tickets.create('u1')
    assert.ok(tickets.get(id))
    assert.equal(tickets.fail(id), 1)
    assert.equal(tickets.fail(id), 0)
    assert.equal(tickets.get(id), null)
  })
})

test('aplicativo: senha → cadastro do rosto → login só com o mesmo rosto', async () => {
  const mobileLogin = (password) => call('POST', '/mobile/login', { body: { login: 'admin', password, device: { name: 'Galaxy A54', platform: 'android' } } })

  // senha errada não abre nem a etapa do rosto
  const wrong = await mobileLogin('errada-123')
  assert.equal(wrong.status, 401)
  assert.equal(wrong.json.ticket, undefined)

  const first = await mobileLogin('Cerejeira-Azul-47')
  assert.equal(first.status, 200)
  assert.equal(first.json.faceRequired, true)
  assert.equal(first.json.enrolled, false)
  assert.equal(first.json.token, undefined, 'sem rosto não há sessão')
  assert.ok(first.json.ticket)

  // cadastro: precisa de consentimento e de uma foto com um rosto
  const enroll = (ticket, extra) => call('POST', '/mobile/face/enroll', { body: { ticket, ...extra } })
  assert.equal((await enroll(first.json.ticket, { image: photo('pessoa:marcos'), consent: false })).status, 400)
  const none = await enroll(first.json.ticket, { image: photo('sem-rosto'), consent: true })
  assert.equal(none.status, 400)
  assert.match(none.json.error, /rosto/i)
  assert.equal((await enroll(first.json.ticket, { image: photo('dois-rostos'), consent: true })).status, 400)
  assert.equal((await enroll('ticket-que-nao-existe', { image: photo('pessoa:marcos'), consent: true })).status, 401)

  const done = await enroll(first.json.ticket, { image: photo('pessoa:marcos'), consent: true })
  assert.equal(done.status, 200, JSON.stringify(done.json))
  assert.ok(done.json.token)
  assert.equal(done.json.face, true)
  assert.equal(done.json.user.passwordHash, undefined)
  // o tíquete é de uso único
  assert.equal((await enroll(first.json.ticket, { image: photo('pessoa:marcos'), consent: true })).status, 401)

  // próximo login: rosto de outra pessoa é recusado e o tíquete morre depois de 5 erros
  const second = await mobileLogin('Cerejeira-Azul-47')
  assert.equal(second.json.enrolled, true)
  const verify = (ticket, who) => call('POST', '/mobile/face/verify', { body: { ticket, image: photo(who) } })
  const bad = await verify(second.json.ticket, 'pessoa:intruso')
  assert.equal(bad.status, 401)
  assert.equal(bad.json.token, undefined)
  for (let i = 0; i < 4; i++) await verify(second.json.ticket, 'pessoa:intruso')
  assert.equal((await verify(second.json.ticket, 'pessoa:marcos')).status, 401, 'tíquete esgotado não aceita nem o rosto certo')

  const third = await mobileLogin('Cerejeira-Azul-47')
  const ok = await verify(third.json.ticket, 'pessoa:marcos')
  assert.equal(ok.status, 200)
  assert.ok(ok.json.token)
  const me = await call('GET', '/auth/me', { token: ok.json.token })
  assert.equal(me.status, 200)

  // nova checagem ao reabrir o app (sessão já aberta)
  assert.equal((await call('POST', '/mobile/face/recheck', { token: ok.json.token, body: { image: photo('pessoa:marcos') } })).status, 200)
  assert.equal((await call('POST', '/mobile/face/recheck', { token: ok.json.token, body: { image: photo('pessoa:outro') } })).status, 403)
  assert.equal((await call('GET', '/mobile/face/status', { token: ok.json.token })).json.enrolled, true)
  assert.equal((await call('POST', '/mobile/face/recheck', { body: { image: photo('pessoa:marcos') } })).status, 401)
})

test('painel admin: lista cadastros e tentativas com foto, e redefine o rosto', async () => {
  const faces = await call('GET', '/platform/faces', { token: admin })
  assert.equal(faces.status, 200)
  assert.equal(faces.json.profiles.length, 1)
  const profile = faces.json.profiles[0]
  assert.equal(profile.userName.length > 0, true)
  assert.ok(faces.json.checks.some((c) => c.result === 'aprovado'))
  assert.ok(faces.json.checks.some((c) => c.result === 'recusado'))
  assert.ok(faces.json.checks.some((c) => c.result === 'sem_rosto'))
  // nada de vetor nem foto crua na lista
  assert.equal(JSON.stringify(faces.json).includes('descriptor'), false)

  const image = await call('GET', `/platform/faces/profile/${profile.id}/photo`, { token: admin })
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/jpeg')
  assert.match(image.buffer.toString('utf8'), /^pessoa:marcos/)
  const checkWithPhoto = faces.json.checks.find((c) => c.hasPhoto)
  assert.equal((await call('GET', `/platform/faces/check/${checkWithPhoto.id}/photo`, { token: admin })).status, 200)

  // somente a administração da plataforma
  const mobile = await call('POST', '/mobile/login', { body: { login: 'admin', password: 'Cerejeira-Azul-47' } })
  const ticket = mobile.json.ticket
  const session = await call('POST', '/mobile/face/verify', { body: { ticket, image: photo('pessoa:marcos') } })
  assert.equal((await call('GET', '/platform/faces', { token: session.json.token })).status, 200, 'o admin da plataforma é o mesmo usuário')
  assert.equal((await call('GET', '/platform/faces')).status, 401)

  // redefinir: o usuário cadastra de novo no próximo login
  assert.equal((await call('POST', `/platform/faces/profile/${profile.id}/revoke`, { token: admin })).status, 200)
  const again = await call('POST', '/mobile/login', { body: { login: 'admin', password: 'Cerejeira-Azul-47' } })
  assert.equal(again.json.enrolled, false)
})

test('aplicativo: o cadastro do rosto não pede código do autenticador (2FA do site foi removido)', async () => {
  const email = `rosto${Date.now()}@oficina.com.br`
  const signup = await call('POST', '/auth/register-company', {
    body: { companyName: 'Oficina Rosto', ownerName: 'Rita Rosto', email, password: 'Senha-Forte-123', planId: 'profissional', phone: '21999990002', trial: true, acceptTerms: true, document: `${Math.floor(Math.random() * 1e11)}` },
  })
  assert.ok([200, 201].includes(signup.status), JSON.stringify(signup.json))

  const start = await call('POST', '/mobile/login', { body: { login: email, password: 'Senha-Forte-123' } })
  assert.equal(start.status, 200)
  assert.equal(start.json.needsCode, undefined)
  const enrolled = await call('POST', '/mobile/face/enroll', { body: { ticket: start.json.ticket, image: photo('pessoa:rita'), consent: true } })
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.json))
})

test('motor real (WebAssembly): carrega os modelos e recusa foto sem rosto', async () => {
  const { createFaceEngine } = await import('../lib/face.mjs')
  const jpeg = (await import('jpeg-js')).default
  const engine = createFaceEngine()
  const status = await engine.available()
  assert.equal(status.ok, true, status.reason)
  const gray = Buffer.alloc(320 * 320 * 4, 170)
  const encoded = jpeg.encode({ data: gray, width: 320, height: 320 }, 80).data
  const result = await engine.describe(encoded)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'sem_rosto')
  assert.deepEqual(await engine.describe(Buffer.from('isto não é um jpeg '.repeat(20))), { ok: false, reason: 'imagem_invalida' })
})

test('painel admin: atividade mostra site e aplicativo, pedidos de nova senha e falhas', async () => {
  // site: login com senha errada; app (cabeçalho do aplicativo) com senha errada; pedidos de nova senha
  await call('POST', '/auth/login', { body: { login: 'admin', password: 'errada-site-1' } })
  await fetch(`${base}/mobile/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Client': 'corecut-app/1.0 (Galaxy A54 · Android 15)' }, body: JSON.stringify({ login: 'admin', password: 'errada-app-1' }) })
  await call('POST', '/auth/forgot-password', { body: { email: 'ninguem-cadastrado@exemplo.com' } })
  await call('POST', '/auth/forgot-password', { body: { email: 'admin@corecut.local' } })

  const r = await call('GET', '/platform/activity?limit=500', { token: admin })
  assert.equal(r.status, 200)
  const { items, summary, users } = r.json
  assert.ok(items.length > 10)

  const appFail = items.find((i) => i.action === 'login_failed' && i.channel === 'app')
  assert.ok(appFail, 'falha pelo app aparece como canal "app"')
  assert.match(appFail.device, /Galaxy A54/)
  assert.ok(items.some((i) => i.action === 'login_failed' && i.channel === 'site'), 'falha pelo site aparece como "site"')
  assert.ok(items.some((i) => i.action === 'face_enroll' && i.channel === 'app'))
  assert.ok(items.some((i) => i.action === 'login' && i.channel === 'app'), 'entrada concluída pelo app')
  assert.ok(items.some((i) => i.action === 'password_reset_requested'), 'pedido de nova senha de usuário existente')
  assert.ok(items.some((i) => i.action === 'password_reset_unknown'), 'pedido para e-mail não cadastrado também fica visível')
  assert.ok(items.every((i) => !JSON.stringify(i).includes('passwordHash')))

  assert.ok(summary.appLogins24h >= 1)
  assert.ok(summary.failures24h >= 2)
  assert.ok(summary.resetRequests24h >= 2)
  assert.ok(summary.appUsers7d >= 1)
  assert.ok(users.some((u) => u.app > 0))

  // filtros
  const onlyApp = (await call('GET', '/platform/activity?channel=app', { token: admin })).json.items
  assert.ok(onlyApp.length > 0 && onlyApp.every((i) => i.channel === 'app'))
  const onlyPasswords = (await call('GET', '/platform/activity?kind=senha', { token: admin })).json.items
  assert.ok(onlyPasswords.length >= 2 && onlyPasswords.every((i) => i.kind === 'senha'))

  // quem entra no painel é só a plataforma
  assert.equal((await call('GET', '/platform/activity')).status, 401)

  // a lista de acessos também informa o canal
  const logins = (await call('GET', '/platform/logins?limit=100', { token: admin })).json.items
  assert.ok(logins.some((l) => l.channel === 'app'))
  assert.ok(logins.some((l) => l.channel === 'site'))

  // o motor aparece no painel facial
  const faces = (await call('GET', '/platform/faces', { token: admin })).json
  assert.equal(faces.engine.ok, true)
})

test('plano: o aplicativo é direito do Profissional e do Industrial; o Essencial não entra nem baixa', async () => {
  const signup = async (planId) => {
    const email = `app-${planId}-${Date.now()}@oficina.com.br`
    const r = await call('POST', '/auth/register-company', {
      body: { companyName: `Oficina ${planId}`, ownerName: 'Dono App', email, password: 'Senha-Forte-123', planId, phone: '21999990003', trial: true, acceptTerms: true, document: `${Math.floor(Math.random() * 1e11)}` },
    })
    assert.ok([200, 201].includes(r.status), JSON.stringify(r.json))
    return { email, token: r.json.token }
  }

  // Essencial: o app recusa a entrada e o download não é liberado
  const basic = await signup('essencial')
  const blocked = await call('POST', '/mobile/login', { body: { login: basic.email, password: 'Senha-Forte-123' } })
  assert.equal(blocked.status, 403)
  assert.match(blocked.json.error, /Profissional e Industrial/)
  const infoBasic = await call('GET', '/mobile/app-info', { token: basic.token })
  assert.equal(infoBasic.json.eligible, false)
  assert.equal(infoBasic.json.reason, 'plano')
  assert.equal((await call('POST', '/mobile/download-link', { token: basic.token })).status, 403)

  // Profissional: libera a entrada e o download
  const pro = await signup('profissional')
  const start = await call('POST', '/mobile/login', { body: { login: pro.email, password: 'Senha-Forte-123' } })
  assert.equal(start.status, 200)
  const info = await call('GET', '/mobile/app-info', { token: pro.token })
  assert.equal(info.json.eligible, true)
  assert.equal(info.json.version.versionName, '9.9.9')
  assert.equal(info.json.available, true)

  const link = await call('POST', '/mobile/download-link', { token: pro.token })
  assert.equal(link.status, 200)
  assert.match(link.json.url, /^\/api\/public\/app-download\/[0-9a-f]{48}$/)
  const file = await fetch(`${base.replace(/\/api$/, '')}${link.json.url}`)
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'application/vnd.android.package-archive')
  assert.match(file.headers.get('content-disposition') ?? '', /attachment/)
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), APK_BYTES)

  // o link tem 3 usos e depois expira; um código inventado não baixa nada
  for (let i = 0; i < 2; i++) assert.equal((await fetch(`${base.replace(/\/api$/, '')}${link.json.url}`)).status, 200)
  assert.equal((await fetch(`${base.replace(/\/api$/, '')}${link.json.url}`)).status, 410)
  assert.equal((await fetch(`${base.replace(/\/api$/, '')}/api/public/app-download/${'0'.repeat(48)}`)).status, 410)

  // sem login não existe link de download
  assert.equal((await call('POST', '/mobile/download-link')).status, 401)
  // o arquivo não está mais na pasta pública
  assert.notEqual((await fetch(`${base.replace(/\/api$/, '')}/downloads/core-cut-erp.apk`)).headers.get('content-type'), 'application/vnd.android.package-archive')

  // aparece no painel
  const items = (await call('GET', '/platform/activity?limit=800', { token: admin })).json.items
  assert.ok(items.some((i) => i.action === 'app_download'))
  assert.ok(items.some((i) => i.action === 'app_blocked_plan'))
})
