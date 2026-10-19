import 'dotenv/config'
import pg from 'pg'
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PostgresDatabase } from '../backend/lib/postgres-db.mjs'

const root = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'))
const localHosts = new Set(['localhost', '127.0.0.1', '::1'])

export const dataDir = resolve(root, process.env.ARCOPLAN_DATA_DIR ?? 'backend/data')
export const filesDir = join(dataDir, 'files')

export function requireLocalDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não está configurada. Este comando exige PostgreSQL.')
  const target = new URL(process.env.DATABASE_URL)
  const database = decodeURIComponent(target.pathname.replace(/^\//, ''))
  if (!localHosts.has(target.hostname) || database !== 'core_cut_erp') {
    throw new Error('Por segurança, este comando só pode operar em core_cut_erp local (localhost/127.0.0.1).')
  }
}

export async function openLocalDatabase() {
  requireLocalDatabase()
  mkdirSync(filesDir, { recursive: true })
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    application_name: 'core-cut-local-db-tool',
  })
  const db = await new PostgresDatabase(dataDir, pool, { importJson: false }).initialize()
  const otherConnections = await pool.query(`
    SELECT count(1)::int AS total
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND pid <> pg_backend_pid()
      AND application_name <> 'core-cut-local-db-tool'
  `)
  if (otherConnections.rows[0].total > 0) {
    await db.close()
    throw new Error('Outra conexão está usando o banco. Pare a API antes de executar este comando.')
  }
  return db
}

export function emptyState() {
  return { meta: { version: 1, counters: {}, createdAt: new Date().toISOString() }, collections: {}, sessions: [] }
}

export function clearLocalFiles() {
  if (!existsSync(filesDir)) return 0
  let removed = 0
  for (const name of readdirSync(filesDir)) {
    const target = join(filesDir, name)
    if (statSync(target).isFile()) {
      unlinkSync(target)
      removed += 1
    }
  }
  return removed
}
