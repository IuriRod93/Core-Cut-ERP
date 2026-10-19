// Stories 9:16 (1080 × 1920) sobre a centralização do serviço, com zonas seguras para a interface do Instagram.
//   node marketing/gerar-stories.mjs
// Saída: marketing/instagram/stories/story-01-*.png ...
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(root, 'marketing', 'instagram', '_capturas')
const OUT = join(root, 'marketing', 'instagram', 'stories')
const HTML = join(tmpdir(), 'cc-stories-html')
mkdirSync(OUT, { recursive: true })
mkdirSync(HTML, { recursive: true })
const W = 1080
const H = 1920

const BROWSERS = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean)
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) throw new Error('Defina BROWSER_PATH (Edge ou Chrome).')

const SITE = 'www.cutcore.com.br'
const INSTAGRAM = '@core_cut4.0'
const WHATSAPP = '(21) 99307-9682'

// ---------------------------------------------------------------- recursos
const font = (file) => pathToFileURL(join(root, 'node_modules', file)).href
const dataUri = (path) => `data:image/${path.endsWith('.png') ? 'png' : path.endsWith('.webp') ? 'webp' : 'jpeg'};base64,${readFileSync(path).toString('base64')}`
const shotUri = (name) => dataUri(join(SHOTS, `${name}.png`))
const mapaUri = dataUri(join(root, 'public', 'site', 'telas', 'chapa-mapa.webp'))
const logoUri = dataUri(join(root, 'public', 'core-cut-logo.png'))

