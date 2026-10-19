// Captura telas reais do sistema (com dados de demonstração) para as artes do Instagram.
//   npm run build && node marketing/capturar-telas.mjs
// Saída: marketing/instagram/_capturas/*.png
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(root, 'marketing', 'instagram', '_capturas')
mkdirSync(OUT, { recursive: true })
const PORT = 4795
const DEBUG = 9395
const APP = `http://127.0.0.1:${PORT}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const BROWSERS = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) throw new Error('Defina BROWSER_PATH (Edge ou Chrome).')

const dataDir = mkdtempSync(join(tmpdir(), 'cc-mkt-'))
const profile = mkdtempSync(join(tmpdir(), 'cc-mkt-browser-'))
const dxfDir = mkdtempSync(join(tmpdir(), 'cc-mkt-dxf-'))
const server = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
  env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(PORT), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir, ALLOW_SIMULATED_SIGNUP: '1' },
  stdio: 'pipe',
})
let chrome

const api = async (method, path, body, token) => {
  const r = await fetch(`${APP}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, json: await r.json().catch(() => null) }
}

// 500 DXFs de chapa no formato do Cut Pro (para mostrar a importação em volume)
function makeDxfs() {
  let seed = 31
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const files = []
  for (let i = 1; i <= 500; i++) {
    const th = [15, 18, 6][i % 3]
    const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES']
    const poly = (layer, x0, y0, x1, y1) => out.push('0', 'LWPOLYLINE', '8', layer, '90', '4', '70', '1', '10', x0, '20', y0, '10', x0, '20', y1, '10', x1, '20', y1, '10', x1, '20', y0)
    poly(`CHAPA Z ${th}`, 0, 0, 2750, 1850)
    for (let k = 0; k < 14; k++) {
      const x = 10 + (k % 6) * 440
      const y = 10 + Math.floor(k / 6) * 600
      poly(`CORTE M 7 Z ${th}.1`, x, y, x + 200 + Math.floor(rand() * 200), y + 150 + Math.floor(rand() * 300))
      out.push('0', 'CIRCLE', '8', 'FURO 8 Z 12', '10', x + 30, '20', y + 30, '40', 4)
    }
    out.push('0', 'ENDSEC', '0', 'EOF')
    const name = join(dxfDir, `${i}_${th}MDFBRANCO${th}(CHAPA).dxf`)
    writeFileSync(name, out.join('\r\n'))
    files.push(name)
  }
  return files
}

