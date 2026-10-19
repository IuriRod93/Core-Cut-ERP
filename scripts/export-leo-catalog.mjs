// Exporta o catálogo da Leo Madeiras (chapas, ferragens e fitas de borda) do
// banco SQLite do IROD-Orça para backend/catalog/leo-madeiras.json.
//
// - Lê SOMENTE as tabelas de catálogo (materials, hardware, edge_bands).
//   Credenciais, clientes e orçamentos do Orça nunca são tocados.
// - Preços permanecem em REAIS (BRL) — sem conversão de moeda.
// - Seguro para reexecutar: o arquivo gerado é substituído por inteiro e o
//   ERP reaplica os preços aos materiais pelo código (Estoque > Catálogo >
//   "Atualizar preços do estoque").
//
// Uso: node scripts/export-leo-catalog.mjs [caminho/para/irod-orca.sqlite3]
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const defaultDb = join(process.env.APPDATA ?? '', 'irod-orca', 'irod-orca.sqlite3')
const dbPath = process.argv[2] ?? process.env.LEO_ORCA_DB ?? defaultDb
const outFile = join(root, 'backend', 'catalog', 'leo-madeiras.json')

if (!existsSync(dbPath)) {
  console.error(`Banco do IROD-Orça não encontrado em: ${dbPath}`)
  console.error('Informe o caminho: node scripts/export-leo-catalog.mjs "C:\\...\\irod-orca.sqlite3"')
  process.exit(1)
}

// Trabalha numa cópia para não disputar lock/WAL com o aplicativo aberto.
const tmp = mkdtempSync(join(tmpdir(), 'arcoplan-leo-'))
const copy = join(tmp, 'orca.sqlite3')
copyFileSync(dbPath, copy)
for (const ext of ['-wal', '-shm']) {
  if (existsSync(dbPath + ext)) copyFileSync(dbPath + ext, copy + ext)
}

const db = new DatabaseSync(copy, { readOnly: true })
const round2 = (n) => Math.round(Number(n) * 100) / 100
const money = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) || Number(n) <= 0 ? null : round2(n))
const text = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())

const hardwareCategory = (name) => {
  const n = name.toLowerCase()
  const rules = [
    [/dobradi/, 'Dobradiças'],
    [/corredi/, 'Corrediças'],
    [/puxador|cava|alça/, 'Puxadores'],
    [/kit porta|porta de correr|trilho|roldana|perfil.*(porta|correr)/, 'Portas de correr'],
    [/articulador|pist[aã]o|amortecedor|basculante|elevat/, 'Mecanismos e pistões'],
    [/led|fita de led|driver|fonte|sensor|spot|luminária|luminaria/, 'Iluminação'],
    [/cabideiro|sapateira|aramado|cesto|organizador|porta[- ]?objetos/, 'Organizadores'],
    [/parafuso|cavilha|minifix|tambor|bucha|prego|pino|rebite|arruela|porca/, 'Fixação'],
    [/p[eé]\b|p[eé]s |rodízio|rodizio|nivelador|sapata/, 'Pés e rodízios'],
    [/fechadura|trava|chave|tranca/, 'Fechaduras'],
    [/perfil|alumínio|aluminio|cantoneira|rodap/, 'Perfis'],
    [/cola|silicone|veda|fita dupla|lixa|verniz|tinta|selador|massa/, 'Insumos'],
  ]
  for (const [re, label] of rules) if (re.test(n)) return label
  return 'Ferragens e acessórios'
}

const sheetCategory = (name, family) => {
  const n = name.toLowerCase()
  if (/meia chapa/.test(n)) return 'Meia chapa'
  if (/canaletad|ripad/.test(n)) return 'MDF canaletado'
  if (/cru/.test(n)) return 'MDF cru'
  if (/compensado/.test(n)) return 'Compensado'
  if (/mdp/.test(n)) return 'MDP'
  if (/osb/.test(n)) return 'OSB'
  return family && family.toUpperCase() !== 'MDF' ? family : 'MDF revestido'
}

const items = []

for (const r of db.prepare('SELECT * FROM materials WHERE active = 1').all()) {
  const w = Number(r.sheet_width_mm) || null
  const h = Number(r.sheet_height_mm) || null
  const areaM2 = w && h ? (w * h) / 1_000_000 : null
  const perSheet = money(r.price_per_sheet) ?? (money(r.price_per_m2) && areaM2 ? round2(r.price_per_m2 * areaM2) : null)
  items.push({
    id: `leo-${r.code}`,
    kind: 'chapa',
    code: text(r.code),
    name: text(r.name),
    category: sheetCategory(text(r.name), text(r.family)),
    brand: text(r.brand) || null,
    thickness: Number(r.thickness_mm) || null,
    width: w,
    height: h,
    unit: 'chapa',
    price: perSheet,
    pricePerM2: perSheet && areaM2 ? round2(perSheet / areaM2) : null,
    image: text(r.image_url) || null,
    url: text(r.source_url) || null,
    updatedAt: text(r.updated_at) || null,
  })
}

for (const r of db.prepare('SELECT * FROM hardware WHERE active = 1').all()) {
  items.push({
    id: `leo-${r.code}`,
    kind: 'ferragem',
    code: text(r.code),
    name: text(r.name),
    category: hardwareCategory(text(r.name)),
    brand: text(r.supplier) || null,
    thickness: null,
    width: null,
    height: null,
    unit: text(r.unit) || 'un',
    price: money(r.unit_price),
    pricePerM2: null,
    image: text(r.image_url) || null,
    url: text(r.source_url) || null,
    updatedAt: text(r.updated_at) || null,
  })
}

for (const r of db.prepare('SELECT * FROM edge_bands WHERE active = 1').all()) {
  items.push({
    id: `leo-${r.code}`,
    kind: 'fita',
    code: text(r.code),
    name: text(r.name),
    category: 'Fita de borda',
    brand: (text(r.name).match(/\b(Rehau|Tecnoplast|Fitas Brasil|Duratex|Arauco|Guararapes|Berneck|Eucatex|Greenplac|Sudati|Fibraplac)\b/i) ?? [null])[0],
    thickness: Number(r.thickness_mm) || null,
    width: Number(r.width_mm) || null,
    height: Number(r.roll_length_m) ? Number(r.roll_length_m) * 1000 : null,
    unit: 'm',
    price: money(r.price_per_meter),
    pricePerM2: null,
    image: text(r.image_url) || null,
    url: text(r.source_url) || null,
    updatedAt: text(r.updated_at) || null,
  })
}

db.close()
rmSync(tmp, { recursive: true, force: true })

const summary = items.reduce((acc, i) => {
  acc[i.kind] = acc[i.kind] ?? { total: 0, comPreco: 0 }
  acc[i.kind].total += 1
  if (i.price !== null) acc[i.kind].comPreco += 1
  return acc
}, {})

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(
  outFile,
  JSON.stringify({ supplier: 'Leo Madeiras', currency: 'BRL', generatedAt: new Date().toISOString(), summary, items }),
  'utf8',
)
console.log('Catálogo Leo Madeiras exportado:', outFile)
console.table(summary)
