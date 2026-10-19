// Carrossel 3 do Instagram — ERP para marcenaria e centralização do serviço (1080 × 1350).
//   node marketing/gerar-centralizacao.mjs
// Saída: marketing/instagram/centralizacao/central-01-*.png ...
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(root, 'marketing', 'instagram', '_capturas')
const OUT = join(root, 'marketing', 'instagram', 'centralizacao')
const HTML = join(tmpdir(), 'cc-centralizacao-html')
mkdirSync(OUT, { recursive: true })
mkdirSync(HTML, { recursive: true })
const W = 1080
const H = 1350

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

const TOTAL = 10

const frame = (index, { eyebrow, title, sub, body, foot, bare }) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="post">
  <div class="top"><div class="pill"><img src="${logoUri}" /></div><div class="count">${String(index).padStart(2, '0')} / ${String(TOTAL).padStart(2, '0')}</div></div>
  <div class="progress">${Array.from({ length: TOTAL }, (_, i) => `<i class="${i < index ? 'on' : ''}"></i>`).join('')}</div>
  ${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}
  <h1>${title}</h1>
  ${sub ? `<p class="sub">${sub}</p>` : ''}
  <div class="stage">${body}</div>
  <div class="foot">${
    foot ??
    `<span><strong>${SITE}</strong></span>${
      index < TOTAL
        ? `<span class="swipe">ARRASTE <svg width="30" height="22" viewBox="0 0 30 22" fill="none" stroke="#5cc3dc" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 11h24M17 3l9 8-9 8"/></svg></span>`
        : `<span>${INSTAGRAM}</span>`
    }`
  }</div>
</div></body></html>`

