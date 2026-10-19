import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeZip } from '../src/lib/zip.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const extensionDir = join(root, 'browser-extension')
const files = readdirSync(extensionDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => ({ name: entry.name, content: readFileSync(join(extensionDir, entry.name), 'utf8') }))

if (!files.some((file) => file.name === 'manifest.json')) {
  throw new Error('A pasta da extensão não contém manifest.json.')
}

const archive = Buffer.from(await makeZip(files).arrayBuffer())
const outputs = [
  join(root, 'release', 'core-cut-erp-extension.zip'),
  join(root, 'public', 'downloads', 'core-cut-erp-extension.zip'),
]

for (const output of outputs) {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, archive)
  console.info(`[extension] Pacote criado: ${output}`)
}
