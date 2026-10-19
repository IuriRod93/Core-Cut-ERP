export const MIGRATIONS = [
  {
    id: '001_documents_runtime',
    async up(client) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS core_cut_documents (
          collection text NOT NULL,
          id text NOT NULL,
          document jsonb NOT NULL,
          PRIMARY KEY (collection, id)
        )
      `)
      await client.query(`
        CREATE TABLE IF NOT EXISTS core_cut_runtime (
          id smallint PRIMARY KEY CHECK (id = 1),
          state jsonb NOT NULL
        )
      `)
    },
  },
]

export const CURRENT_SCHEMA_VERSION = MIGRATIONS.at(-1)?.id ?? null

export async function applyMigrations(pool) {
  const client = await pool.connect()
  try {
    // Evita corrida durante reinícios rápidos do node --watch ou de duas
    // instâncias que estejam iniciando ao mesmo tempo.
    await client.query("SELECT pg_advisory_lock(hashtext('core-cut-schema-migrations'))")
    await client.query(`
      CREATE TABLE IF NOT EXISTS core_cut_schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const applied = await client.query('SELECT id FROM core_cut_schema_migrations')
    const appliedIds = new Set(applied.rows.map((row) => row.id))

    for (const migration of MIGRATIONS) {
      if (appliedIds.has(migration.id)) continue
      await client.query('BEGIN')
      try {
        await migration.up(client)
        await client.query('INSERT INTO core_cut_schema_migrations (id) VALUES ($1)', [migration.id])
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('core-cut-schema-migrations'))").catch(() => {})
    client.release()
  }

  return CURRENT_SCHEMA_VERSION
}
