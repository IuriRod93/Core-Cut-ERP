import net from 'node:net'
import tls from 'node:tls'
import { randomUUID } from 'node:crypto'
import os from 'node:os'

/**
 * Envio de e-mail por SMTP, sem dependências (TLS implícito na 465, STARTTLS na 587, AUTH LOGIN/PLAIN).
 *
 * Variáveis de ambiente:
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE ("true" para 465), SMTP_USER, SMTP_PASS, MAIL_FROM ("Core Cut <contato@cutcore.com.br>")
 *
 * Sem SMTP_HOST o envio fica desligado: as mensagens vão para a caixa de saída em memória
 * (`outbox`, usada nos testes) e um aviso é registrado no log — o sistema continua funcionando.
 */

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64')
const wrap76 = (value) => value.replace(/(.{76})/g, '$1\r\n')
const encodeHeader = (value) => (/^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`)
const bareAddress = (value) => (/<([^>]+)>/.exec(value)?.[1] ?? value).trim()
const noBreaks = (value) => String(value ?? '').replace(/[\r\n]+/g, ' ').trim()

/** Monta a mensagem MIME (texto + HTML). */
export function buildMessage({ from, to, subject, text, html, replyTo, messageId, date = new Date() }) {
  const boundary = `----corecut-${randomUUID()}`
  const host = bareAddress(from).split('@')[1] ?? 'localhost'
  const headers = [
    `From: ${noBreaks(from)}`,
    `To: ${noBreaks(to)}`,
    ...(replyTo && /^[^s@<>]+@[^s@<>]+.[^s@<>]+$/.test(noBreaks(replyTo)) ? [`Reply-To: ${noBreaks(replyTo)}`] : []),
    `Subject: ${encodeHeader(noBreaks(subject))}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId ?? randomUUID()}@${host}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  const part = (type, body) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(b64(body))].join('\r\n')
  const parts = [part('text/plain', text)]
  if (html) parts.push(part('text/html', html))
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}\r\n--${boundary}--\r\n`
}

class Connection {
  constructor(socket) {
    this.buffer = ''
    this.replies = []
    this.waiting = null
    this.error = null
    this.attach(socket)
  }

  attach(socket) {
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      this.buffer += chunk
      this.flush()
    })
    const fail = (error) => {
      this.error = error
      this.waiting?.reject(error)
      this.waiting = null
    }
    socket.on('error', fail)
    socket.on('close', () => fail(new Error('Conexão SMTP encerrada.')))
  }

  flush() {
    let index
    while ((index = this.buffer.indexOf('\r\n')) >= 0) {
      const line = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 2)
      this.current = [...(this.current ?? []), line]
      if (/^\d{3} /.test(line) || /^\d{3}$/.test(line)) {
        this.replies.push({ code: Number(line.slice(0, 3)), lines: this.current })
        this.current = []
      }
    }
    if (this.waiting && this.replies.length) {
      const { resolve } = this.waiting
      this.waiting = null
      resolve(this.replies.shift())
    }
  }

  read(timeoutMs) {
    if (this.replies.length) return Promise.resolve(this.replies.shift())
    if (this.error) return Promise.reject(this.error)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Tempo esgotado aguardando o servidor SMTP.')), timeoutMs)
      this.waiting = {
        resolve: (reply) => (clearTimeout(timer), resolve(reply)),
        reject: (error) => (clearTimeout(timer), reject(error)),
      }
    })
  }

  write(data) {
    this.socket.write(data)
  }
}

/** Envia uma mensagem; lança Error com a resposta do servidor se algo falhar. */
export async function sendSmtp({ host, port = 587, secure = false, user, pass, from, to, subject, text, html, replyTo, timeoutMs = 15000, clientName = os.hostname() || 'localhost' }) {
  const socket = await new Promise((resolve, reject) => {
    const s = secure ? tls.connect({ host, port, servername: host }, () => resolve(s)) : net.connect({ host, port }, () => resolve(s))
    s.once('error', reject)
    s.setTimeout(timeoutMs, () => s.destroy(new Error('Tempo esgotado conectando ao SMTP.')))
  })
  let conn = new Connection(socket)
  const expect = async (codes, label) => {
    const reply = await conn.read(timeoutMs)
    if (!codes.includes(reply.code)) throw new Error(`SMTP ${label}: ${reply.lines.join(' ').slice(0, 200)}`)
    return reply
  }
  const command = async (line, codes, label) => {
    conn.write(`${line}\r\n`)
    return expect(codes, label)
  }
  try {
    await expect([220], 'saudação')
    let hello = await command(`EHLO ${clientName}`, [250], 'EHLO')
    const advertises = (word) => hello.lines.some((l) => new RegExp(`^250[- ]${word}\\b`, 'i').test(l))
    if (!secure && advertises('STARTTLS')) {
      await command('STARTTLS', [220], 'STARTTLS')
      const upgraded = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: conn.socket, servername: host }, () => resolve(t))
        t.once('error', reject)
      })
      conn = new Connection(upgraded)
      hello = await command(`EHLO ${clientName}`, [250], 'EHLO')
    }
    if (user) {
      const methods = hello.lines.find((l) => /^250[- ]AUTH\b/i.test(l)) ?? ''
      if (/\bPLAIN\b/i.test(methods)) await command(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, [235], 'AUTH')
      else if (/\bLOGIN\b/i.test(methods)) {
        await command('AUTH LOGIN', [334], 'AUTH')
        await command(b64(user), [334], 'AUTH')
        await command(b64(pass ?? ''), [235], 'AUTH')
      } else throw new Error('O servidor SMTP não oferece autenticação PLAIN/LOGIN.')
    }
    await command(`MAIL FROM:<${bareAddress(from)}>`, [250], 'MAIL FROM')
    await command(`RCPT TO:<${bareAddress(to)}>`, [250, 251], 'RCPT TO')
    await command('DATA', [354], 'DATA')
    const message = buildMessage({ from, to, subject, text, html, replyTo }).replace(/^\./gm, '..')
    conn.write(`${message}\r\n.\r\n`)
    await expect([250], 'envio')
    conn.socket.write('QUIT\r\n')
  } finally {
    conn.socket.destroy()
    socket.destroy()
  }
}

export function createMailer(env = process.env, { send = sendSmtp } = {}) {
  const host = env.SMTP_HOST ?? ''
  const from = env.MAIL_FROM || (env.SMTP_USER ? `Core Cut <${env.SMTP_USER}>` : '')
  const enabled = Boolean(host && from)
  const outbox = []
  const sent = { ok: 0, failed: 0, lastError: null }

  /** Envia (ou guarda na caixa de saída). Nunca lança: e-mail não pode derrubar o fluxo principal. */
  async function sendMail({ to, subject, text, html, replyTo }) {
    const recipient = noBreaks(to)
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) return { ok: false, reason: 'destinatário inválido' }
    outbox.push({ to: recipient, subject, text, html, at: new Date().toISOString() })
    if (outbox.length > 50) outbox.shift()
    if (!enabled) {
      console.warn(`[email] SMTP não configurado: "${subject}" para ${recipient} não foi enviado.`)
      return { ok: false, reason: 'smtp-desligado' }
    }
    try {
      await send({
        host,
        port: Number(env.SMTP_PORT) || (env.SMTP_SECURE === 'true' ? 465 : 587),
        secure: env.SMTP_SECURE === 'true',
        user: env.SMTP_USER || undefined,
        pass: env.SMTP_PASS || undefined,
        from,
        to: recipient,
        subject,
        text,
        html,
        replyTo,
      })
      sent.ok += 1
      return { ok: true }
    } catch (error) {
      sent.failed += 1
      sent.lastError = String(error?.message ?? error).slice(0, 200)
      console.error('[email] falha ao enviar:', sent.lastError)
      return { ok: false, reason: sent.lastError }
    }
  }

  return { enabled, from, sendMail, outbox, status: () => ({ enabled, host: host || null, from: from || null, ...sent }) }
}
