import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

const AUDIT_LIMIT = 20000
const BACKUP_KEEP = 14

/**
 * Coleções que não pertencem a uma empresa (inquilino): cadastro de empresas,
 * eventos de cobrança e notificações (já filtradas por usuário).
 */
export const GLOBAL_COLLECTIONS = new Set(['companies', 'billingEvents', 'billingCheckouts', 'notifications', 'passwordResets'])

/** Coleções cujos documentos usam ids lógicos fixos ("company", "taskStatuses"…). */
const KEYED_COLLECTIONS = new Set(['settings'])

/**
 * Banco de dados em arquivo JSON com escrita atômica (tmp + rename),
 * gravação com debounce e backup diário rotativo. Adequado para um ERP de
 * uma fábrica (dezenas de usuários); a interface isola a troca por Postgres.
 *
 * Multiempresa: cada requisição autenticada roda dentro de `runAsTenant(id)`.
 * Nesse contexto `col/list/get/update/remove/insert/nextCode` enxergam apenas
 * os documentos da empresa (`companyId`); o tenant `null` é a base original,
 * anterior ao cadastro de empresas. Fora do contexto (agendador, login,
 * webhook) o acesso é global.
 */
export class Database {
  constructor(dataDir) {
    this.dataDir = dataDir
    this.file = join(dataDir, 'arcoplan-db.json')
    this.backupDir = join(dataDir, 'backups')
    mkdirSync(this.backupDir, { recursive: true })
    this.state = { meta: { version: 1, counters: {}, createdAt: new Date().toISOString() }, collections: {}, sessions: [] }
    this.timer = null
    this.dirty = false
    this.tenantStore = new AsyncLocalStorage()
    /** Gancho opcional `(collection, tenantId, doc) => void` chamado antes de cada inserção (limites do plano). */
    this.beforeInsert = null
    /** Gancho opcional `(collection, doc) => void` chamado depois de inserir ou alterar um documento. */
    this.afterWrite = null
    this.load()
  }

  load() {
    if (existsSync(this.file)) {
      try {
        this.state = JSON.parse(readFileSync(this.file, 'utf8'))
      } catch (error) {
        const broken = `${this.file}.corrompido-${Date.now()}`
        copyFileSync(this.file, broken)
        console.error(`[db] Arquivo corrompido (${error.message}). Cópia salva em ${broken}. Tentando último backup.`)
        const backups = readdirSync(this.backupDir).filter((f) => f.endsWith('.json')).sort()
        const last = backups.at(-1)
        if (last) this.state = JSON.parse(readFileSync(join(this.backupDir, last), 'utf8'))
      }
    }
    this.state.meta ??= { version: 1, counters: {}, createdAt: new Date().toISOString() }
    this.state.meta.counters ??= {}
    this.state.collections ??= {}
    this.state.sessions ??= []
  }

  // ------------------------------------------------------------ multiempresa
  /** Executa `fn` restrito à empresa `companyId` (`null` = base original sem empresa). */
  runAsTenant(companyId, fn) {
    return this.tenantStore.run({ companyId: companyId ?? null }, fn)
  }

  /** Empresa do contexto atual; `undefined` quando o acesso é global. */
  get tenant() {
    return this.tenantStore.getStore()?.companyId
  }

  scoped(name) {
    return this.tenant !== undefined && !GLOBAL_COLLECTIONS.has(name)
  }

  visible(name, doc) {
    if (!doc) return false
    if (!this.scoped(name)) return true
    return (doc.companyId ?? null) === this.tenant
  }

  /** Lista bruta (todas as empresas). Use apenas em login, webhook e rotinas de plataforma. */
  all(name) {
    return (this.state.collections[name] ??= [])
  }

  /** Converte um id lógico ("company") no id físico da empresa atual. */
  storageId(name, id) {
    return this.scoped(name) && this.tenant && KEYED_COLLECTIONS.has(name) ? `${this.tenant}:${id}` : id
  }

  /** Devolve o id lógico exposto ao cliente (remove o prefixo da empresa). */
  clientId(name, id) {
    const prefix = this.tenant ? `${this.tenant}:` : null
    return prefix && KEYED_COLLECTIONS.has(name) && String(id).startsWith(prefix) ? String(id).slice(prefix.length) : id
  }

  // ----------------------------------------------------------------- acesso
  col(name) {
    const list = this.all(name)
    return this.scoped(name) ? list.filter((doc) => (doc.companyId ?? null) === this.tenant) : list
  }

  list(name) {
    return this.col(name)
  }

  get(name, id) {
    const sid = this.storageId(name, id)
    const doc = this.all(name).find((d) => d.id === sid)
    return this.visible(name, doc) ? doc : undefined
  }

