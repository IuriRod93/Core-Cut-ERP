// Varredura de segurança "caixa-preta" (somente leitura) contra um site publicado.
//   npm run security:scan                              # usa https://www.cutcore.com.br
//   npm run security:scan -- https://outro-endereco    # outro alvo
//
// Faz poucas requisições comuns de um navegador: cabeçalhos, HTTPS/TLS, arquivos que não
// deveriam estar expostos, rotas protegidas, CORS e portas abertas. Não tenta senhas nem
// derruba nada.
import tls from 'node:tls'
import net from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { pathToFileURL } from 'node:url'

const SEVERITY = { fail: '\x1b[31mFALHA \x1b[0m', warn: '\x1b[33mATENÇÃO\x1b[0m', pass: '\x1b[32mOK     \x1b[0m', info: '\x1b[36minfo   \x1b[0m' }

const request = async (url, { method = 'GET', headers = {}, body, redirect = 'manual', timeout = 15_000 } = {}) => {
  try {
    const response = await fetch(url, { method, headers, body, redirect, signal: AbortSignal.timeout(timeout) })
    const text = await response.text().catch(() => '')
    return { status: response.status, headers: response.headers, text }
  } catch (error) {
    return { status: 0, headers: new Headers(), text: '', error: error?.cause?.code ?? error?.message ?? String(error) }
  }
}

/** Requisição com método arbitrário (o fetch do Node não permite TRACE/CONNECT). */
const rawMethod = (method, target, timeout = 10_000) =>
  new Promise((resolve) => {
    const url = new URL(target)
    const client = url.protocol === 'https:' ? https : http
    const req = client.request({ method, hostname: url.hostname, port: url.port || undefined, path: url.pathname, timeout }, (res) => {
      let text = ''
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode, text }))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve({ status: 0, text: '' }))
    req.end()
  })

const tcp = (host, port, timeout = 3000) =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const done = (open) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })

const tlsProbe = (host, options = {}) =>
  new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, ...options }, () => {
      const certificate = socket.getPeerCertificate()
      const result = { ok: true, protocol: socket.getProtocol(), authorized: socket.authorized, authError: socket.authorizationError, validTo: certificate?.valid_to, subject: certificate?.subject?.CN }
      socket.end()
      resolve(result)
    })
    socket.setTimeout(8000, () => {
      socket.destroy()
      resolve({ ok: false })
    })
    socket.once('error', (error) => resolve({ ok: false, error: error.code ?? error.message }))
  })