// ---------------------------------------------------------------- slides
const row = (iconName, title, text) => `<div class="glass" style="display:flex;align-items:center;gap:28px;padding:30px 30px">
  <div class="tile">${icon(iconName, 52)}</div>
  <div><div style="font-size:34px;font-weight:700">${title}</div><div style="font-size:26px;color:#b9cfd7;margin-top:4px;line-height:1.3">${text}</div></div>
</div>`

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
  const cy = 356
  const r = 262
  const nodes = hubNodes
    .map(([ic, label], i) => {
      const a = ((-90 + i * 45) * Math.PI) / 180
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a) * 0.98
      const paths = iconPaths(ic)
        .map((d) => `<path d="${d}" fill="#5cc3dc"/>`)
        .join('')
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="rgba(92,195,220,.45)" stroke-width="3" stroke-dasharray="8 8"/>
        <g><circle cx="${x}" cy="${y}" r="58" fill="#15323d" stroke="#5cc3dc" stroke-width="3"/>
        <g transform="translate(${x - 28} ${y - 28}) scale(2.34)">${paths}</g>
        <text x="${x}" y="${y + 92}" text-anchor="middle" font-size="26" font-weight="600" fill="#fff" font-family="InterV, sans-serif">${label}</text></g>`
    })
    .join('')
  return `<svg viewBox="0 0 900 760" width="100%" aria-hidden="true">
    <circle cx="${cx}" cy="${cy}" r="150" fill="rgba(19,137,168,.16)"/>
    ${nodes}
    <circle cx="${cx}" cy="${cy}" r="92" fill="#1389a8" stroke="#8fe0f2" stroke-width="4"/>
    <text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="34" font-weight="800" fill="#fff" font-family="Jost, sans-serif" letter-spacing="2">CORE</text>
    <text x="${cx}" y="${cy + 34}" text-anchor="middle" font-size="34" font-weight="800" fill="#fff" font-family="Jost, sans-serif" letter-spacing="2">CUT</text>
  </svg>`
}

const tools = [
  ['Planilha de orçamento', -3, 0],
  ['WhatsApp', 2, 30],
  ['Programa de plano de corte', -2, 8],
  ['Caderno de prazos', 3, 18],
  ['Planilha de estoque', -1, 42],
  ['Pedido de compra no papel', 2, 4],
  ['Controle financeiro à parte', -3, 26],
]

const stageNames = ['Briefing', 'Medição', 'Projeto 3D', 'Aprovação', 'Planejamento PCP', 'Produção', 'Expedição', 'Instalação', 'Entregue', 'Garantia']

const areaCard = (iconName, title, items) => `<div class="glass" style="padding:34px 38px 20px">
  <div style="display:flex;align-items:center;gap:26px;margin-bottom:14px">
    <div class="tile" style="width:104px;height:104px;border-radius:28px">${icon(iconName, 60)}</div>
    <div style="font-family:'Jost';font-weight:700;font-size:56px">${title}</div>
  </div>
  <div>${items
    .map((t, i) => `<div style="display:flex;gap:18px;align-items:center;font-size:33px;line-height:1.25;color:#e4eef1;padding:20px 0;border-top:1px solid rgba(255,255,255,${i === 0 ? '.16' : '.09'})"><span style="flex:none">${icon('CheckCircle', 38)}</span>${t}</div>`)
    .join('')}</div>
</div>`

const slides = [
  // 1 · capa com o "hub"
  {
    file: 'central-01-capa',
    eyebrow: 'ERP para marcenaria',
    title: 'Sua marcenaria inteira em <em>um só lugar</em>.',
    body: `<div class="glass" style="padding:10px 6px 0">${hub()}</div>`,
  },
  // 2 · a bagunça
  {
    file: 'central-02-bagunca',
    eyebrow: 'Sem centralizar',
    title: 'Um projeto, <em>sete ferramentas</em> diferentes.',
    sub: 'Cada uma com uma versão da verdade — e ninguém sabe qual está certa.',
    body: `<div style="display:flex;flex-wrap:wrap;gap:16px 18px;padding:6px 4px 26px">${tools
      .map(
        ([t, rot, off]) => `<div style="transform:rotate(${rot}deg);margin-top:${off % 24}px;background:rgba(255,255,255,.07);border:1.5px dashed rgba(255,255,255,.35);border-radius:16px;padding:16px 24px;font-size:30px;font-weight:600">${t}</div>`,
      )
      .join('')}</div>
    <div style="display:flex;justify-content:center;margin:6px 0 20px">${icon('KeyboardArrowDown', 70)}</div>
    <div class="glass" style="padding:28px 32px;border-color:#5cc3dc;background:rgba(19,137,168,.26);display:flex;align-items:center;gap:26px">
      <div class="big" style="font-size:110px">1</div>
      <div><div style="font-family:'Jost';font-weight:700;font-size:48px">sistema só</div><div style="font-size:27px;color:#c9dce3">com os mesmos dados para todo mundo</div></div>
    </div>`,
  },
  // 3 · fluxo da marcenaria
  {
    file: 'central-03-fluxo',
    eyebrow: 'O fluxo da marcenaria',
    title: 'Do briefing à garantia, <em>tudo acompanha o projeto</em>.',
    body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">${stageNames
      .map(
        (s, i) => `<div style="display:flex;align-items:center;gap:18px;padding:16px 22px;border-radius:20px;background:${i < 4 ? 'rgba(19,137,168,.26)' : i < 8 ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.05)'};border:1.5px solid ${i < 4 ? 'rgba(92,195,220,.6)' : 'rgba(255,255,255,.14)'}">
          <div style="width:52px;height:52px;border-radius:50%;background:${i < 4 ? '#1389a8' : '#2a4552'};display:grid;place-items:center;font-weight:800;font-size:26px;flex:none">${i + 1}</div>
          <div style="font-size:30px;font-weight:600;line-height:1.15">${s}</div></div>`,
      )
      .join('')}</div>`,
  },
  // 4 · comercial
  {
    file: 'central-04-comercial',
    eyebrow: 'Comercial',
    title: 'Do primeiro contato ao <em>contrato assinado</em>.',
    body: areaCard('RequestQuote', 'Vendas', ['Leads e clientes', 'Orçamento com custo real e margem', 'Proposta em PDF com a sua marca', 'Contrato com parcelas', 'Aprovou: projeto e produção nascem juntos', 'Taxa de aprovação e ticket médio']),
  },
  // 5 · projeto e corte
  {
    file: 'central-05-projeto-corte',
    eyebrow: 'Projeto e plano de corte',
    title: 'O corte nasce <em>dentro do projeto</em>.',
    body: areaCard('ContentCut', 'Engenharia', ['Importa Promob (CSV, XML, DXF, DXT)', 'Fichas técnicas dos módulos', 'Plano de corte por material', 'Cortes de ponta a ponta', 'Fita de borda e usinagens', 'Etiqueta com QR Code por peça']),
  },
  // 6 · fábrica
  {
    file: 'central-06-fabrica',
    eyebrow: 'Produção',
    title: 'A fábrica acompanha <em>cada ordem</em>.',
    body: areaCard('Factory', 'Chão de fábrica', ['Ordens com roteiro por setor', 'Apontamento de tempo na bancada', 'Estoque reservado por ordem', 'Inspeções e não conformidades', 'Manutenção das máquinas', 'Ponto eletrônico da equipe']),
  },
  // 7 · suprimentos
  {
    file: 'central-07-suprimentos',
    eyebrow: 'Estoque e compras',
    title: 'Nada falta, nada <em>sobra sem motivo</em>.',
    body: areaCard('Inventory2', 'Suprimentos', ['Catálogo Leo Madeiras (+5.500 itens)', 'Saldo mínimo e movimentações', 'Reserva por ordem de produção', 'Compra do que falta no plano', 'Aprovação e recebimento', 'Entrada automática no estoque']),
  },
  // 8 · entrega
  {
    file: 'central-08-entrega',
    eyebrow: 'Entrega e pós-venda',
    title: 'Instalou? O <em>histórico fica guardado</em>.',
    body: areaCard('LocalShipping', 'Entrega', ['Entregas e instalações com equipe', 'Checklist de instalação', 'Agenda de medições e visitas', 'Veículos da frota',  'Prestadores e montadores', 'Garantias por projeto']),
  },
  // 9 · gestão
  {
    file: 'central-09-gestao',
    eyebrow: 'Gestão',
    title: 'O dono enxerga <em>tudo de uma vez</em>.',
    body: areaCard('AccountBalance', 'Visão do negócio', ['Painel com indicadores', 'Contas a receber e a pagar', 'Fluxo de caixa projetado', 'Resultado por categoria', 'Alertas de prazo e estoque', 'Perfis e permissões da equipe']),
  },
  // 10 · CTA
  {
    file: 'central-10-cta',
    eyebrow: 'Centralize a sua marcenaria',
    title: 'Teste <em>48 horas grátis</em>. Sem cartão.',
    sub: 'Crie a conta da sua empresa e coloque tudo no mesmo sistema.',
    body: `<div style="display:flex;gap:16px;margin-bottom:22px">${[
      ['Essencial', 'R$ 99', 'projetos, orçamentos e estoque'],
      ['Profissional', 'R$ 199', 'inclui plano de corte'],
      ['Industrial', 'R$ 399', 'usuários ilimitados'],
    ]
      .map(
        ([n, p, t], i) => `<div style="flex:1;border-radius:22px;padding:22px 20px;background:${i === 1 ? 'rgba(19,137,168,.3)' : 'rgba(255,255,255,.06)'};border:2px solid ${i === 1 ? '#5cc3dc' : 'rgba(255,255,255,.12)'}">
          <div style="font-size:24px;color:#8fb6c3;font-weight:600">${n}</div>
          <div style="font-family:'Jost';font-weight:700;font-size:46px;margin:4px 0 6px;white-space:nowrap">${p}<span style="font-size:20px;color:#8fb6c3;font-weight:500">/mês</span></div>
          <div style="font-size:21px;line-height:1.3;color:#c9dce3">${t}</div></div>`,
      )
      .join('')}</div>
    <div class="glass" style="display:flex;align-items:center;gap:30px;padding:26px 30px">
      <div style="background:#fff;border-radius:16px;padding:12px;flex:none">${qrSvg(`https://${SITE}/`, 170)}</div>
      <div>
        <div style="font-size:24px;color:#8fb6c3">Aponte a câmera ou acesse</div>
        <div style="font-family:'Jost';font-weight:700;font-size:44px;margin:4px 0 10px">${SITE}</div>
        <div style="font-size:26px;color:#c9dce3">WhatsApp <strong style="color:#fff">${WHATSAPP}</strong></div>
        <div style="font-size:26px;color:#c9dce3">Instagram <strong style="color:#fff">${INSTAGRAM}</strong></div>
      </div>
    </div>`,
    foot: `<span>Core Cut ERP · Gestão e plano de corte para marcenaria</span><span></span>`,
  },
]

// ---------------------------------------------------------------- renderização
const profile = mkdtempSync(join(tmpdir(), 'cc-cen-'))
const DEBUG = 9399
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
