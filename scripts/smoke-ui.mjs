// Teste de telas: sobe o servidor com dados de demonstração, abre cada rota principal num navegador
// real (Edge/Chrome headless) e falha se alguma tela quebrar (mensagem de erro, exceção ou console.error).
//
//   npm run build && npm run test:ui
//   BROWSER_PATH="C:\\caminho\\chrome.exe" npm run test:ui     (outro navegador)
//
// Cria dados em uma pasta temporária; nunca toca no banco configurado no .env.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.SMOKE_PORT ?? 4791)
const DEBUG = Number(process.env.SMOKE_DEBUG_PORT ?? 9391)
const APP = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const browser = BROWSERS.find((path) => existsSync(path))
if (!browser) {
  console.error('Nenhum Edge/Chrome encontrado. Defina BROWSER_PATH.')
  process.exit(2)
}
if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('Execute "npm run build" antes (o teste usa a pasta dist).')
  process.exit(2)
}

// rotas que um usuário comum abre; /projetos/:id é montada depois de criar um projeto
const ROUTES = [
  '/painel', '/tarefas', '/agenda', '/leads', '/clientes', '/orcamentos', '/contratos', '/projetos', '/producao',
  '/chao-de-fabrica', '/plano-de-corte', '/fichas-tecnicas', '/qualidade', '/manutencao', '/entregas', '/garantias',
  '/estoque', '/estoque?aba=retalhos', '/compras', '/fornecedores', '/financeiro', '/comissoes', '/notas-fiscais', '/app', '/equipe', '/ponto', '/veiculos', '/relatorios', '/arquivos',
  '/logs', '/configuracoes', '/admin', '/admin/teste-pagamento', '/esqueci-senha',
]

const dataDir = mkdtempSync(join(tmpdir(), 'cc-smoke-'))
const profile = mkdtempSync(join(tmpdir(), 'cc-smoke-browser-'))
const server = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
  env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(PORT), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir },
  stdio: 'pipe',
})
let chrome
let failures = 0
const report = []

const api = async (method, path, body, token) => {
  const response = await fetch(`${APP}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: response.status, json: await response.json().catch(() => null) }
}

try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) break
    } catch {
      await sleep(150)
    }
  }
  const login = await api('POST', '/auth/login', { login: 'admin', password: 'arcoplan123' })
  const token = login.json.token
  await api('POST', '/auth/change-password', { currentPassword: 'arcoplan123', newPassword: 'Senha-Forte-123' }, token)
  await api('POST', '/admin/demo', {}, token) // dados de demonstração
  const project = (await api('GET', '/data/projects', null, token)).json?.[0]
  const plan = (await api('GET', '/data/cutPlans', null, token)).json?.[0]
  const routes = [...ROUTES]
  if (project) routes.push(`/projetos/${project.id}`)
  if (plan) routes.push(`/plano-de-corte?plano=${plan.id}`)
  if (project) {
    const task = (await api('GET', '/data/tasks', null, token)).json?.find((t) => t.projectId === project.id && !t.parentId)
    if (task) routes.push(`/projetos/${project.id}?tarefa=${task.id}`)
  }

  chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).ok) break
    } catch {
      await sleep(200)
    }
  }
  const target = (await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json())).find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)))
  let id = 0
  const pending = new Map()
  let errors = []
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data)
    if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.description ?? a.value).join(' ').slice(0, 240))
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 240))
  }
  const send = (method, params = {}) => new Promise((resolve) => ((id += 1), pending.set(id, resolve), ws.send(JSON.stringify({ id, method, params }))))
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send('Page.navigate', { url: `${APP}/login` })
  await sleep(1200)
  await evaluate(`localStorage.setItem('arcoplan.token', ${JSON.stringify(token)}); localStorage.setItem('core-cut-erp.install-onboarding-dismissed', 'dismissed')`)

  for (const route of routes) {
    errors = []
    await send('Page.navigate', { url: `${APP}${route}` })
    // espera a tela montar (menu lateral) e estabilizar
    for (let i = 0; i < 40; i++) {
      if (await evaluate("Boolean(document.querySelector('main')) && !document.querySelector('[role=progressbar]')")) break
      await sleep(250)
    }
    await sleep(600)
    const text = String((await evaluate('document.body.innerText')) ?? '')
    const crashed = /Algo não saiu como esperado/.test(text)
    const blank = text.trim().length < 20
    const ok = !crashed && !blank && errors.length === 0
    if (!ok) failures += 1
    report.push({ route, ok, detail: crashed ? 'tela quebrou' : blank ? 'tela em branco' : errors[0] ?? '' })
    console.log(`${ok ? '✔' : '✖'} ${route}${ok ? '' : `  → ${crashed ? 'tela quebrou' : blank ? 'tela em branco' : errors[0]}`}`)
  }
  ws.close()
} catch (error) {
  failures += 1
  console.error('Falha ao executar o teste de telas:', error)
} finally {
  chrome?.kill()
  server.kill()
  try {
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* o navegador pode demorar a soltar a pasta */
  }
}

console.log(`\n${report.length - failures}/${report.length} telas sem erro`)
process.exit(failures ? 1 : 0)
