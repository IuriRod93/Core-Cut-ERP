import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMessage, createMailer } from '../lib/mailer.mjs'
import { createBillingEmails } from '../lib/billing-emails.mjs'
import { emails } from '../lib/emails.mjs'
import { stopServer } from './helpers.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = 4900 + Math.floor(Math.random() * 150)
const smtpPort = 2500 + Math.floor(Math.random() * 400)
const base = `http://127.0.0.1:${port}/api`
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-mail-'))
const inbox = []
let child
let smtp

/** SMTP mínimo (sem TLS) com AUTH PLAIN: guarda as mensagens recebidas. */
function startFakeSmtp() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.setEncoding('utf8')
      let mode = 'cmd'
      let data = ''
      let current = { from: '', to: [], auth: false }
      let buffer = ''
      socket.write('220 fake ESMTP\r\n')
      socket.on('data', (chunk) => {
        buffer += chunk
        for (;;) {
          if (mode === 'data') {
            const end = buffer.indexOf('\r\n.\r\n')
            if (end < 0) return
            data = buffer.slice(0, end)
            buffer = buffer.slice(end + 5)
            inbox.push({ ...current, raw: data })
            current = { from: '', to: [], auth: false }
            mode = 'cmd'
            socket.write('250 queued\r\n')
            continue
          }
          const index = buffer.indexOf('\r\n')
          if (index < 0) return
          const line = buffer.slice(0, index)
          buffer = buffer.slice(index + 2)
          if (/^EHLO/i.test(line)) socket.write('250-fake\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n')
          else if (/^AUTH PLAIN/i.test(line)) {
            const [, user, pass] = Buffer.from(line.slice(11), 'base64').toString().split('\0')
            if (user === 'robo@cutcore.test' && pass === 'segredo') {
              current.auth = true
              socket.write('235 ok\r\n')
            } else socket.write('535 bad credentials\r\n')
          } else if (/^MAIL FROM/i.test(line)) {
            current.from = line.slice(10)
            socket.write('250 ok\r\n')
          } else if (/^RCPT TO/i.test(line)) {
            current.to.push(line.slice(8))
            socket.write('250 ok\r\n')
          } else if (/^DATA/i.test(line)) {
            mode = 'data'
            socket.write('354 go\r\n')
          } else if (/^QUIT/i.test(line)) {
            socket.end('221 bye\r\n')
            return
          } else socket.write('250 ok\r\n')
        }
      })
      socket.on('error', () => undefined)
    })
    server.listen(smtpPort, '127.0.0.1', () => resolve(server))
  })
}

const decodeBody = (raw) => {
  const parts = raw.split(/\r\n--[^\r\n]+\r\n/)
  const decoded = []
  for (const part of parts) {
    const match = /Content-Transfer-Encoding: base64\r\n\r\n([\s\S]+?)(?:\r\n--|$)/.exec(part)
    if (match) decoded.push(Buffer.from(match[1].replace(/\r\n/g, ''), 'base64').toString('utf8'))
  }
  return decoded.join('\n')
}

const waitForMail = async (to, count = 1) => {
  for (let i = 0; i < 200; i++) {
    const found = inbox.filter((m) => m.to.some((t) => t.includes(to)))
    if (found.length >= count) return found
    await new Promise((r) => setTimeout(r, 50))
  }
  return inbox.filter((m) => m.to.some((t) => t.includes(to)))
}

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

before(async () => {
  smtp = await startFakeSmtp()
  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: '',
      PORT: String(port),
      HOST: '127.0.0.1',
      ARCOPLAN_DATA_DIR: dataDir,
      ARCOPLAN_SCHEDULER_MS: '0',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(smtpPort),
      SMTP_USER: 'robo@cutcore.test',
      SMTP_PASS: 'segredo',
      MAIL_FROM: 'Core Cut <robo@cutcore.test>',
      APP_URL: 'http://localhost:5174',
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
})

after(async () => {
  await stopServer(child)
  smtp?.close()
  rmSync(dataDir, { recursive: true, force: true })
})

