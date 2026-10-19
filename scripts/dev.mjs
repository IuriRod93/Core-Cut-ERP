// Inicia API e interface juntas, escolhendo portas livres e conectando o proxy da API.
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from 'node:net'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const procs = []
let closing = false

async function isPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.setTimeout(500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('timeout', () => {
      socket.destroy()
      reject(new Error(`Tempo esgotado ao verificar a porta ${port}.`))
    })
    socket.once('error', (error) => {
      if (error.code === 'ECONNREFUSED') resolve(true)
      else reject(error)
    })
  })
}

async function findAvailablePort(start) {
  for (let port = start; port < start + 100; port++) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`Não encontrei uma porta livre entre ${start} e ${start + 99}.`)
}

const run = (name, args, color, env) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env })
  const tag = `\x1b[${color}m[${name}]\x1b[0m`
  const pipe = (stream) =>
    stream.on('data', (chunk) =>
      String(chunk)
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => console.log(`${tag} ${line}`)),
    )
  pipe(child.stdout)
  pipe(child.stderr)
  child.on('error', (error) => {
    console.error(`${tag} não foi iniciado: ${error.message}`)
    void shutdown(1)
  })
  child.on('exit', (code, signal) => {
    console.log(`${tag} encerrado (${code})`)
    if (!closing) void shutdown(code ?? (signal ? 1 : 0))
  })
  procs.push(child)
}

async function shutdown(code = 0) {
  if (closing) return
  closing = true
  const pending = procs
    .filter((child) => child.exitCode === null && !child.killed)
    .map((child) => new Promise((resolve) => {
      child.once('exit', resolve)
      child.kill()
    }))
  await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, 3000))])
  process.exitCode = code
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

try {
  const apiPort = Number(process.env.PORT) || await findAvailablePort(4400)
  const webPort = Number(process.env.VITE_PORT) || await findAvailablePort(5173)
  const apiUrl = `http://127.0.0.1:${apiPort}`

  run('api', ['--watch', '--watch-path=backend', 'backend/server.mjs'], 36, {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(apiPort),
  })
  run('web', [join('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1'], 35, {
    ...process.env,
    ARCOPLAN_API_URL: apiUrl,
    VITE_HOST: '127.0.0.1',
    VITE_PORT: String(webPort),
  })
  console.log(`\nCore Cut ERP em desenvolvimento → http://localhost:${webPort}/login`)
  console.log(`API → ${apiUrl}/api/health\n`)
} catch (error) {
  console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`)
  await shutdown(1)
}
