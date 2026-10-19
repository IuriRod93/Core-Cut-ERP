import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LeoCatalog } from '../backend/lib/catalog.mjs'
import { ensureLeoSupplier, materialFromCatalog } from '../backend/lib/catalog-utils.mjs'
import { loadDemo } from '../backend/lib/demo.mjs'
import { seedDefaults } from '../backend/lib/seed.mjs'
import { dataDir, filesDir, openLocalDatabase } from './local-db.mjs'

let db
try {
  db = await openLocalDatabase()
  seedDefaults(db)
  const baseCollections = new Set(['users', 'settings', 'workCenters', 'auditLogs'])
  const existingBusinessData = Object.entries(db.state.collections)
    .filter(([name]) => !baseCollections.has(name))
    .some(([, docs]) => docs.length > 0)
  if (existingBusinessData || Object.values(db.state.collections).some((docs) => docs.some((doc) => doc.demo === true))) {
    throw new Error('O banco precisa estar limpo. Use npm run db:reset -- --confirm antes de carregar o cenário demo.')
  }
  mkdirSync(filesDir, { recursive: true })
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
  const catalog = new LeoCatalog(join(root, 'backend', 'catalog', 'leo-madeiras.json'))
  const counts = await loadDemo(db, {
    catalog,
    ensureLeoSupplier: () => ensureLeoSupplier(db),
    materialFromCatalog,
    filesDir,
  })
  await db.flush()
  console.log(`Dados demo carregados: ${JSON.stringify(counts)}`)
} catch (error) {
  console.error(`[db:seed-demo] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await db?.close().catch(() => {})
}