test('mensagem MIME: assunto acentuado codificado e corpo em texto + HTML', () => {
  const raw = buildMessage({ from: 'Core Cut <a@cutcore.com.br>', to: 'b@x.com', subject: 'Redefinição de senha', text: 'Olá, ação', html: '<p>Olá</p>' })
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m)
  assert.match(raw, /multipart\/alternative/)
  assert.equal(decodeBody(raw).includes('Olá, ação'), true)
  assert.ok(!/[\r\n]Bcc:/i.test(raw))
  // quebra de linha no assunto não injeta cabeçalhos
  const injected = buildMessage({ from: 'a@x.com', to: 'b@x.com', subject: 'x\r\nBcc: v@x.com', text: 't' })
  assert.ok(!/^Bcc:/m.test(injected))
})

test('mailer sem SMTP não quebra: guarda na caixa de saída', async () => {
  const mailer = createMailer({})
  assert.equal(mailer.enabled, false)
  const r = await mailer.sendMail({ to: 'cliente@exemplo.com', subject: 'Oi', text: 'x' })
  assert.equal(r.ok, false)
  assert.equal(mailer.outbox.length, 1)
  assert.equal((await mailer.sendMail({ to: 'nao-e-email', subject: 'x', text: 'y' })).ok, false)
})

test('recuperação de senha: e-mail com link de uso único, sem revelar se o e-mail existe', async () => {
  const email = `maria${Date.now()}@oficina.com.br`
  const signup = await call('POST', '/auth/register-company', {
    body: { companyName: 'Oficina Maria', ownerName: 'Maria Souza', email, password: 'Senha-Antiga-1', planId: 'essencial', phone: '21999990000', trial: true, acceptTerms: true, document: `${Math.floor(Math.random() * 1e11)}` },
  })
  assert.ok([200, 201].includes(signup.status), JSON.stringify(signup.json))
  const oldToken = signup.json.token
  assert.ok(oldToken)

  const unknown = await call('POST', '/auth/forgot-password', { body: { email: 'ninguem@inexistente.com' } })
  const known = await call('POST', '/auth/forgot-password', { body: { email } })
  assert.equal(unknown.status, 200)
  assert.equal(known.status, 200)
  assert.deepEqual(unknown.json, known.json)

  const [mail] = await waitForMail(email)
  assert.ok(mail, 'o e-mail de redefinição deve chegar')
  assert.ok(mail.auth, 'o cliente SMTP autentica')
  const text = decodeBody(mail.raw)
  const link = /http:\/\/localhost:5174\/redefinir-senha\?token=([0-9a-f]{64})/.exec(text)
  assert.ok(link, 'o e-mail traz o link com o token')
  assert.equal((await waitForMail('ninguem@inexistente.com')).length, 0)

  // token inválido e senha curta
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: 'a'.repeat(64), newPassword: 'NovaSenha-2024' } })).status, 400)
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: link[1], newPassword: 'curta' } })).status, 400)

  const reset = await call('POST', '/auth/reset-password', { body: { token: link[1], newPassword: 'NovaSenha-2024' } })
  assert.equal(reset.status, 200)
  // uso único
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: link[1], newPassword: 'OutraSenha-2024' } })).status, 400)
  // a sessão antiga caiu e a senha nova funciona
  assert.equal((await call('GET', '/auth/me', { token: oldToken })).status, 401)
  assert.equal((await call('POST', '/auth/login', { body: { login: email, password: 'Senha-Antiga-1' } })).status, 401)
  assert.equal((await call('POST', '/auth/login', { body: { login: email, password: 'NovaSenha-2024' } })).status, 200)
})

test('recuperação de senha: só o último link vale e há limite por e-mail', async () => {
  const email = `joao${Date.now()}@oficina.com.br`
  const signup = await call('POST', '/auth/register-company', {
    body: { companyName: 'Oficina João', ownerName: 'João Lima', email, password: 'Senha-Antiga-1', planId: 'essencial', phone: '21999990001', trial: true, acceptTerms: true, document: `${Math.floor(Math.random() * 1e11)}` },
  })
  assert.ok([200, 201].includes(signup.status), JSON.stringify(signup.json))
  // os e-mails saem sem esperar a resposta: espera o primeiro chegar para a ordem ser previsível
  await call('POST', '/auth/forgot-password', { body: { email } })
  await waitForMail(email, 1)
  await call('POST', '/auth/forgot-password', { body: { email } })
  const mails = await waitForMail(email, 2)
  assert.equal(mails.length, 2)
  const tokens = mails.map((m) => /token=([0-9a-f]{64})/.exec(decodeBody(m.raw))[1])
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: tokens[0], newPassword: 'NovaSenha-2024' } })).status, 400)
  assert.equal((await call('POST', '/auth/reset-password', { body: { token: tokens[1], newPassword: 'NovaSenha-2024' } })).status, 200)
  // 3 pedidos por hora por e-mail: o 4º é barrado
  await call('POST', '/auth/forgot-password', { body: { email } })
  assert.equal((await call('POST', '/auth/forgot-password', { body: { email } })).status, 429)
})

