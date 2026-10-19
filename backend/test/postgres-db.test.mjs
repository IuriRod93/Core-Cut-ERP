import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PostgresDatabase } from '../lib/postgres-db.mjs'
import { seedDefaults } from '../lib/seed.mjs'

class MemoryPool {
  documents = new Map()
  runtime = null

  async query(sql) {
    if (sql.includes('SELECT collection, id, document')) {
      const rows = [...this.documents.values()]
      return { rows, rowCount: rows.length }
    }
    if (sql.includes('SELECT state FROM core_cut_runtime')) {
      return { rows: this.runtime ? [{ state: this.runtime }] : [], rowCount: this.runtime ? 1 : 0 }
    }
    return { rows: [], rowCount: 0 }
  }

  async connect() {
    return {
      query: async (sql, params = []) => {
        if (sql.includes('DELETE FROM core_cut_documents')) {
          const [collection, ids] = params
          for (const id of ids) this.documents.delete(`${collection}\0${id}`)
        } else if (sql.includes('INSERT INTO core_cut_documents')) {
          const [collection, json] = params
          for (const document of JSON.parse(json)) this.documents.set(`${collection}\0${document.id}`, { collection, id: document.id, document })
        } else if (sql.includes('INSERT INTO core_cut_runtime')) {
          this.runtime = JSON.parse(params[0])
        }
        return { rows: [], rowCount: 0 }
      },
      release() {},
    }
  }
}

test('PostgreSQL adapter persists CRUD state and imports a JSON database once', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'core-cut-postgres-test-'))
  try {
    const legacyState = {
      meta: { version: 1, counters: { 'CLI-2026': 3 }, createdAt: '2026-01-01T00:00:00.000Z' },
      collections: { clients: [{ id: 'legacy-client', name: 'Cliente legado' }] },
      sessions: [],
    }
    writeFileSync(join(dataDir, 'arcoplan-db.json'), JSON.stringify(legacyState))
    const pool = new MemoryPool()
    const first = await new PostgresDatabase(dataDir, pool, { importJson: true }).initialize()

    assert.equal(first.get('clients', 'legacy-client').name, 'Cliente legado')
    first.update('clients', 'legacy-client', { phone: '11999990000' })
    first.insert('clients', { id: 'new-client', name: 'Novo cliente' })
    await first.flush()

    const second = await new PostgresDatabase(dataDir, pool).initialize()
    assert.equal(second.get('clients', 'legacy-client').phone, '11999990000')
    assert.equal(second.get('clients', 'new-client').name, 'Novo cliente')
    assert.equal(second.state.meta.counters['CLI-2026'], 3)

    second.remove('clients', 'new-client')
    await second.flush()
    const third = await new PostgresDatabase(dataDir, pool).initialize()
    assert.equal(third.get('clients', 'new-client'), undefined)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('a fresh PostgreSQL database starts empty and seeds only essential settings', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'core-cut-postgres-clean-test-'))
  try {
    writeFileSync(
      join(dataDir, 'arcoplan-db.json'),
      JSON.stringify({
        meta: { version: 1, counters: {}, createdAt: '2026-01-01T00:00:00.000Z' },
        collections: { clients: [{ id: 'keep-out', name: 'Do not import' }], projects: [{ id: 'legacy-project' }] },
        sessions: [],
      }),
    )
    const pool = new MemoryPool()
    const db = await new PostgresDatabase(dataDir, pool).initialize()

    assert.deepEqual(db.list('clients'), [])
    assert.deepEqual(db.list('projects'), [])
    seedDefaults(db)
    await db.flush()

    const fresh = await new PostgresDatabase(dataDir, pool).initialize()
    assert.deepEqual(fresh.list('clients'), [])
    assert.deepEqual(fresh.list('projects'), [])
    assert.equal(fresh.get('settings', 'company').name, 'Core Cut ERP')
    assert.equal(fresh.get('users', fresh.list('users')[0].id).passwordMustChange, true)
    assert.equal(fresh.list('workCenters').length, 7)
    assert.deepEqual(fresh.list('bankAccounts'), [])
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
