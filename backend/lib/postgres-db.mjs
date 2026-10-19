import { existsSync } from 'node:fs'
import { Database } from './db.mjs'
import { applyMigrations } from './migrations.mjs'

const clone = (value) => JSON.parse(JSON.stringify(value))
const documentKey = (collection, id) => `${collection}\0${id}`

export class PostgresDatabase extends Database {
  constructor(dataDir, pool, { importJson = process.env.DATABASE_IMPORT_JSON === '1' } = {}) {
    super(dataDir)
    this.pool = pool
    this.importJson = importJson
    this.isPostgres = true
    this.schemaVersion = null
    this.persistedDocuments = new Map()
    this.flushPromise = null
  }

  async initialize() {
    this.schemaVersion = await applyMigrations(this.pool)

    const [documents, runtime] = await Promise.all([
      this.pool.query('SELECT collection, id, document FROM core_cut_documents'),
      this.pool.query('SELECT state FROM core_cut_runtime WHERE id = 1'),
    ])

    if (documents.rowCount || runtime.rowCount) {
      const collections = {}
      for (const row of documents.rows) (collections[row.collection] ??= []).push(row.document)
      const saved = runtime.rows[0]?.state
      this.state = {
        meta: saved?.meta ?? { version: 1, counters: {}, createdAt: new Date().toISOString() },
        collections,
        sessions: saved?.sessions ?? [],
      }
    } else if (existsSync(this.file) && this.importJson) {
      console.info('[db] Importando o banco JSON existente para o PostgreSQL vazio por configuração explícita.')
      await this.persistSnapshot(clone(this.state))
    } else {
      this.state = { meta: { version: 1, counters: {}, createdAt: new Date().toISOString() }, collections: {}, sessions: [] }
      if (existsSync(this.file)) console.info('[db] PostgreSQL vazio: o banco JSON local foi preservado e não será importado.')
    }

    this.persistedDocuments = this.indexDocuments(this.state.collections)
    this.dirty = false
    return this
  }

  touch() {
    this.dirty = true
    if (!this.timer) this.scheduleFlush(300)
  }

  scheduleFlush(delay) {
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush().catch((error) => {
        console.error('[db] Falha ao salvar alterações no PostgreSQL; uma nova tentativa será feita.', error)
        this.scheduleFlush(5000)
      })
    }, delay)
  }

  flush() {
    if (this.flushPromise) return this.flushPromise.then(() => (this.dirty ? this.flush() : undefined))
    if (!this.dirty) return Promise.resolve()
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.dirty = false
    const snapshot = clone(this.state)
    this.flushPromise = this.persistSnapshot(snapshot)
      .catch((error) => {
        this.dirty = true
        throw error
      })
      .finally(() => {
        this.flushPromise = null
        if (this.dirty && !this.timer) this.scheduleFlush(300)
      })
    return this.flushPromise
  }

  async persistSnapshot(snapshot) {
    const client = await this.pool.connect()
    const nextIndex = this.indexDocuments(snapshot.collections)
    try {
      await client.query('BEGIN')
      const collections = new Set([
        ...[...this.persistedDocuments.keys()].map((key) => key.slice(0, key.indexOf('\0'))),
        ...Object.keys(snapshot.collections),
      ])

      for (const collection of collections) {
        const documents = snapshot.collections[collection] ?? []
        const currentIds = new Set(documents.map((document) => document.id))
        const removedIds = [...this.persistedDocuments.keys()]
          .filter((key) => key.startsWith(`${collection}\0`) && !currentIds.has(key.slice(collection.length + 1)))
          .map((key) => key.slice(collection.length + 1))
        if (removedIds.length) {
          await client.query('DELETE FROM core_cut_documents WHERE collection = $1 AND id = ANY($2::text[])', [collection, removedIds])
        }

        const changed = documents.filter((document) => this.persistedDocuments.get(documentKey(collection, document.id)) !== JSON.stringify(document))
        if (changed.length) {
          await client.query(
            `INSERT INTO core_cut_documents (collection, id, document)
             SELECT $1, document->>'id', document
             FROM jsonb_array_elements($2::jsonb) AS items(document)
             ON CONFLICT (collection, id) DO UPDATE SET document = EXCLUDED.document`,
            [collection, JSON.stringify(changed)],
          )
        }
      }

      const runtime = JSON.stringify({ meta: snapshot.meta, sessions: snapshot.sessions })
      await client.query(
        `INSERT INTO core_cut_runtime (id, state) VALUES (1, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state`,
        [runtime],
      )
      await client.query('COMMIT')
      this.persistedDocuments = nextIndex
    } catch (error) {
      await client.query('ROLLBACK').catch((rollbackError) => {
        console.error('[db] Falha ao reverter a transação PostgreSQL.', rollbackError)
      })
      throw error
    } finally {
      client.release()
    }
  }

  indexDocuments(collections) {
    const index = new Map()
    for (const [collection, documents] of Object.entries(collections)) {
      for (const document of documents) index.set(documentKey(collection, document.id), JSON.stringify(document))
    }
    return index
  }

  async checkHealth() {
    await this.pool.query('SELECT 1')
  }

  async close() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flush()
    await this.pool.end()
  }
}