test('e-mails de cobrança: uma vez por situação, só para o titular, sem repetir', async () => {
  const day = 86400000
  const T = Date.parse('2026-10-13T12:00:00Z')
  const users = [
    { id: 'u1', companyId: 'c1', companyRole: 'owner', name: 'Ana Dona', email: 'ana@c1.com', active: true },
    { id: 'u2', companyId: 'c1', companyRole: 'member', name: 'Bia', email: 'bia@c1.com', active: true },
    { id: 'u3', companyId: 'c2', companyRole: 'owner', name: 'Caio', email: 'caio@c2.com', active: true },
    { id: 'u4', companyId: 'c3', companyRole: 'owner', name: 'Duda', email: 'duda@c3.com', active: true },
    { id: 'u5', companyId: 'c4', companyRole: 'owner', name: 'Edu', email: 'edu@c4.com', active: true },
  ]
  const companies = [
    { id: 'c1', name: 'C1', status: 'trial', trialEndsAt: new Date(T + 6 * 3600000).toISOString() }, // teste acabando
    { id: 'c2', name: 'C2', status: 'active', billingMethod: 'pix', paidUntil: new Date(T + 2 * day).toISOString() }, // PIX vencendo
    { id: 'c3', name: 'C3', status: 'active', billingMethod: 'card', paidUntil: new Date(T + 2 * day).toISOString() }, // cartão renova sozinho
    { id: 'c4', name: 'C4', status: 'active', billingMethod: 'pix', paidUntil: new Date(T - 5 * day).toISOString() }, // vencido há 5 dias
  ]
  const db = {
    all: (name) => (name === 'users' ? users : name === 'companies' ? companies : []),
    update: (name, id, patch) => Object.assign(companies.find((c) => c.id === id), patch),
  }
  const sent = []
  const mailer = { sendMail: async (m) => (sent.push(m), { ok: true }) }
  const be = createBillingEmails({ db, mailer, appUrl: () => 'https://www.cutcore.com.br', now: () => T })
  const first = await be.run()
  assert.deepEqual(first, { trialEnding: 1, expiring: 1, expired: 1 })
  assert.deepEqual(sent.map((m) => m.to).sort(), ['ana@c1.com', 'caio@c2.com', 'edu@c4.com'])
  assert.ok(sent.every((m) => m.html.includes('https://www.cutcore.com.br')))
  // segunda rodada: nada novo
  const again = await be.run()
  assert.deepEqual(again, { trialEnding: 0, expiring: 0, expired: 0 })
  assert.equal(sent.length, 3)
  assert.match(emails.paymentApproved({ name: 'Ana', companyName: 'C1', planName: 'Pro', validUntil: companies[1].paidUntil }).text, /liberado até/)
})

test('painel: e-mail de teste usa o SMTP configurado e é exclusivo da plataforma', async () => {
  const login = await call('POST', '/auth/login', { body: { login: 'admin', password: 'arcoplan123' } })
  assert.equal(login.status, 200)
  const token = login.json.token
  assert.equal((await call('POST', '/auth/change-password', { token, body: { currentPassword: 'arcoplan123', newPassword: 'Senha-Forte-123' } })).status, 200)
  const sent = await call('POST', '/platform/email-test', { token, body: { to: 'dono@cutcore.test' } })
  assert.equal(sent.status, 200)
  assert.equal(sent.json.ok, true)
  assert.equal(sent.json.email.enabled, true)
  const [mail] = await waitForMail('dono@cutcore.test')
  assert.ok(mail)
  assert.match(decodeBody(mail.raw), /e-mail de teste/)
  const monitor = (await call('GET', '/platform/monitor', { token })).json
  assert.equal(monitor.email.enabled, true)
  assert.ok(monitor.email.ok >= 1)
  assert.equal((await call('POST', '/platform/email-test', { body: { to: 'x@y.com' } })).status, 401)
})
