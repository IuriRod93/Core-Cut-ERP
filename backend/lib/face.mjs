import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

/**
 * Verificação facial do aplicativo do Core Cut.
 *
 * - Motor: @vladmandic/face-api (modelos incluídos no pacote) em WebAssembly, sem dependência nativa.
 *   A foto vira um vetor de 128 números; "a mesma pessoa" é a distância entre dois vetores.
 * - Guardamos o vetor e a foto cadastrada CIFRADOS (AES-256-GCM). A foto de cada tentativa é mantida só por 30 dias.
 * - Limite honesto: não há detecção de "prova de vida" (uma foto impressa de boa qualidade pode enganar). Por isso o
 *   rosto vale como segunda verificação do aparelho, não como substituto de uma senha forte.
 */

const require = createRequire(import.meta.url)

/** Distância máxima entre rostos da mesma pessoa (0,6 é o padrão da biblioteca; 0,5 é mais rígido). */
export const FACE_MATCH_DISTANCE = 0.5
export const FACE_CHECK_RETENTION_DAYS = 30
const MAX_IMAGE_BYTES = 500 * 1024
const MAX_SIDE = 1600

export const euclidean = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return Infinity
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2
  return Math.sqrt(sum)
}

/** JPEG vindo do aplicativo em base64 (aceita o prefixo data:). */
export function decodeImage(base64) {
  const clean = String(base64 ?? '').replace(/^data:image\/[a-z]+;base64,/i, '').replace(/\s/g, '')
  if (!clean || clean.length > MAX_IMAGE_BYTES * 1.4) return null
  const buffer = Buffer.from(clean, 'base64')
  if (buffer.length < 200 || buffer.length > MAX_IMAGE_BYTES) return null
  return buffer
}

// -------------------------------------------------------------------- motores
/** Motor de teste: a "imagem" é um texto "pessoa:<nome>" (ou "sem-rosto", "dois-rostos"). */
export function createFakeFaceEngine() {
  const vector = (name) => {
    const seed = createHash('sha256').update(name).digest()
    return Array.from({ length: 128 }, (_, i) => (seed[i % seed.length] / 255) * 0.5)
  }
  return {
    name: 'fake',
    async available() {
      return { ok: true }
    },
    async describe(buffer) {
      const text = buffer.toString('utf8')
      if (text.startsWith('sem-rosto')) return { ok: false, reason: 'sem_rosto' }
      if (text.startsWith('dois-rostos')) return { ok: false, reason: 'varios_rostos' }
      const name = /^pessoa:(.+)$/.exec(text)?.[1]
      if (!name) return { ok: false, reason: 'imagem_invalida' }
      return { ok: true, descriptor: vector(name.trim()), score: 0.99 }
    },
  }
}