try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${APP}/api/health`)).ok) break
    } catch {
      await sleep(150)
    }
  }
  // base da plataforma com os dados de demonstração (o admin tem o menu completo do ERP)
  const login = await api('POST', '/auth/login', { login: 'admin', password: 'arcoplan123' })
  const token = login.json.token
  await api('POST', '/auth/change-password', { currentPassword: 'arcoplan123', newPassword: 'Cerejeira-Azul-47' }, token)
  await api('POST', '/admin/demo', {}, token)
  const project = (await api('GET', '/data/projects', null, token)).json?.[0]
  const plans = (await api('GET', '/data/cutPlans?full=1', null, token)).json ?? []
  console.log('dados de demonstração · projeto:', project?.name, '· planos:', plans.length)

  chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, '--window-size=1440,900', 'about:blank'], { stdio: 'ignore' })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${DEBUG}/json/version`)).ok) break
    } catch {
      await sleep(200)
    }
  }
  const target = (await fetch(`http://127.0.0.1:${DEBUG}/json/list`).then((r) => r.json())).find((t) => t.type === 'page')
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((a, b) => ((ws.onopen = a), (ws.onerror = b)))
  let id = 0
  const pending = new Map()
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id))
  }
  const send = (method, params = {}) => new Promise((r) => ((id += 1), pending.set(id, r), ws.send(JSON.stringify({ id, method, params }))))
  const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value
  const shot = async (name) => {
    const { result } = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, 'base64'))
    console.log('captura:', name)
  }
  const go = async (path, waitText) => {
    await send('Page.navigate', { url: `${APP}${path}` })
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`Boolean(document.querySelector('main')) && ${waitText ? `document.body.innerText.includes(${JSON.stringify(waitText)})` : 'true'}`)) break
      await sleep(250)
    }
    await sleep(900)
    // capturas de divulgação: esconde o atalho do Painel Admin do menu lateral
    await evaluate(`(() => { for (const el of document.querySelectorAll('a,div,p,span,li')) { const t = el.textContent.trim(); if (el.children.length === 0 && (t === 'Painel Admin' || t === 'PLATAFORMA' || t === 'Plataforma')) (el.closest('a') ?? el).style.display = 'none' } return true })()`)
  }
  const click = (text, selector = 'button,[role=tab]') =>
    evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)})); el?.click(); return Boolean(el) })()`)

  await send('Page.enable')
  await send('Runtime.enable')
  await send('DOM.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false })
  await send('Page.navigate', { url: `${APP}/login` })
  await sleep(1500)
  await evaluate(`localStorage.setItem('arcoplan.token', ${JSON.stringify(token)}); localStorage.setItem('core-cut-erp.install-onboarding-dismissed', 'dismissed'); localStorage.setItem('core-cut-erp.onboarding-dismissed', '1')`)

  await go('/painel', 'Boa')
  await shot('painel')
  if (project) {
    await go(`/projetos/${project.id}`)
    await shot('projeto-lista')
    await click('Quadro', '[role=tab],button,a')
    await sleep(1200)
    await shot('projeto-quadro')
  }
  await go('/orcamentos')
  await shot('orcamentos')
  await go('/producao')
  await shot('producao')
  await go('/estoque')
  await shot('estoque')

  // plano de corte: modo seccionadora, recalcula (cortes de ponta a ponta) e fotografa o mapa da chapa
  if (plans[0]) {
    await go(`/plano-de-corte?plano=${plans[0].id}`, 'Peças')
    await shot('plano-pecas')
    await click('Seccionadora', 'button')
    await sleep(300)
    // o plano abre na aba do mapa; o botão "Recalcular" aparece porque o método mudou
    await click('Recalcular', 'button')
    await sleep(6500) // espera o aviso verde sumir
    await shot('plano-mapa')
    // recorte nítido (2x) da maior ilustração de chapa
    const rect = await evaluate(`(() => {
      const svgs = [...document.querySelectorAll('main svg')].filter((s) => s.querySelectorAll('rect').length > 6)
      const best = svgs.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0]
      if (!best) return null
      best.scrollIntoView({ block: 'center' })
      const r = best.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    })()`)
    if (rect) {
      await sleep(900)
      const fresh = await evaluate(`(() => {
        const svgs = [...document.querySelectorAll('main svg')].filter((s) => s.querySelectorAll('rect').length > 6)
        const best = svgs.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0]
        const r = best.getBoundingClientRect()
        return { x: r.x + window.scrollX, y: r.y + window.scrollY, width: r.width, height: r.height }
      })()`)
      const { result } = await send('Page.captureScreenshot', { format: 'png', clip: { x: Math.max(fresh.x - 8, 0), y: Math.max(fresh.y - 34, 0), width: fresh.width + 16, height: fresh.height + 44, scale: 1 } })
      writeFileSync(join(OUT, 'chapa-mapa.png'), Buffer.from(result.data, 'base64'))
      console.log('captura: chapa-mapa', Math.round(fresh.width), 'x', Math.round(fresh.height))
    }
    await click('Etiquetas', '[role=tab]')
    await sleep(1200)
    await shot('plano-etiquetas')
  }

  // importação de 500 lotes do Promob
  await go('/plano-de-corte?plano=novo')
  await click('Importar do Promob', 'button')
  await sleep(900)
  const doc = await send('DOM.getDocument', { depth: -1 })
  const inputs = await send('DOM.querySelectorAll', { nodeId: doc.result.root.nodeId, selector: 'input[type=file]' })
  await send('DOM.setFileInputFiles', { nodeId: inputs.result.nodeIds[0], files: makeDxfs() })
  for (let i = 0; i < 80; i++) {
    if (await evaluate("document.body.innerText.includes('lote(s) de chapa')")) break
    await sleep(250)
  }
  await sleep(800)
  await shot('importacao-promob')
  ws.close()
} finally {
  chrome?.kill()
  server.kill()
  for (const dir of [dataDir, profile, dxfDir]) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* navegador ainda soltando a pasta */
    }
  }
}
console.log('Pronto:', OUT, readdirSync(OUT).length, 'arquivos')
