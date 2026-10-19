import { test, before, after } from 'node:test'
import net from 'node:net'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computePrivateAssets } from '../../scripts/mark-private-assets.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** Pede ao sistema operacional uma porta livre (evita colisão com os outros testes que rodam em paralelo). */
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port: p } = probe.address()
      probe.close(() => resolve(p))
    })
  })
const port = await freePort()
const origin = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'corecut-gate-data-'))
const distDir = mkdtempSync(join(tmpdir(), 'corecut-gate-dist-'))
let child

/** Pequeno "build": a entrada importa um vendor de forma estática e carrega a tela interna sob demanda. */
const fixture = {
  'index.html': '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/index-aaaaaaaa.js"></script></body></html>',
  'assets/index-aaaaaaaa.js': 'import{x}from"./vendor-bbbbbbbb.js";export const open=()=>import("./Orcamentos-cccccccc.js");console.log(x)',
  'assets/vendor-bbbbbbbb.js': 'export const x=1',
  'assets/Orcamentos-cccccccc.js': 'import{x}from"./vendor-bbbbbbbb.js";import"./Compartilhado-dddddddd.js";console.log("codigo-interno-das-telas",x)',
  'assets/Compartilhado-dddddddd.js': 'export const y=2',
}

before(async () => {
  for (const [file, content] of Object.entries(fixture)) {
    const path = join(distDir, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  const { privateFiles } = computePrivateAssets(distDir)
  writeFileSync(join(distDir, 'private-assets.json'), JSON.stringify(privateFiles))

  child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir, ARCOPLAN_DIST_DIR: distDir, ARCOPLAN_SCHEDULER_MS: '0' },
    stdio: 'pipe',
  })
  let up = false
  for (let i = 0; i < 150 && !up; i++) {
    try {
      up = (await fetch(`${origin}/api/health`)).ok
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  assert.ok(up, 'o servidor de teste não subiu')
})

after(() => {
  child?.kill()
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(distDir, { recursive: true, force: true })
})

const get = (path, cookie) => fetch(origin + path, { headers: cookie ? { Cookie: cookie } : {} })
const cookieOf = (response) => (response.headers.get('set-cookie') ?? '').split(';')[0]

test('separação: o que a entrada carrega é público; a tela interna e o que só ela usa é privado', () => {
  const { privateFiles, publicFiles } = computePrivateAssets(distDir)
  assert.deepEqual(publicFiles.sort(), ['assets/index-aaaaaaaa.js', 'assets/vendor-bbbbbbbb.js'])
  assert.deepEqual(privateFiles.sort(), ['assets/Compartilhado-dddddddd.js', 'assets/Orcamentos-cccccccc.js'])
})

test('portão: sem sessão o código das telas internas não é entregue; com sessão é', async () => {
  // público
  assert.equal((await get('/')).status, 200)
  assert.equal((await get('/assets/index-aaaaaaaa.js')).status, 200)
  assert.equal((await get('/assets/vendor-bbbbbbbb.js')).status, 200)

  // privado sem sessão (e sem revelar o conteúdo)
  const denied = await get('/assets/Orcamentos-cccccccc.js')
  assert.equal(denied.status, 403)
  assert.equal((await denied.text()).includes('codigo-interno'), false)
  assert.equal((await get('/assets/Orcamentos-cccccccc.js', 'cc_gate=token-falso-que-nao-existe-0000000000')).status, 403)

  // a lista de arquivos privados não é publicada
  assert.equal((await get('/private-assets.json')).status, 404)

  // login libera
  const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'arcoplan123' }) })
  assert.equal(login.status, 200)
  const header = login.headers.get('set-cookie') ?? ''
  assert.match(header, /^cc_gate=/)
  assert.match(header, /HttpOnly/i)
  assert.match(header, /SameSite=Strict/i)
  assert.match(header, /Path=\/assets\//)
  const cookie = cookieOf(login)
  const { token } = await login.json()

  const allowed = await get('/assets/Orcamentos-cccccccc.js', cookie)
  assert.equal(allowed.status, 200)
  assert.match(await allowed.text(), /codigo-interno/)

  // o cookie NÃO autentica a API: sem o cabeçalho Authorization continua 401
  const api = await fetch(`${origin}/api/data/clients`, { headers: { Cookie: cookie } })
  assert.equal(api.status, 401)

  // quem volta com a sessão guardada (sem cookie) recebe a liberação ao falar com a API
  const me = await fetch(`${origin}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
  assert.equal(me.status, 200)
  assert.equal(cookieOf(me), cookie)

  // sair derruba a liberação
  const out = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  assert.equal(out.status, 200)
  assert.match(out.headers.get('set-cookie') ?? '', /Max-Age=0/)
  assert.equal((await get('/assets/Orcamentos-cccccccc.js', cookie)).status, 403)
})
