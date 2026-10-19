import { clearLocalFiles, emptyState, openLocalDatabase } from './local-db.mjs'
import { seedDefaults } from '../backend/lib/seed.mjs'

if (!process.argv.includes('--confirm')) {
  console.error('Este comando remove todos os dados do ERP local.')
  console.error('Confirme explicitamente com: npm run db:reset -- --confirm')
  process.exitCode = 2
} else {
  let db
  try {
    db = await openLocalDatabase()
    const before = Object.values(db.state.collections).reduce((total, docs) => total + docs.length, 0)
    const previousCollections = db.state.collections
    db.state = emptyState()
    db.persistedDocuments = db.indexDocuments(previousCollections)
    seedDefaults(db)
    await db.flush()
    const files = clearLocalFiles()
    console.log(`Banco local resetado: ${before} registros removidos, ${files} arquivo(s) removido(s).`)
    console.log('Configuração inicial recriada: admin, empresa e centros de trabalho.')
  } catch (error) {
    console.error(`[db:reset] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  } finally {
    await db?.close().catch(() => {})
  }
}