/** Ícones do Material (os mesmos do sistema), embutidos como SVG. */
const iconPaths = (name) => {
  const file = readFileSync(join(root, 'node_modules', '@mui', 'icons-material', `${name}Outlined.js`), 'utf8')
  return [...file.matchAll(/d:\s*"([^"]+)"/g)].map((m) => m[1])
}
const icon = (name, size = 56, color = '#5cc3dc') =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="${color}" aria-hidden="true">${iconPaths(name)
    .map((d) => `<path d="${d}"/>`)
    .join('')}</svg>`

const qrSvg = (text, size) => {
  const qrcode = require('qrcode-generator')
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true }).replace('<svg', `<svg width="${size}" height="${size}"`)
}

const crop = (name, x, y, w, h, width, extra = '') => {
  const scale = width / w
  return `<div style="width:${width}px;height:${Math.round(h * scale)}px;overflow:hidden;position:relative;${extra}">
    <img src="${shotUri(name)}" style="position:absolute;left:${-x * scale}px;top:${-y * scale}px;width:${1440 * scale}px;height:auto" />
  </div>`
}

// ---------------------------------------------------------------- estilo
const css = `
@font-face { font-family: 'Jost'; font-weight: 700; src: url('${font('@fontsource/jost/files/jost-latin-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Jost'; font-weight: 500; src: url('${font('@fontsource/jost/files/jost-latin-500-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'InterV'; font-weight: 100 900; src: url('${font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')}') format('woff2'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: ${W}px; height: ${H}px; overflow: hidden; font-family: 'InterV', 'Segoe UI', sans-serif; color: #fff; background: #0f1c23; }
.post { position: relative; width: ${W}px; height: ${H}px; padding: 60px 70px 54px; display: flex; flex-direction: column; overflow: hidden;
  background: radial-gradient(1200px 700px at 100% -10%, rgba(19,137,168,.55), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(19,137,168,.28), transparent 60%), linear-gradient(180deg, #13232b, #0b161c); }
.post::before { content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
  background-size: 54px 54px; mask-image: linear-gradient(180deg, rgba(0,0,0,.9), transparent 70%); }
.post > * { position: relative; }
.top { display: flex; align-items: center; justify-content: space-between; }
.pill { background: #fff; border-radius: 999px; padding: 10px 22px 10px 14px; display: flex; align-items: center; }
.pill img { height: 44px; display: block; }
.count { font-size: 24px; letter-spacing: .12em; color: #8fb6c3; font-weight: 600; }
.progress { display: flex; gap: 8px; margin: 26px 0 34px; }
.progress i { flex: 1; height: 5px; border-radius: 3px; background: rgba(255,255,255,.16); }
.progress i.on { background: #5cc3dc; }
.eyebrow { font-size: 26px; letter-spacing: .16em; text-transform: uppercase; color: #5cc3dc; font-weight: 700; margin-bottom: 16px; }
h1 { font-family: 'Jost', sans-serif; font-weight: 700; font-size: 80px; line-height: 1.04; letter-spacing: -.01em; }
h1 em { font-style: normal; color: #5cc3dc; }
.sub { margin-top: 22px; font-size: 32px; line-height: 1.4; color: #c9dce3; }
.stage { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 26px 0 4px; }
.card { border-radius: 26px; overflow: hidden; background: #fff; box-shadow: 0 30px 70px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08); }
.glass { border-radius: 26px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); }
.foot { display: flex; align-items: center; justify-content: space-between; margin-top: 26px; font-size: 26px; color: #8fb6c3; }
.foot strong { color: #fff; font-weight: 600; }
.swipe { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .12em; font-size: 22px; color: #5cc3dc; }
.tile { width: 92px; height: 92px; border-radius: 24px; display: grid; place-items: center; background: rgba(19,137,168,.22); border: 1.5px solid rgba(92,195,220,.45); flex: none; }
.big { font-family: 'Jost', sans-serif; font-weight: 700; line-height: .95; color: #5cc3dc; }
.chip { border: 2px solid rgba(92,195,220,.5); border-radius: 999px; padding: 12px 24px; font-size: 28px; font-weight: 600; background: rgba(19,137,168,.18); }
`

// Stories 9:16: zonas seguras (topo ~190 px e rodapé ~300 px ficam livres para a interface do Instagram e as figurinhas)
const frame = (index, { eyebrow, title, sub, body, bottomSpace = 0 }) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}
.post { padding: 190px 76px ${300 + bottomSpace}px; }
h1 { font-size: 96px; line-height: 1.04; }
.sub { font-size: 38px; margin-top: 26px; }
.eyebrow { font-size: 30px; }
.stage { justify-content: center; padding-top: 34px; }
.stage > * { zoom: 1.2; }
</style></head><body>
<div class="post">
  <div class="top" style="position:absolute;left:76px;top:96px"><div class="pill"><img src="${logoUri}" /></div></div>
  ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}
  <h1>${title}</h1>
  ${sub ? `<p class="sub">${sub}</p>` : ''}
  <div class="stage">${body}</div>
</div></body></html>`

const TOTAL = 7

const hubNodes = [
  ['RequestQuote', 'Orçamentos'],
  ['Assignment', 'Projetos'],
  ['ContentCut', 'Plano de corte'],
  ['Factory', 'Produção'],
  ['Inventory2', 'Estoque'],
  ['ShoppingCart', 'Compras'],
  ['LocalShipping', 'Entregas'],
  ['AccountBalance', 'Financeiro'],
]

const hub = () => {
  const cx = 450
  const cy = 380
  const r = 270
  const nodes = hubNodes
    .map(([ic, label], i) => {
      const a = ((-90 + i * 45) * Math.PI) / 180
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      const paths = iconPaths(ic)
        .map((d) => `<path d="${d}" fill="#5cc3dc"/>`)
        .join('')
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(92,195,220,.45)" stroke-width="3" stroke-dasharray="8 8"/>
        <circle cx="${x}" cy="${y}" r="60" fill="#15323d" stroke="#5cc3dc" stroke-width="3"/>
        <g transform="translate(${x - 29} ${y - 29}) scale(2.42)">${paths}</g>
        <text x="${x}" y="${y + 96}" text-anchor="middle" font-size="27" font-weight="600" fill="#fff" font-family="InterV, sans-serif">${label}</text>`
    })
    .join('')
  return `<svg viewBox="0 0 900 790" width="100%" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="150" fill="rgba(19,137,168,.16)"/>
    ${nodes}
    <circle cx="${cx}" cy="${cy}" r="92" fill="#1389a8" stroke="#8fe0f2" stroke-width="4"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="34" font-weight="800" fill="#fff" font-family="Jost, sans-serif" letter-spacing="2">CORE</text>
    <text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="34" font-weight="800" fill="#fff" font-family="Jost, sans-serif" letter-spacing="2">CUT</text>
  </svg>`
}

const tools = [
  ['Planilha de orçamento', -3],
  ['WhatsApp', 2],
  ['Programa de plano de corte', -2],
  ['Caderno de prazos', 3],
  ['Planilha de estoque', -1],
  ['Pedido de compra no papel', 2],
  ['Controle financeiro à parte', -3],
]

const pointRow = (text) => `<div style="display:flex;gap:20px;align-items:center;font-size:36px;line-height:1.25;padding:20px 0;border-bottom:1px solid rgba(255,255,255,.1)"><span style="flex:none">${icon('CheckCircle', 44)}</span>${text}</div>`

const slides = [
  // 1 · gancho + espaço para a enquete
  {
    file: 'story-01-gancho',
    eyebrow: 'Pergunta rápida',
    title: 'Quantas ferramentas você usa para tocar <em>um único projeto</em>?',
    bottomSpace: 180,
    body: `<div style="display:flex;flex-wrap:wrap;gap:18px 18px;padding:6px 0">${tools
      .map(([t, rot]) => `<div style="transform:rotate(${rot}deg);background:rgba(255,255,255,.07);border:1.5px dashed rgba(255,255,255,.38);border-radius:18px;padding:18px 28px;font-size:34px;font-weight:600">${t}</div>`)
      .join('')}</div>`,
  },
  // 2 · problema
  {
    file: 'story-02-problema',
    eyebrow: 'O problema',
    title: 'Cada uma com <em>uma versão</em> da verdade.',
    body: `<div class="glass" style="padding:20px 34px;border-color:rgba(255,120,120,.35)">${[
      'Orçamento na planilha',
      'Plano de corte em outro programa',
      'Prazo no caderno',
      'Compra pelo WhatsApp',
    ]
      .map((t) => `<div style="font-size:38px;line-height:1.25;color:#e0cfcf;padding:22px 0;border-bottom:1px solid rgba(255,255,255,.1);text-decoration:line-through;text-decoration-color:rgba(255,120,120,.75)">${t}</div>`)
      .join('')}</div>
      <p style="margin-top:36px;font-family:'Jost';font-weight:700;font-size:56px;line-height:1.1">E quando alguém erra,<br/><span style="color:#5cc3dc">quem paga é a chapa.</span></p>`,
  },
  // 3 · solução (hub)
  {
    file: 'story-03-solucao',
    eyebrow: 'A solução',
    title: 'Tudo no <em>mesmo lugar</em>.',
    body: `<div class="glass" style="padding:10px 4px 0">${hub()}</div>`,
  },
  // 4 · fluxo
  {
    file: 'story-04-fluxo',
    eyebrow: 'Tudo conectado',
    title: 'Aprovou o orçamento? O <em>projeto nasce pronto</em>.',
    body: `<div style="display:flex;flex-direction:column">${[
      ['RequestQuote', 'Orçamento aprovado', 'custo real, margem e impostos'],
      ['Assignment', 'Projeto criado', 'etapas, tarefas e responsáveis'],
      ['Factory', 'Ordem de produção', 'roteiro por setor e materiais'],
      ['AccountBalance', 'Parcelas a receber', 'lançadas no financeiro'],
    ]
      .map(
        ([ic, t, s], i, a) => `<div style="display:flex;gap:30px;align-items:stretch">
          <div style="display:flex;flex-direction:column;align-items:center">
            <div class="tile" style="width:108px;height:108px;background:#1389a8;border-color:#5cc3dc">${icon(ic, 60, '#fff')}</div>
            ${i < a.length - 1 ? '<div style="flex:1;width:5px;min-height:40px;background:linear-gradient(#5cc3dc,rgba(92,195,220,.25));margin:6px 0"></div>' : ''}
          </div>
          <div style="padding:14px 0 ${i < a.length - 1 ? 40 : 0}px"><div style="font-family:'Jost';font-weight:700;font-size:52px">${t}</div><div style="font-size:30px;color:#b9cfd7">${s}</div></div>
        </div>`,
      )
      .join('')}</div>`,
  },
  // 5 · Promob
  {
    file: 'story-05-promob',
    eyebrow: 'Do Promob para o plano',
    title: '<em>500 lotes</em> de chapa de uma vez.',
    body: `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:30px">${['CSV', 'XML', 'DXF', 'DXT'].map((f) => `<span class="chip" style="font-size:40px;padding:16px 36px">${f}</span>`).join('')}</div>
      <div class="glass" style="padding:14px 34px">${[
        'Custo da chapa antes de cortar',
        'Cortes que a serra executa',
        'Etiqueta com QR Code por peça',
        'Peças, furos e fitas já lidos',
      ]
        .map(pointRow)
        .join('')}</div>`,
  },
  // 6 · fábrica e dono (espaço para a caixa de perguntas)
  {
    file: 'story-06-fabrica',
    eyebrow: 'Fábrica e dono',
    title: 'Os <em>mesmos dados</em> para todo mundo.',
    bottomSpace: 170,
    body: `<div style="display:flex;flex-direction:column;gap:18px">${[
      ['Schedule', 'Fábrica', 'aponta o tempo na bancada'],
      ['Inventory2', 'Estoque', 'reservado por ordem de produção'],
      ['AccountBalance', 'Dono', 'vê prazo, custo e financeiro'],
    ]
      .map(
        ([ic, t, s]) => `<div class="glass" style="display:flex;align-items:center;gap:28px;padding:30px 32px">
          <div class="tile" style="width:100px;height:100px">${icon(ic, 56)}</div>
          <div><div style="font-family:'Jost';font-weight:700;font-size:54px">${t}</div><div style="font-size:32px;color:#b9cfd7">${s}</div></div></div>`,
      )
      .join('')}</div>`,
  },
  // 7 · chamada (espaço para o link)
  {
    file: 'story-07-chamada',
    eyebrow: 'Teste sem compromisso',
    title: '<em>48 horas</em> grátis. Sem cartão.',
    bottomSpace: 90,
    body: `<div style="display:flex;gap:14px;margin-bottom:24px">${[
      ['Essencial', 'R$ 99', 'projetos e orçamentos'],
      ['Profissional', 'R$ 199', 'inclui plano de corte'],
      ['Industrial', 'R$ 399', 'usuários ilimitados'],
    ]
      .map(
        ([n, p, t], i) => `<div style="flex:1;border-radius:22px;padding:22px 18px;background:${i === 1 ? 'rgba(19,137,168,.3)' : 'rgba(255,255,255,.06)'};border:2px solid ${i === 1 ? '#5cc3dc' : 'rgba(255,255,255,.12)'}">
          <div style="font-size:26px;color:#8fb6c3;font-weight:600">${n}</div>
          <div style="font-family:'Jost';font-weight:700;font-size:48px;margin:4px 0 6px;white-space:nowrap">${p}<span style="font-size:22px;color:#8fb6c3;font-weight:500">/mês</span></div>
          <div style="font-size:23px;line-height:1.3;color:#c9dce3">${t}</div></div>`,
      )
      .join('')}</div>
    <div class="glass" style="display:flex;align-items:center;gap:30px;padding:28px 30px">
      <div style="background:#fff;border-radius:16px;padding:12px;flex:none">${qrSvg(`https://${SITE}/`, 190)}</div>
      <div>
        <div style="font-size:26px;color:#8fb6c3">Aponte a câmera ou acesse</div>
        <div style="font-family:'Jost';font-weight:700;font-size:46px;margin:4px 0 12px">${SITE}</div>
        <div style="font-size:28px;color:#c9dce3">WhatsApp <strong style="color:#fff">${WHATSAPP}</strong></div>
      </div>
    </div>`,
  },
]

// ---------------------------------------------------------------- renderização
const profile = mkdtempSync(join(tmpdir(), 'cc-sto-'))
const DEBUG = 9400
const chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
try {
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
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })
  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i]
    const htmlFile = join(HTML, `${slide.file}.html`)
    writeFileSync(htmlFile, frame(i + 1, slide))
    await send('Page.navigate', { url: pathToFileURL(htmlFile).href })
    await sleep(1400)
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })
    const { result } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
    writeFileSync(join(OUT, `${slide.file}.png`), Buffer.from(result.data, 'base64'))
    console.log('arte:', `${slide.file}.png`)
  }
  ws.close()
} finally {
  chrome.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* o navegador ainda soltando a pasta */
  }
}
