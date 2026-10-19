import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'

const SESSION_HOURS = 12
const MAX_FAILURES = 6
const LOCK_MINUTES = 10

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

/** Hash fixo usado para gastar o mesmo tempo quando o usuário não existe (evita enumerar e-mails pelo tempo de resposta). */
export const DUMMY_HASH = hashPassword('senha-que-nunca-sera-usada')

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false
  const [scheme, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const candidate = scryptSync(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

const COMMON_PASSWORDS = new Set([
  '12345678', '123456789', '1234567890', '12341234', '87654321', '11111111', '00000000', 'password', 'password1', 'senha123', 'senha1234',
  'senhasenha', 'qwerty123', 'qwertyui', 'abc12345', 'abcd1234', 'arcoplan123', 'arcoplan', 'corecut123', 'corecut1234', 'corecut',
  'admin123', 'admin1234', 'administrador', 'mudar123', 'mudar1234', 'teste123', 'teste1234', 'brasil123', 'brasil2024', 'brasil2025',
  'iloveyou', 'marcenaria', 'marcenaria123', 'movelaria', 'trocar123', 'mudeme123', 'bemvindo', 'bemvindo1', 'bemvindo123',
])

/**
 * Motivo pelo qual uma senha é fraca demais (ou null se aceitável). Comprimento mínimo 8, sem senhas
 * conhecidas, sem repetição/sequência simples e sem ser o próprio e-mail ou nome do usuário.
 */
export function passwordProblem(password, { email = '', name = '' } = {}) {
  const value = String(password ?? '')
  if (value.length < 8) return 'A senha deve ter pelo menos 8 caracteres.'
  if (value.length > 200) return 'A senha é longa demais.'
  const flat = value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const weak = 'Escolha uma senha menos previsível: evite sequências, repetições e palavras comuns.'
  if (COMMON_PASSWORDS.has(flat)) return weak
  if (/^(.)\1+$/.test(flat)) return weak
  const digitsOnly = /^\d+$/.test(flat)
  if (digitsOnly && (flat.length < 10 || '01234567890123456789'.includes(flat) || '98765432109876543210'.includes(flat))) return weak
  if (/^[a-z]+$/.test(flat) && 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'.includes(flat)) return weak
  const local = String(email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
  if (local.length >= 4 && (flat === local || flat.includes(local))) return 'A senha não pode conter o seu e-mail.'
  const firstName = String(name ?? '').trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? ''
  if (firstName.length >= 4 && flat === firstName) return 'A senha não pode ser o seu nome.'
  return null
}

const digest = (token) => createHash('sha256').update(token).digest('hex')

export class Sessions {
  constructor(db) {
    this.db = db
    this.failures = new Map()
  }

  create(userId, meta = {}) {
    const token = randomBytes(32).toString('hex')
    const now = Date.now()
    this.purge()
    this.db.state.sessions.push({
      key: digest(token),
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_HOURS * 3_600_000).toISOString(),
      ip: meta.ip ?? '',
      agent: String(meta.agent ?? '').slice(0, 160),
    })
    this.db.touch()
    return token
  }

  resolve(token) {
    if (!token) return null
    const key = digest(token)
    const session = this.db.state.sessions.find((s) => s.key === key)
    if (!session) return null
    if (new Date(session.expiresAt).getTime() < Date.now()) return null
    return session
  }

  slide(session) {
    session.expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString()
    // A renovação precisa chegar ao armazenamento persistente quando o
    // backend usa PostgreSQL; caso contrário, um reinício perderia o slide.
    this.db.touch()
  }

  destroy(token) {
    const key = digest(token)
    this.db.state.sessions = this.db.state.sessions.filter((s) => s.key !== key)
    this.db.touch()
  }

  /** Encerra todas as sessões do usuário, exceto a do token informado (troca de senha). */
  destroyOthers(userId, token) {
    const keep = token ? digest(token) : null
    this.db.state.sessions = this.db.state.sessions.filter((s) => s.userId !== userId || s.key === keep)
    this.db.touch()
  }

  destroyAllFor(userId) {
    this.db.state.sessions = this.db.state.sessions.filter((s) => s.userId !== userId)
    this.db.touch()
  }

  purge() {
    const now = Date.now()
    this.db.state.sessions = this.db.state.sessions.filter((s) => new Date(s.expiresAt).getTime() > now)
  }

  // Bloqueio simples contra força bruta, por e-mail + IP.
  isLocked(id) {
    const entry = this.failures.get(id)
    if (!entry) return 0
    if (entry.lockedUntil && entry.lockedUntil > Date.now()) return Math.ceil((entry.lockedUntil - Date.now()) / 60000)
    return 0
  }

  fail(id) {
    const entry = this.failures.get(id) ?? { count: 0, lockedUntil: 0 }
    entry.count += 1
    if (entry.count >= MAX_FAILURES) {
      entry.lockedUntil = Date.now() + LOCK_MINUTES * 60_000
      entry.count = 0
    }
    this.failures.set(id, entry)
  }

  clearFailures(id) {
    this.failures.delete(id)
  }
}
