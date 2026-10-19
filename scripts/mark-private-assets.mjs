// Depois do build: separa o que é PÚBLICO do que é código do APLICATIVO.
//
// Público = o que a página inicial, o login, o cadastro, a recuperação de senha, os termos e o link do
// cliente carregam (a árvore de imports estáticos do index.html). Todo o resto é código das telas internas
// (orçamentos, plano de corte, financeiro, painel admin...). O servidor só entrega esses arquivos
// a quem tem sessão válida. A lista fica em dist/private-assets.json (o servidor não a publica).
//
//   node scripts/mark-private-assets.mjs            # usa ./dist
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, posix } from 'node:path'
import { pathToFileURL } from 'node:url'

const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["']\.\/([^"'?#]+\.js)["']/g
const HTML_REF = /(?:src|href)=["']\/(assets\/[^"'?#]+\.js)["']/g

export function computePrivateAssets(distDir) {
  const index = join(distDir, 'index.html')
  const assetsDir = join(distDir, 'assets')
  if (!existsSync(index) || !existsSync(assetsDir)) return { privateFiles: [], publicFiles: [], reason: 'dist incompleto' }

  const html = readFileSync(index, 'utf8')
  const roots = [...html.matchAll(HTML_REF)].map((m) => m[1])
  if (roots.length === 0) return { privateFiles: [], publicFiles: [], reason: 'index.html sem script' }

  const all = readdirSync(assetsDir).filter((f) => f.endsWith('.js')).map((f) => posix.join('assets', f))
  const seen = new Set()
  const walk = (file) => {
    if (seen.has(file)) return
    seen.add(file)
    const path = join(distDir, file)
    if (!existsSync(path)) return
    const code = readFileSync(path, 'utf8')
    for (const match of code.matchAll(STATIC_IMPORT)) walk(posix.join(posix.dirname(file), match[1]))
  }
  roots.forEach(walk)
  const publicFiles = all.filter((f) => seen.has(f))
  const privateFiles = all.filter((f) => !seen.has(f))
  return { privateFiles, publicFiles, reason: null }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dist = process.argv[2] ?? 'dist'
  const { privateFiles, publicFiles, reason } = computePrivateAssets(dist)
  if (reason) {
    console.warn(`[privado] Nada separado (${reason}). O servidor entregará todos os arquivos.`)
    writeFileSync(join(dist, 'private-assets.json'), '[]')
  } else {
    writeFileSync(join(dist, 'private-assets.json'), JSON.stringify(privateFiles.sort(), null, 0))
    console.log(`[privado] ${privateFiles.length} arquivos do aplicativo exigem sessão; ${publicFiles.length} são públicos (página inicial, login, cadastro).`)
  }
}