  insert(name, doc) {
    const now = new Date().toISOString()
    const record = { ...doc, id: doc.id ?? randomUUID(), createdAt: doc.createdAt ?? now, updatedAt: now }
    if (this.scoped(name)) {
      if (this.tenant) record.companyId = this.tenant
      else delete record.companyId
      if (KEYED_COLLECTIONS.has(name) && this.tenant && !String(record.id).startsWith(`${this.tenant}:`)) record.id = `${this.tenant}:${record.id}`
    }
    this.beforeInsert?.(name, this.tenant ?? null, record)
    this.all(name).push(record)
    this.touch()
    this.afterWrite?.(name, record)
    return record
  }

  /** Reinsere um documento exatamente como estava (restauração da lixeira), sem gancho de limite. */
  restore(name, doc) {
    const list = this.all(name)
    if (!list.some((d) => d.id === doc.id)) list.push(doc)
    this.touch()
    return doc
  }

  update(name, id, patch) {
    const list = this.all(name)
    const sid = this.storageId(name, id)
    const index = list.findIndex((d) => d.id === sid)
    if (index < 0 || !this.visible(name, list[index])) return null
    const { companyId: _ignored, ...safe } = patch
    const next = { ...list[index], ...safe, id: sid, createdAt: list[index].createdAt, updatedAt: new Date().toISOString() }
    list[index] = next
    this.touch()
    this.afterWrite?.(name, next)
    return next
  }

  remove(name, id) {
    const list = this.all(name)
    const sid = this.storageId(name, id)
    const index = list.findIndex((d) => d.id === sid)
    if (index < 0 || !this.visible(name, list[index])) return null
    const [removed] = list.splice(index, 1)
    this.touch()
    return removed
  }

  removeWhere(name, predicate) {
    const list = this.all(name)
    const removed = []
    const kept = []
    for (const doc of list) (this.visible(name, doc) && predicate(doc) ? removed : kept).push(doc)
    if (removed.length) {
      this.state.collections[name] = kept
      this.touch()
    }
    return removed
  }

  nextCode(prefix, width = 4) {
    const year = new Date().getFullYear()
    const key = `${this.tenant ? `${this.tenant}:` : ''}${prefix}-${year}`
    const next = (this.state.meta.counters[key] ?? 0) + 1
    this.state.meta.counters[key] = next
    this.touch()
    return `${prefix}-${year}-${String(next).padStart(width, '0')}`
  }

  audit(entry) {
    const logs = this.all('auditLogs')
    const companyId = this.tenant || undefined
    logs.push({ id: randomUUID(), at: new Date().toISOString(), ...entry, ...(companyId ? { companyId } : {}) })
    if (logs.length > AUDIT_LIMIT) logs.splice(0, logs.length - AUDIT_LIMIT)
    this.touch()
  }

  touch() {
    this.dirty = true
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 300)
  }

  flush() {
    if (!this.dirty) return
    this.dirty = false
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.state), 'utf8')
    renameSync(tmp, this.file)
    this.dailyBackup()
  }

  dailyBackup() {
    const stamp = new Date().toISOString().slice(0, 10)
    const target = join(this.backupDir, `arcoplan-${stamp}.json`)
    if (existsSync(target)) return
    copyFileSync(this.file, target)
    const old = readdirSync(this.backupDir).filter((f) => f.startsWith('arcoplan-')).sort()
    while (old.length > BACKUP_KEEP) unlinkSync(join(this.backupDir, old.shift()))
  }

  snapshot() {
    return JSON.parse(JSON.stringify({ ...this.state, sessions: [] }))
  }

  /** Cópia dos dados de uma única empresa (backup do cliente), sem sessões nem outras empresas. */
  tenantSnapshot(companyId) {
    const collections = {}
    for (const [name, docs] of Object.entries(this.state.collections)) {
      if (GLOBAL_COLLECTIONS.has(name)) continue
      // tokens do provedor fiscal não saem no backup do cliente (mesmo cifrados)
      if (name === 'fiscalSecrets' || name === 'faceProfiles' || name === 'faceChecks') continue
      collections[name] = docs.filter((d) => (d.companyId ?? null) === (companyId ?? null))
    }
    return JSON.parse(JSON.stringify({ meta: { version: this.state.meta.version, createdAt: this.state.meta.createdAt }, collections, sessions: [] }))
  }

  /** Remove todos os documentos de uma empresa (cadastro que não chegou a ser pago). */
  purgeTenant(companyId) {
    if (!companyId) return
    for (const [name, docs] of Object.entries(this.state.collections)) {
      if (GLOBAL_COLLECTIONS.has(name)) continue
      this.state.collections[name] = docs.filter((doc) => doc.companyId !== companyId)
    }
    this.touch()
  }

  replaceAll(snapshot) {
    this.state = { ...snapshot, sessions: this.state.sessions }
    this.state.meta ??= { version: 1, counters: {}, createdAt: new Date().toISOString() }
    this.state.meta.counters ??= {}
    this.state.collections ??= {}
    this.touch()
  }
}
