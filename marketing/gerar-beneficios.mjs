// Carrossel 2 do Instagram — benefícios e funcionalidades (1080 × 1350), mesma identidade do carrossel de lançamento.
//   node marketing/gerar-beneficios.mjs
// Saída: marketing/instagram/beneficios/beneficio-01-*.png ... e legendas-beneficios.md (já versionada)
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(root, 'marketing', 'instagram', '_capturas')
const OUT = join(root, 'marketing', 'instagram', 'beneficios')
const HTML = join(tmpdir(), 'cc-beneficios-html')
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

const slides = [
  // 1 · capa
  {
    file: 'beneficio-01-capa',
    eyebrow: 'Core Cut ERP · para marcenaria',
    title: 'O que muda na sua marcenaria com <em>o Core Cut</em>.',
    sub: 'Menos desperdício, menos retrabalho e mais controle do projeto à instalação.',
    body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">${[
      ['ContentCut', 'Plano de corte', 'que a serra executa'],
      ['Factory', 'Produção', 'ordens por setor'],
      ['Inventory2', 'Estoque', 'com preço em reais'],
      ['AccountBalance', 'Financeiro', 'receber e pagar'],
    ]
      .map(
        ([ic, t, s]) => `<div class="glass" style="padding:30px 30px 28px;min-height:230px;display:flex;flex-direction:column;justify-content:space-between">
          <div class="tile">${icon(ic, 52)}</div>
          <div><div style="font-family:'Jost';font-weight:700;font-size:44px">${t}</div><div style="font-size:26px;color:#b9cfd7">${s}</div></div></div>`,
      )
      .join('')}</div>`,
  },
  // 2 · dor
  {
    file: 'beneficio-02-dor',
    eyebrow: 'O problema',
    title: 'Planilha, WhatsApp e papel <em>não conversam</em> entre si.',
    body: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="glass" style="padding:30px;border-color:rgba(255,120,120,.35)">
        <div style="font-size:24px;letter-spacing:.14em;font-weight:700;color:#ff9b9b;margin-bottom:18px">ANTES</div>
        ${['Orçamento na planilha', 'Plano de corte em outro programa', 'Pedido de compra por WhatsApp', 'Prazo no caderno', 'Estoque “de cabeça”']
          .map((t) => `<div style="font-size:29px;line-height:1.3;color:#d9c9c9;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.08);text-decoration:line-through;text-decoration-color:rgba(255,120,120,.7)">${t}</div>`)
          .join('')}
      </div>
      <div class="glass" style="padding:30px;border-color:rgba(92,195,220,.55);background:rgba(19,137,168,.18)">
        <div style="font-size:24px;letter-spacing:.14em;font-weight:700;color:#5cc3dc;margin-bottom:18px">COM O CORE CUT</div>
        ${['Proposta, contrato e projeto ligados', 'Plano de corte dentro do projeto', 'Compra gerada do que falta', 'Prazos e responsáveis no quadro', 'Saldo, reserva e mínimo de cada item']
          .map((t) => `<div style="display:flex;gap:12px;align-items:flex-start;font-size:29px;line-height:1.3;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.1)"><span style="flex:none;margin-top:3px">${icon('CheckCircle', 30)}</span>${t}</div>`)
          .join('')}
      </div>
    </div>`,
  },
  // 3 · benefício 1
  {
    file: 'beneficio-03-custo',
    eyebrow: 'Benefício 01 · Menos desperdício',
    title: 'Saiba o <em>custo da chapa</em> antes de cortar.',
    sub: 'Aproveitamento e custo por material, calculados com preços do catálogo.',
    body: `<div class="card" style="background:#f4f1ec;padding:16px"><img src="${mapaUri}" style="width:100%;display:block;border-radius:14px" /></div>`,
  },
  // 4 · benefício 2
  {
    file: 'beneficio-04-serra',
    eyebrow: 'Benefício 02 · Seccionadora',
    title: 'Corte que a <em>serra executa</em>.',
    sub: 'Cortes de ponta a ponta, respeitando disco, refilo e veio. Sem encaixe impossível.',
    body: `<div class="glass" style="padding:26px">
      <svg viewBox="0 0 900 470" width="100%" aria-hidden="true">
        <rect x="6" y="6" width="888" height="458" rx="14" fill="#16303b" stroke="#5cc3dc" stroke-width="3"/>
        ${[
          [20, 20, 260, 215, 1], [284, 20, 330, 215, 0], [618, 20, 262, 215, 1],
          [20, 239, 190, 215, 0], [214, 239, 250, 215, 1], [468, 239, 200, 215, 0], [672, 239, 208, 215, 1],
        ]
          .map(([x, y, w, h, a]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${a ? 'rgba(92,195,220,.38)' : 'rgba(255,255,255,.14)'}" stroke="rgba(255,255,255,.55)" stroke-width="2"/>`)
          .join('')}
        <line x1="6" y1="237" x2="894" y2="237" stroke="#ffd166" stroke-width="3" stroke-dasharray="14 9"/>
        <line x1="282" y1="6" x2="282" y2="237" stroke="#ffd166" stroke-width="3" stroke-dasharray="14 9"/>
        <line x1="616" y1="6" x2="616" y2="237" stroke="#ffd166" stroke-width="3" stroke-dasharray="14 9"/>
        <line x1="212" y1="237" x2="212" y2="464" stroke="#ffd166" stroke-width="3" stroke-dasharray="14 9"/>
        <line x1="466" y1="237" x2="466" y2="464" stroke="#ffd166" stroke-width="3" stroke-dasharray="14 9"/>
        <line x1="670" y1="237" x2="670" y2="464" stroke="#ffd166" stroke-width="3" stroke-dasharray="14 9"/>
      </svg>
      <div style="display:flex;align-items:center;gap:14px;margin-top:14px;font-size:26px;color:#ffd166;font-weight:600">
        <svg width="46" height="6"><line x1="0" y1="3" x2="46" y2="3" stroke="#ffd166" stroke-width="4" stroke-dasharray="9 6"/></svg>
        cada corte atravessa o painel inteiro · ilustração
      </div>
    </div>
    <div class="chips" style="display:flex;gap:14px;margin-top:22px;flex-wrap:wrap"><span class="chip">Seccionadora</span><span class="chip">CNC com G-code</span></div>`,
  },
  // 5 · benefício 3
  {
    file: 'beneficio-05-promob',
    eyebrow: 'Benefício 03 · Sem redigitar',
    title: 'Do <em>Promob</em> para o plano em segundos.',
    sub: 'Arraste a pasta inteira: o sistema lê e mapeia tudo para você conferir.',
    body: `<div style="display:flex;align-items:flex-end;gap:26px;margin-bottom:26px">
        <div class="big" style="font-size:190px">500</div>
        <div style="font-size:34px;line-height:1.2;color:#c9dce3;padding-bottom:22px">lotes de chapa<br/>importados de uma vez</div>
      </div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:26px">${['CSV', 'XML', 'DXF', 'DXT'].map((f) => `<span class="chip" style="font-size:36px;padding:14px 32px">${f}</span>`).join('')}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${[
        ['Straighten', 'Peças e medidas'],
        ['Tune', 'Furos, rasgos e usinagens'],
        ['Layers', 'Fitas de borda'],
        ['Inventory2', 'Chapa do estoque'],
      ]
        .map(([ic, t]) => `<div class="glass" style="display:flex;align-items:center;gap:18px;padding:20px 22px"><div class="tile" style="width:68px;height:68px;border-radius:18px">${icon(ic, 38)}</div><div style="font-size:28px;font-weight:600;line-height:1.2">${t}</div></div>`)
        .join('')}</div>`,
  },
  // 6 · benefício 4
  {
    file: 'beneficio-06-fluxo',
    eyebrow: 'Benefício 04 · Tudo conectado',
    title: 'Aprovou o orçamento? O <em>projeto nasce pronto</em>.',
    sub: 'Orçamento, projeto, produção e financeiro nascem do mesmo dado — sem digitar de novo.',
    body: `<div style="display:flex;flex-direction:column;gap:0">${[
      ['RequestQuote', 'Orçamento aprovado', 'custo real, margem e impostos'],
      ['Assignment', 'Projeto criado', 'etapas, tarefas e responsáveis'],
      ['Factory', 'Ordem de produção', 'roteiro por setor e materiais'],
      ['AccountBalance', 'Parcelas a receber', 'lançadas no financeiro'],
    ]
      .map(
        ([ic, t, s], i, a) => `<div style="display:flex;gap:26px;align-items:stretch">
          <div style="display:flex;flex-direction:column;align-items:center">
            <div class="tile" style="width:96px;height:96px;background:#1389a8;border-color:#5cc3dc">${icon(ic, 54, '#fff')}</div>
            ${i < a.length - 1 ? '<div style="flex:1;width:4px;min-height:44px;background:linear-gradient(#5cc3dc,rgba(92,195,220,.25));margin:6px 0"></div>' : ''}
          </div>
          <div style="padding:14px 0 ${i < a.length - 1 ? 46 : 0}px"><div style="font-family:'Jost';font-weight:700;font-size:44px">${t}</div><div style="font-size:27px;color:#b9cfd7">${s}</div></div>
        </div>`,
      )
      .join('')}</div>`,
  },
  // 7 · benefício 5
  {
    file: 'beneficio-07-fabrica',
    eyebrow: 'Benefício 05 · Chão de fábrica',
    title: 'A fábrica <em>sob controle</em>, da bancada ao estoque.',
    body: `<div style="display:flex;flex-direction:column;gap:16px">${[
      ['QrCode2', 'Etiqueta com QR Code', 'medidas, material, fitas e posição na chapa'],
      ['Schedule', 'Apontamento na bancada', 'tempo real por operação e por setor'],
      ['Inventory2', 'Estoque reservado', 'por ordem de produção, com saldo mínimo'],
      ['ShoppingCart', 'Compras do que falta', 'da solicitação ao recebimento'],
    ]
      .map(([ic, t, s]) => row(ic, t, s))
      .join('')}</div>`,
  },
  // 8 · funcionalidades
  {
    file: 'beneficio-08-funcionalidades',
    eyebrow: 'Funcionalidades',
    title: 'Tudo em <em>um só sistema</em>.',
    body: `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">${[
      ['RequestQuote', 'Orçamentos e contratos'],
      ['Assignment', 'Projetos e tarefas'],
      ['Factory', 'Produção e chão de fábrica'],
      ['ContentCut', 'Plano de corte e G‑code'],
      ['Inventory2', 'Estoque e catálogo'],
      ['ShoppingCart', 'Compras e fornecedores'],
      ['AccountBalance', 'Financeiro'],
      ['Verified', 'Qualidade, entregas e garantia'],
      ['Groups', 'Equipe e permissões'],
    ]
      .map(
        ([ic, t]) => `<div class="glass" style="padding:24px 18px;min-height:262px;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center">
          <div class="tile" style="width:100px;height:100px">${icon(ic, 54)}</div>
          <div style="font-size:28px;font-weight:600;line-height:1.2">${t}</div></div>`,
      )
      .join('')}</div>`,
  },
  // 9 · segurança
  {
    file: 'beneficio-09-seguranca',
    eyebrow: 'Segurança',
    title: 'Os dados da sua marcenaria <em>protegidos</em>.',
    body: `<div style="display:flex;flex-direction:column;gap:16px">${[
      ['Lock', 'Conexão criptografada', 'todo o acesso é feito por HTTPS'],
      ['Business', 'Dados isolados por empresa', 'cada empresa vê só as próprias informações'],
      ['Key', 'Senhas e permissões', 'acesso por perfil e por módulo'],
      ['History', 'Registro de atividades', 'criações, alterações e acessos ficam registrados'],
    ]
      .map(([ic, t, s]) => row(ic, t, s))
      .join('')}</div>`,
  },
  // 10 · CTA
  {
    file: 'beneficio-10-cta',
    eyebrow: 'Teste sem compromisso',
    title: '<em>48 horas</em> grátis. Sem cartão de crédito.',
    sub: 'Crie a conta da sua empresa e use o sistema de verdade.',
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
const profile = mkdtempSync(join(tmpdir(), 'cc-ben-'))
const DEBUG = 9398
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
