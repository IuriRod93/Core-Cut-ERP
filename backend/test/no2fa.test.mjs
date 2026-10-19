import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashPassword } from '../lib/auth.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })

test('2FA removido: quem tinha o autenticador ligado entra só com a senha e os dados antigos são apagados', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'corecut-no2fa-'))
  // base antiga: usuário com 2FA ativo, semente e códigos de recuperação
  const now = new Date().toISOString()
  writeFileSync(
    join(dataDir, 'arcoplan-db.json'),
    JSON.stringify({
      meta: { version: 1, counters: {}, createdAt: now },
      collections: {
        users: [
          {
            id: 'u-antigo',
            name: 'Admin Antigo',
            email: 'antigo@corecut.local',
            role: 'admin',
            active: true,
            passwordHash: hashPassword('Cerejeira-Azul-47'),
            passwordMustChange: false,
            totpEnabled: true,
            totpSecret: 'JBSWY3DPEHPK3PXP',
            totpPendingSecret: 'PENDENTE',
            totpLastStep: 123,
            recoveryCodes: ['hash1', 'hash2'],
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      sessions: [],
    }),
  )
  const port = await freePort()
  const child = spawn(process.execPath, [join(root, 'backend', 'server.mjs')], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', PORT: String(port), HOST: '127.0.0.1', ARCOPLAN_DATA_DIR: dataDir, ARCOPLAN_SCHEDULER_MS: '0' },
    stdio: 'pipe',
  })
  try {
    let up = false
    for (let i = 0; i < 150 && !up; i++) {
      try {
        up = (await fetch(`http://127.0.0.1:${port}/api/health`)).ok
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    assert.ok(up, 'o servidor de teste não subiu')

    const login = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: 'antigo@corecut.local', password: 'Cerejeira-Azul-47' }),
    })
    const body = await login.json()
    assert.equal(login.status, 200)
    assert.ok(body.token, 'entra só com a senha')
    assert.equal(body.twoFactorRequired, undefined)
    assert.equal(body.user.totpEnabled, undefined)

    // o arquivo da base não guarda mais semente nem códigos
    await new Promise((r) => setTimeout(r, 800))
    const saved = JSON.parse(readFileSync(join(dataDir, 'arcoplan-db.json'), 'utf8'))
    const user = saved.collections.users.find((u) => u.id === 'u-antigo')
    assert.equal(user.totpEnabled, false)
    assert.equal(user.totpSecret, null)
    assert.equal(user.totpPendingSecret, null)
    assert.deepEqual(user.recoveryCodes, [])
  } finally {
    child.kill()
    rmSync(dataDir, { recursive: true, force: true })
  }
})
