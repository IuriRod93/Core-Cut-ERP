// Gera as artes do Instagram (1080×1350, formato 4:5) a partir das telas reais capturadas.
//   node marketing/capturar-telas.mjs     (uma vez, ou quando o sistema mudar)
//   node marketing/gerar-artes.mjs
// Saída: marketing/instagram/post-01-*.png ... + legendas.md
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = join(root, 'marketing', 'instagram', '_capturas')
const OUT = join(root, 'marketing', 'instagram')
const HTML = join(OUT, '_html')
mkdirSync(HTML, { recursive: true })
const W = 1080
const H = 1350

const BROWSERS = [process.env.BROWSER_PATH, 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'].filter(Boolean)
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) throw new Error('Defina BROWSER_PATH (Edge ou Chrome).')

// ---- marca e contatos (os mesmos da página inicial do site)
const SITE = 'www.cutcore.com.br'
const INSTAGRAM = '@core_cut4.0'
const WHATSAPP = '(21) 99307-9682'

const font = (file) => pathToFileURL(join(root, 'node_modules', file)).href
const dataUri = (path) => `data:image/${path.endsWith('.png') ? 'png' : 'jpeg'};base64,${readFileSync(path).toString('base64')}`
const shotUri = (name) => dataUri(join(SHOTS, `${name}.png`))
const logoUri = dataUri(join(root, 'public', 'core-cut-logo.png'))
const photoUri = (name) => dataUri(join(root, 'public', 'site', name))

/** Recorte de uma captura (coordenadas da tela de 1440×900) exibido em `width` px de largura. */
const crop = (name, x, y, w, h, width, extra = '') => {
  const scale = width / w
  return `<div style="width:${width}px;height:${Math.round(h * scale)}px;overflow:hidden;position:relative;${extra}">
    <img src="${shotUri(name)}" style="position:absolute;left:${-x * scale}px;top:${-y * scale}px;width:${1440 * scale}px;height:auto" />
  </div>`
}

const css = `
@font-face { font-family: 'Jost'; font-weight: 700; src: url('${font('@fontsource/jost/files/jost-latin-700-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'Jost'; font-weight: 500; src: url('${font('@fontsource/jost/files/jost-latin-500-normal.woff2')}') format('woff2'); }
@font-face { font-family: 'InterV'; font-weight: 100 900; src: url('${font('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')}') format('woff2'); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { width: ${W}px; height: ${H}px; overflow: hidden; font-family: 'InterV', 'Segoe UI', sans-serif; color: #fff; background: #0f1c23; }
.post { position: relative; width: ${W}px; height: ${H}px; padding: 64px 70px; display: flex; flex-direction: column;
  background: radial-gradient(1200px 700px at 100% -10%, rgba(19,137,168,.55), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(19,137,168,.28), transparent 60%), linear-gradient(180deg, #13232b, #0b161c); }
.top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 38px; }
.pill { background: #fff; border-radius: 999px; padding: 10px 22px 10px 14px; display: flex; align-items: center; }
.pill img { height: 44px; display: block; }
.count { font-size: 24px; letter-spacing: .12em; color: #8fb6c3; font-weight: 600; }
.eyebrow { font-size: 26px; letter-spacing: .16em; text-transform: uppercase; color: #5cc3dc; font-weight: 700; margin-bottom: 18px; }
h1 { font-family: 'Jost', sans-serif; font-weight: 700; font-size: 84px; line-height: 1.04; letter-spacing: -.01em; }
h1 em { font-style: normal; color: #5cc3dc; }
.sub { margin-top: 24px; font-size: 33px; line-height: 1.4; color: #c9dce3; max-width: 900px; }
.stage { margin-top: auto; }
.card { border-radius: 26px; overflow: hidden; background: #fff; box-shadow: 0 30px 70px rgba(0,0,0,.45), 0 0 0 1px rgba(255,255,255,.08); }
.foot { display: flex; align-items: center; justify-content: space-between; margin-top: 30px; font-size: 26px; color: #8fb6c3; }
.foot strong { color: #fff; font-weight: 600; }
.chips { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 30px; }
.chip { border: 2px solid rgba(92,195,220,.5); border-radius: 999px; padding: 12px 24px; font-size: 28px; font-weight: 600; background: rgba(19,137,168,.18); }
.big { font-family: 'Jost', sans-serif; font-weight: 700; font-size: 132px; line-height: 1; color: #5cc3dc; }
`

const frame = ({ index, total, eyebrow, title, sub, body, foot }) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
<div class="post">
  <div class="top"><div class="pill"><img src="${logoUri}" /></div><div class="count">${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}</div></div>
  <div class="eyebrow">${eyebrow}</div>
  <h1>${title}</h1>
  ${sub ? `<p class="sub">${sub}</p>` : ''}
  <div class="stage">${body}</div>
  <div class="foot">${foot ?? `<span><strong>${SITE}</strong></span><span>${INSTAGRAM}</span>`}</div>