/** Executa a varredura e devolve `{ results, summary }`. */
export async function runScan(target, { transport = true, ports = true, log = () => {} } = {}) {
  const base = String(target).replace(/\/$/, '')
  const url = new URL(base)
  const results = []
  const add = (level, area, title, detail = '') => {
    results.push({ level, area, title, detail })
    log({ level, area, title, detail })
  }

  // ------------------------------------------------------------- transporte
  if (transport && url.protocol === 'https:') {
    const plain = await request(`http://${url.host}/`)
    const location = plain.headers.get('location') ?? ''
    if ([301, 302, 307, 308].includes(plain.status) && location.startsWith('https://')) add('pass', 'Transporte', 'HTTP redireciona para HTTPS', `${plain.status} → ${location}`)
    else add('fail', 'Transporte', 'HTTP não redireciona para HTTPS', `status ${plain.status} ${plain.error ?? ''}`)

    const probe = await tlsProbe(url.hostname)
    if (!probe.ok) add('fail', 'Transporte', 'Não foi possível negociar TLS', probe.error ?? '')
    else {
      add(probe.authorized ? 'pass' : 'fail', 'Transporte', probe.authorized ? 'Certificado válido e confiável' : 'Certificado não confiável', probe.authError ?? probe.subject ?? '')
      const days = Math.floor((Date.parse(probe.validTo) - Date.now()) / 86_400_000)
      add(days > 14 ? 'pass' : days > 0 ? 'warn' : 'fail', 'Transporte', `Certificado vence em ${days} dia(s)`, probe.validTo)
      add(['TLSv1.3', 'TLSv1.2'].includes(probe.protocol) ? 'pass' : 'warn', 'Transporte', `Protocolo negociado: ${probe.protocol}`)
    }
    const legacy = await tlsProbe(url.hostname, { maxVersion: 'TLSv1.1', minVersion: 'TLSv1' })
    add(legacy.ok ? 'fail' : 'pass', 'Transporte', legacy.ok ? 'Aceita TLS 1.0/1.1 (obsoleto)' : 'Recusa TLS 1.0/1.1')
  }

  // ------------------------------------------------------------ cabeçalhos
  const home = await request(`${base}/`)
  if (home.status !== 200) add('fail', 'Disponibilidade', `Página inicial respondeu ${home.status}`, home.error ?? '')
  else add('pass', 'Disponibilidade', 'Página inicial responde 200')
  const h = (name) => home.headers.get(name) ?? ''
  const hsts = h('strict-transport-security')
  if (url.protocol === 'https:' && transport) {
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)
    add(maxAge >= 15_552_000 ? 'pass' : hsts ? 'warn' : 'fail', 'Cabeçalhos', 'Strict-Transport-Security (HSTS)', hsts || 'ausente')
  }
  const csp = h('content-security-policy')
  add(/default-src 'self'/.test(csp) ? 'pass' : 'fail', 'Cabeçalhos', 'Content-Security-Policy restritiva', csp ? csp.slice(0, 90) : 'ausente')
  add(/frame-ancestors 'none'/.test(csp) || /deny/i.test(h('x-frame-options')) ? 'pass' : 'fail', 'Cabeçalhos', 'Proteção contra clickjacking (frame-ancestors / X-Frame-Options)')
  add(/nosniff/i.test(h('x-content-type-options')) ? 'pass' : 'fail', 'Cabeçalhos', 'X-Content-Type-Options: nosniff')
  add(h('referrer-policy') ? 'pass' : 'warn', 'Cabeçalhos', 'Referrer-Policy', h('referrer-policy') || 'ausente')
  add(h('permissions-policy') ? 'pass' : 'warn', 'Cabeçalhos', 'Permissions-Policy', h('permissions-policy') ? 'definida' : 'ausente')
  const server = h('server')
  add(!server ? 'pass' : 'warn', 'Cabeçalhos', 'Não revela o software do servidor', server ? `Server: ${server}` : 'sem cabeçalho Server')
  add(!h('x-powered-by') ? 'pass' : 'warn', 'Cabeçalhos', 'Sem X-Powered-By', h('x-powered-by'))
  add(!home.headers.get('set-cookie') ? 'pass' : 'info', 'Cabeçalhos', 'Sem cookies na página pública (sessão não é cookie → imune a CSRF)')

  // -------------------------------------------------------- arquivos expostos
  const sensitive = ['/.env', '/.env.production', '/.git/config', '/package.json', '/package-lock.json', '/backend/server.mjs', '/backend/data/arcoplan-db.json', '/deploy/.env', '/docker-compose.yml', '/deploy/docker-compose.yml', '/Dockerfile', '/node_modules/.package-lock.json', '/src/main.tsx', '/vite.config.ts']
  const leaked = []
  for (const path of sensitive) {
    const res = await request(`${base}${path}`)
    const isSpaFallback = /<div id="root">/.test(res.text)
    const looksSensitive = /DATABASE_URL|MERCADOPAGO|POSTGRES_PASSWORD|createServer|"dependencies"|\[core\]|FROM node/.test(res.text)
    if (res.status === 200 && !isSpaFallback && looksSensitive) leaked.push(path)
  }
  add(leaked.length === 0 ? 'pass' : 'fail', 'Exposição', leaked.length === 0 ? `${sensitive.length} arquivos sensíveis comuns não estão acessíveis` : 'Arquivos sensíveis acessíveis', leaked.join(', '))

  const scriptSrc = /\/assets\/index-[A-Za-z0-9_-]+\.js/.exec(home.text)?.[0]
  if (scriptSrc) {
    const map = await request(`${base}${scriptSrc}.map`)
    add(map.status === 200 && !/<div id="root">/.test(map.text) ? 'warn' : 'pass', 'Exposição', 'Source maps do front-end não publicados')
  }
  const listing = await request(`${base}/assets/`)
  add(/Index of|Directory listing/i.test(listing.text) ? 'fail' : 'pass', 'Exposição', 'Sem listagem de diretórios')

  // código das telas internas: não deve ser entregue sem sessão
  if (scriptSrc) {
    const entry = await request(`${base}${scriptSrc}`)
    const lazy = [...entry.text.matchAll(/import\(\s*["'`]\.\/([A-Za-z0-9_.-]+\.js)["'`]\s*\)/g)].map((m) => m[1])
    const internal = lazy.find((name) => /^(AppShell|Budgets|CutPlan|Financial|Invoices|Settings|PlatformAdmin)-/.test(name))
    if (internal) {
      const chunk = await request(`${base}/assets/${internal}`)
      add(chunk.status === 403 ? 'pass' : 'warn', 'Exposição', chunk.status === 403 ? 'Código das telas internas só é entregue com sessão' : 'Código das telas internas é público', `${internal} → ${chunk.status}`)
    }
    const worker = await request(`${base}/sw.js`)
    const listed = (worker.text.match(/assets\/[A-Za-z0-9_.-]+\.js/g) ?? []).length
    add(listed === 0 ? 'pass' : 'warn', 'Exposição', listed === 0 ? 'sw.js não lista os arquivos do aplicativo' : 'sw.js lista arquivos do aplicativo', listed ? `${listed} arquivo(s) .js` : undefined)
  }

  // ----------------------------------------------------------------- API
  const protectedRoutes = ['/api/data/users', '/api/data/clients', '/api/auth/me', '/api/billing/status', '/api/platform/overview', '/api/platform/companies', '/api/platform/users', '/api/admin/backup', '/api/notifications']
  const open = []
  for (const path of protectedRoutes) {
    const res = await request(`${base}${path}`)
    if (res.status !== 401) open.push(`${path} → ${res.status}`)
  }
  add(open.length === 0 ? 'pass' : 'fail', 'API', open.length === 0 ? `${protectedRoutes.length} rotas protegidas exigem login (401)` : 'Rotas sem autenticação', open.join('; '))

  const forged = await request(`${base}/api/data/users`, { headers: { Authorization: `Bearer ${'a'.repeat(64)}` } })
  add(forged.status === 401 ? 'pass' : 'fail', 'API', 'Token inventado é recusado', `status ${forged.status}`)

  const urlToken = await request(`${base}/api/data/users?token=${'b'.repeat(64)}`)
  add(urlToken.status === 401 ? 'pass' : 'fail', 'API', 'Token na URL não vale para dados', `status ${urlToken.status}`)

  const login = await request(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: `scan-${Date.now()}@teste.invalid`, password: 'senha-de-teste-do-scan' }) })
  add(login.status === 401 ? 'pass' : 'warn', 'API', 'Login inválido devolve 401 genérico', `status ${login.status} ${login.text.slice(0, 70)}`)

  const broken = await request(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"login": ' })
  add(broken.status === 400 ? 'pass' : 'warn', 'API', 'JSON malformado devolve 400 (sem erro 500)', `status ${broken.status}`)

  const missing = await request(`${base}/api/nao-existe-${Date.now()}`)
  add(!/node:|\.mjs|\bat \w+ \(/.test(missing.text) ? 'pass' : 'fail', 'API', 'Erros não vazam stack trace', `status ${missing.status}`)

  const cors = await request(`${base}/api/billing/plans`, { headers: { Origin: 'https://site-malicioso.example' } })
  const allow = cors.headers.get('access-control-allow-origin')
  add(!allow ? 'pass' : 'fail', 'API', 'CORS não libera outras origens', allow ? `Access-Control-Allow-Origin: ${allow}` : 'sem cabeçalho CORS')

  const trace = await rawMethod('TRACE', `${base}/`)
  add(!/TRACE \//.test(trace.text) && trace.status !== 200 ? 'pass' : 'fail', 'API', 'Método TRACE não ecoa a requisição', `status ${trace.status}`)

  const traversal = await request(`${base}/%2e%2e/%2e%2e/etc/passwd`)
  add(!/root:.*:0:0/.test(traversal.text) ? 'pass' : 'fail', 'API', 'Sem path traversal')

  const forgedWebhook = await request(`${base}/api/billing/webhook?data.id=1&type=payment`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': 'ts=1,v1=00', 'x-request-id': 'scan' }, body: '{"type":"payment","data":{"id":"1"}}' })
  add([400, 503].includes(forgedWebhook.status) ? 'pass' : 'fail', 'API', 'Webhook com assinatura falsa é recusado', `status ${forgedWebhook.status}`)

  const health = await request(`${base}/api/health`)
  add('info', 'API', 'Rota /api/health pública', health.text.slice(0, 110))

  // ---------------------------------------------------------------- portas
  if (ports) {
    const host = url.hostname
    const risky = [[21, 'FTP'], [23, 'Telnet'], [25, 'SMTP'], [3306, 'MySQL'], [5432, 'PostgreSQL'], [6379, 'Redis'], [27017, 'MongoDB'], [9200, 'Elasticsearch'], [4400, 'API (porta interna)'], [8080, 'HTTP alternativo'], [2375, 'Docker API'], [5900, 'VNC']]
    const exposed = []
    for (const [port, name] of risky) if (await tcp(host, port)) exposed.push(`${port}/${name}`)
    add(exposed.length === 0 ? 'pass' : 'fail', 'Portas', exposed.length === 0 ? 'Banco de dados e portas internas não estão expostas' : 'Portas sensíveis abertas para a internet', exposed.join(', '))
    const ssh = await tcp(host, 22)
    add(ssh ? 'info' : 'pass', 'Portas', ssh ? 'SSH (22) aberto — use chave e desative a senha de root; fail2ban protege contra força bruta' : 'SSH fechado')
  }

  const summary = { fail: 0, warn: 0, pass: 0, info: 0 }
  for (const entry of results) summary[entry.level] += 1
  return { results, summary }
}

// ------------------------------------------------------------------- CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const target = process.argv[2] ?? 'https://www.cutcore.com.br'
  console.log(`\nVarredura de segurança — ${target}\n`)
  let area = ''
  const { summary } = await runScan(target, {
    log: ({ level, area: current, title, detail }) => {
      if (current !== area) {
        area = current
        console.log(`\n\x1b[1m${area}\x1b[0m`)
      }
      console.log(`  ${SEVERITY[level]} ${title}${detail ? `\n           \x1b[2m${detail}\x1b[0m` : ''}`)
    },
  })
  console.log(`\nResumo: ${summary.pass} ok · ${summary.warn} atenção · ${summary.fail} falha(s) · ${summary.info} informativo(s)\n`)
  process.exit(summary.fail > 0 ? 1 : 0)
}
