// Publica o APK do aplicativo Android no servidor (ainda local): guarda em backend/assets, FORA da pasta pública,
// e grava a versão. O arquivo só é entregue por link temporário a quem tem o plano Profissional ou Industrial.
//   node scripts/publish-apk.mjs <caminho do .apk> <versionName> <versionCode>
// Depois é só enviar o projeto ao servidor (deploy\enviar.ps1 + publicar.sh --build).
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , apk, versionName, versionCode] = process.argv
if (!apk || !versionName || !versionCode) {
  console.error('Uso: node scripts/publish-apk.mjs <arquivo.apk> <versionName> <versionCode>')
  process.exit(1)
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const assets = join(root, 'backend', 'assets')
const publicDir = join(root, 'public', 'downloads')
mkdirSync(assets, { recursive: true })
mkdirSync(publicDir, { recursive: true })
const target = join(assets, 'core-cut-erp.apk')
copyFileSync(apk, target)
const info = {
  versionName,
  versionCode: Number(versionCode),
  sizeBytes: statSync(target).size,
  sha256: createHash('sha256').update(readFileSync(target)).digest('hex'),
  builtAt: new Date().toISOString(),
}
writeFileSync(join(assets, 'app-version.json'), JSON.stringify(info, null, 2))
// cópia pública só com o número da versão: o aplicativo instalado consulta para avisar que há atualização
writeFileSync(join(publicDir, 'app-version.json'), JSON.stringify({ versionName: info.versionName, versionCode: info.versionCode, builtAt: info.builtAt }, null, 2))
console.log(`Publicado em ${target}`)
console.log(JSON.stringify(info, null, 2))