</div></body></html>`

const STAGES = ['Briefing', 'Medição', 'Projeto 3D', 'Aprovação', 'Planejamento PCP', 'Produção', 'Expedição', 'Instalação', 'Entregue', 'Garantia']
const TOTAL = 7

const posts = [
  {
    file: 'post-01-capa',
    eyebrow: 'Core Cut ERP · para marcenaria',
    title: 'Do orçamento ao <em>plano de corte</em>, em um só sistema.',
    sub: 'Projetos, produção, estoque, financeiro e o corte das chapas conversando entre si.',
    body: `<div class="card">${crop('painel', 262, 70, 1170, 760, 940)}</div>`,
  },
  {
    file: 'post-02-promob',
    eyebrow: 'Integração com o Promob',
    title: 'Importe <em>500 lotes</em> de chapa de uma vez.',
    sub: 'CSV, XML, DXF e DXT. Arraste a pasta inteira: peças, furos, rasgos e fitas já entram lidos.',
    body: `<div style="display:flex;align-items:flex-end;gap:36px;margin-bottom:30px">
        <div><div class="big">500</div><div style="font-size:28px;color:#c9dce3;margin-top:6px">arquivos DXF de chapa</div></div>
        <div class="big" style="color:#fff;font-size:90px;padding-bottom:30px">→</div>
        <div><div class="big">7.000</div><div style="font-size:28px;color:#c9dce3;margin-top:6px">peças lidas</div></div>
      </div>
      <div class="card">${crop('importacao-promob', 140, 232, 1160, 186, 940)}${crop('importacao-promob', 140, 428, 1160, 262, 940, 'border-top:1px solid #e6e2dc')}</div>
      <div style="margin-top:18px;font-size:22px;color:#6f8f9b">Exemplo de demonstração com arquivos de teste · leitura em segundos.</div>`,
  },
  {
    file: 'post-03-corte',
    eyebrow: 'Plano de corte para seccionadora',
    title: 'Mapa de corte que a <em>serra executa</em>.',
    sub: 'Cortes de ponta a ponta, respeitando disco, refilo e veio — sem encaixe impossível de cortar.',
    body: `<div class="card" style="background:#f4f1ec;padding:18px"><div style="overflow:hidden;border-radius:14px;height:${Math.round((745 - 14) * (904 / 1112))}px;position:relative"><img src="${shotUri('chapa-mapa')}" style="position:absolute;left:0;top:${-Math.round(38 * (904 / 1112))}px;width:904px;display:block" /></div></div>`,
  },
  {
    file: 'post-04-etiquetas',
    eyebrow: 'Chão de fábrica',
    title: 'Etiqueta com <em>QR Code</em> em cada peça.',
    sub: 'Medidas, material, fitas, usinagens e a posição na chapa. Menos erro na montagem.',
    body: `<div style="display:flex;align-items:flex-end;gap:30px;margin-bottom:30px">
        <div><div class="big">107</div><div style="font-size:28px;color:#c9dce3;margin-top:6px">peças no plano</div></div>
        <div class="big" style="color:#fff;font-size:90px;padding-bottom:30px">=</div>
        <div><div class="big">107</div><div style="font-size:28px;color:#c9dce3;margin-top:6px">etiquetas prontas</div></div>
      </div>
      <div class="card">${crop('plano-etiquetas', 296, 540, 720, 322, 940)}</div>
      <div class="chips"><span class="chip">Completa · 2×4 por folha</span><span class="chip">Compacta · 3×8</span></div>`,
  },
  {
    file: 'post-05-fluxo',
    eyebrow: 'Fluxo completo',
    title: 'Do <em>briefing</em> à garantia.',
    sub: 'Cada projeto percorre as etapas da sua marcenaria, com prazos, responsáveis e histórico.',
    body: `<div style="display:flex;flex-direction:column;gap:9px">${STAGES.map(
      (s, i) => `<div style="display:flex;align-items:center;gap:18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:8px 20px">
        <div style="width:40px;height:40px;border-radius:50%;background:${i < 6 ? '#1389a8' : '#2a4552'};display:grid;place-items:center;font-weight:700;font-size:22px">${i + 1}</div>
        <div style="font-size:30px;font-weight:600">${s}</div></div>`,
    ).join('')}</div>`,
  },
  {
    file: 'post-06-gestao',
    eyebrow: 'Gestão da marcenaria',
    title: 'Projetos, orçamentos e <em>produção</em> à vista.',
    sub: 'Quadro de tarefas, propostas com custo real e margem, e estoque com o catálogo Leo Madeiras (+5.500 itens).',
    body: `<div class="card">${crop('projeto-quadro', 270, 85, 780, 440, 940)}</div>`,
  },
  {
    file: 'post-07-cta',
    eyebrow: 'Teste sem compromisso',
    title: '<em>48 horas</em> grátis para testar.',
    sub: 'Sem cartão de crédito. Planos a partir de R$ 99/mês, com pagamento por PIX ou cartão.',
    body: `<div style="display:flex;gap:18px;margin-bottom:26px">${[
        ['Essencial', 'R$ 99', 'Projetos, orçamentos, estoque e financeiro'],
        ['Profissional', 'R$ 199', 'Inclui plano de corte, compras e qualidade'],
        ['Industrial', 'R$ 399', 'Usuários ilimitados e chão de fábrica'],
      ]
        .map(
          ([name, price, text], i) => `<div style="flex:1;border-radius:24px;padding:26px 24px;background:${i === 1 ? 'rgba(19,137,168,.28)' : 'rgba(255,255,255,.06)'};border:2px solid ${i === 1 ? '#5cc3dc' : 'rgba(255,255,255,.12)'}">
            <div style="font-size:26px;color:#8fb6c3;font-weight:600">${name}</div>
            <div style="font-family:'Jost';font-weight:700;font-size:50px;white-space:nowrap;margin:6px 0 8px">${price}<span style="font-size:24px;color:#8fb6c3;font-weight:500">/mês</span></div>
            <div style="font-size:23px;line-height:1.35;color:#c9dce3">${text}</div></div>`,
        )
        .join('')}</div>
      <div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:28px;padding:34px 44px">
        <div style="font-size:30px;color:#8fb6c3;margin-bottom:6px">Comece agora</div>
        <div style="font-family:'Jost';font-weight:700;font-size:62px;color:#fff;margin-bottom:26px">${SITE}</div>
        <div style="display:flex;gap:40px;font-size:30px;color:#c9dce3">
          <div><div style="color:#8fb6c3;font-size:24px">WhatsApp</div><strong style="color:#fff">${WHATSAPP}</strong></div>
          <div><div style="color:#8fb6c3;font-size:24px">Instagram</div><strong style="color:#fff">${INSTAGRAM}</strong></div>
        </div>
      </div>`,
    foot: `<span>Core Cut ERP · Gestão e plano de corte para marcenaria</span><span></span>`,
  },
]

const profile = mkdtempSync(join(tmpdir(), 'cc-art-'))
const DEBUG = 9396
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

  posts.forEach(() => undefined)
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i]
    const htmlFile = join(HTML, `${post.file}.html`)
    writeFileSync(htmlFile, frame({ index: i + 1, total: TOTAL, ...post }))
    await send('Page.navigate', { url: pathToFileURL(htmlFile).href })
    await sleep(1500)
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })
    const { result } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } })
    writeFileSync(join(OUT, `${post.file}.png`), Buffer.from(result.data, 'base64'))
    console.log('arte:', `${post.file}.png`)
  }
  ws.close()
} finally {
  chrome.kill()
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    /* navegador soltando a pasta */
  }
}

// ---- imagem de pré-visualização do site (link no WhatsApp, Instagram, Google): 1200 × 630
if (process.argv.includes('--og')) {
  const ogChrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--allow-file-access-from-files', '--remote-debugging-port=9397', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'cc-og-'))}`, '--window-size=1200,630', 'about:blank'], { stdio: 'ignore' })
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch('http://127.0.0.1:9397/json/version')).ok) break
      } catch {
        await sleep(200)
      }
    }
    const target = (await fetch('http://127.0.0.1:9397/json/list').then((r) => r.json())).find((t) => t.type === 'page')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((a, b) => ((ws.onopen = a), (ws.onerror = b)))
    let id = 0
    const pending = new Map()
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.id && pending.has(m.id)) (pending.get(m.id)(m), pending.delete(m.id))
    }
    const send = (method, params = {}) => new Promise((r) => ((id += 1), pending.set(id, r), ws.send(JSON.stringify({ id, method, params }))))
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${css.replace(`width: ${W}px; height: ${H}px;`, 'width: 1200px; height: 630px;')}
      body { background: #0b161c; }
      .og { position: relative; width: 1200px; height: 630px; display: flex; }
      .og-photo { position: absolute; inset: 0; background: url('${photoUri('amostras-mdf-parede.jpg')}') center/cover; }
      .og-shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(11,22,28,.97) 0%, rgba(11,22,28,.9) 46%, rgba(11,22,28,.35) 100%); }
      .og-copy { position: relative; padding: 64px 72px; display: flex; flex-direction: column; justify-content: center; max-width: 780px; }
      .og h1 { font-size: 66px; }
    </style></head><body><div class="og"><div class="og-photo"></div><div class="og-shade"></div>
      <div class="og-copy">
        <div class="pill" style="align-self:flex-start;margin-bottom:34px"><img src="${logoUri}" /></div>
        <div class="eyebrow" style="font-size:22px">ERP e plano de corte para marcenaria</div>
        <h1>Do orçamento ao <em>corte</em>, da fábrica à entrega.</h1>
        <p class="sub" style="font-size:28px;margin-top:20px">Teste grátis por 48 horas · ${SITE}</p>
      </div></div></body></html>`
    const ogFile = join(HTML, 'og.html')
    writeFileSync(ogFile, html)
    await send('Page.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false })
    await send('Page.navigate', { url: pathToFileURL(ogFile).href })
    await sleep(1500)
    await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => true)', awaitPromise: true })
    const { result } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } })
    writeFileSync(join(root, 'public', 'site', 'og-core-cut.png'), Buffer.from(result.data, 'base64'))
    console.log('og: public/site/og-core-cut.png')
    ws.close()
  } finally {
    ogChrome.kill()
  }
}