/** Motor real: SSD MobileNet (detecção) + 68 pontos + rede de reconhecimento. Carrega só no primeiro uso. */
export function createFaceEngine() {
  let ready = null
  let failure = null
  let queue = Promise.resolve()

  const load = () =>
    (ready ??= (async () => {
      const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js')
      const wasm = require('@tensorflow/tfjs-backend-wasm')
      const jpeg = require('jpeg-js')
      const modelDir = join(dirname(require.resolve('@vladmandic/face-api/package.json')), 'model')
      const wasmDir = join(dirname(require.resolve('@tensorflow/tfjs-backend-wasm/package.json')), 'dist') + sep
      wasm.setWasmPaths(wasmDir, false)
      await faceapi.tf.setBackend('wasm')
      await faceapi.tf.ready()
      await faceapi.nets.ssdMobilenetv1.loadFromDisk(modelDir)
      await faceapi.nets.faceLandmark68Net.loadFromDisk(modelDir)
      await faceapi.nets.faceRecognitionNet.loadFromDisk(modelDir)
      return { faceapi, jpeg }
    })().catch((error) => {
      failure = error
      ready = null
      throw error
    }))

  return {
    name: 'face-api-wasm',
    async available() {
      try {
        await load()
        return { ok: true }
      } catch (error) {
        return { ok: false, reason: String(error?.message ?? failure ?? error).slice(0, 160) }
      }
    },
    /** Uma imagem por vez (o WebAssembly roda em uma thread). */
    describe(buffer) {
      const run = async () => {
        const { faceapi, jpeg } = await load()
        if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return { ok: false, reason: 'imagem_invalida' }
        let raw
        try {
          raw = jpeg.decode(buffer, { useTArray: true, formatAsRGBA: false, maxMemoryUsageInMB: 96 })
        } catch {
          return { ok: false, reason: 'imagem_invalida' }
        }
        if (!raw?.width || !raw?.height || raw.width > MAX_SIDE || raw.height > MAX_SIDE) return { ok: false, reason: 'imagem_invalida' }
        const tensor = faceapi.tf.tensor3d(raw.data, [raw.height, raw.width, 3], 'int32')
        try {
          const found = await faceapi
            .detectAllFaces(tensor, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
            .withFaceLandmarks()
            .withFaceDescriptors()
          if (found.length === 0) return { ok: false, reason: 'sem_rosto' }
          if (found.length > 1) return { ok: false, reason: 'varios_rostos' }
          const [face] = found
          const box = face.detection.box
          if (box.width < raw.width * 0.22) return { ok: false, reason: 'rosto_pequeno' }
          return { ok: true, descriptor: Array.from(face.descriptor, (n) => Math.round(n * 1e4) / 1e4), score: face.detection.score }
        } finally {
          tensor.dispose()
        }
      }
      const job = queue.then(run, run)
      queue = job.catch(() => undefined)
      return job
    },
  }
}

export const FACE_MESSAGES = {
  sem_rosto: 'Não encontramos um rosto na foto. Fique de frente para a câmera, com boa luz.',
  varios_rostos: 'Apareceu mais de um rosto na foto. Tire a foto sozinho(a).',
  rosto_pequeno: 'O rosto ficou muito pequeno. Aproxime o celular.',
  imagem_invalida: 'Não foi possível ler a foto. Tente de novo.',
}

// ------------------------------------------------------------------- tíquetes
/** Tíquete de curta duração entre "senha correta" e "rosto confirmado". Não é uma sessão. */
export function createTickets({ ttlMs = 5 * 60_000, maxTries = 5 } = {}) {
  const map = new Map()
  const sweep = () => {
    const now = Date.now()
    for (const [key, value] of map) if (value.expires < now) map.delete(key)
  }
  return {
    create(userId, extra = {}) {
      sweep()
      const id = randomBytes(24).toString('hex')
      map.set(id, { userId, expires: Date.now() + ttlMs, tries: 0, ...extra })
      return id
    },
    /** Devolve o tíquete válido ou null. `fail()` conta tentativa errada e encerra ao passar do limite. */
    get(id) {
      const entry = map.get(String(id ?? ''))
      if (!entry || entry.expires < Date.now()) return null
      return entry
    },
    fail(id) {
      const entry = map.get(String(id ?? ''))
      if (!entry) return 0
      entry.tries += 1
      if (entry.tries >= maxTries) map.delete(String(id))
      return Math.max(maxTries - entry.tries, 0)
    },
    consume(id) {
      map.delete(String(id ?? ''))
    },
  }
}

// --------------------------------------------------------------- armazenamento
/**
 * Perfis e verificações ficam em coleções internas (não expostas pelo CRUD genérico) e isoladas por empresa.
 * `box` é o cofre de cifra (createSecretBox).
 */
export function createFaceStore({ db, box }) {
  const profileOf = (userId) => db.col('faceProfiles').find((p) => p.userId === userId && p.status === 'ativo') ?? null

  return {
    profileOf,
    descriptorOf(profile) {
      try {
        return JSON.parse(box.open(profile.descriptor) ?? 'null')
      } catch {
        return null
      }
    },
    saveProfile({ userId, userName, descriptor, photo, device, consentVersion }) {
      for (const old of db.col('faceProfiles').filter((p) => p.userId === userId && p.status === 'ativo')) {
        db.update('faceProfiles', old.id, { status: 'substituido', replacedAt: new Date().toISOString() })
      }
      return db.insert('faceProfiles', {
        userId,
        userName,
        status: 'ativo',
        descriptor: box.seal(JSON.stringify(descriptor)),
        photo: box.seal(photo.toString('base64')),
        device: String(device ?? '').slice(0, 120),
        consentAt: new Date().toISOString(),
        consentVersion,
      })
    },
    revoke(profileId, by) {
      return db.update('faceProfiles', profileId, { status: 'revogado', revokedAt: new Date().toISOString(), revokedBy: by })
    },
    /** Registra a tentativa (com a foto) e apaga as mais antigas que o prazo de retenção. */
    recordCheck({ userId, userName, result, distance, photo, ip, device, kind }) {
      db.insert('faceChecks', {
        userId,
        userName,
        result,
        kind,
        distance: Number.isFinite(distance) ? Math.round(distance * 1000) / 1000 : null,
        ip,
        device: String(device ?? '').slice(0, 120),
        photo: photo ? box.seal(photo.toString('base64')) : null,
      })
      const cutoff = Date.now() - FACE_CHECK_RETENTION_DAYS * 86_400_000
      db.removeWhere('faceChecks', (c) => Date.parse(c.createdAt) < cutoff)
    },
    photoOf(doc) {
      const text = doc?.photo ? box.open(doc.photo) : null
      return text ? Buffer.from(text, 'base64') : null
    },
  }
}
