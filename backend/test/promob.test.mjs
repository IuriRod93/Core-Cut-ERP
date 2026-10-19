import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  autoMapMaterials,
  decodeBytes,
  importStats,
  parseCsv,
  parseNumber,
  parsePromobFiles,
  summarizeEdges,
  summarizeMaterials,
  suggestMaterial,
  toCutPieces,
} from '../../src/domain/promob.ts'
import { planGroups } from '../../src/domain/cutting.ts'
import { generateGcode } from '../../src/domain/gcode.ts'
import { DEFAULT_GCODE, totalsOf } from '../../src/domain/cutPlan.ts'
import { edgeMetersOf, offsetPolygon } from '../../src/domain/machining.ts'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const load = (...names) => parsePromobFiles(names.map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) })))

test('parseNumber lê formatos brasileiro e internacional', () => {
  assert.equal(parseNumber('984,5'), 984.5)
  assert.equal(parseNumber('1.234,5'), 1234.5)
  assert.equal(parseNumber('1,234.5'), 1234.5)
  assert.equal(parseNumber('2750'), 2750)
  assert.equal(parseNumber('103.62000274658203'), 103.62000274658203)
  assert.equal(parseNumber('1.234.567'), 1234567)
  assert.equal(parseNumber(''), 0)
})

test('parseCsv respeita aspas, quebras de linha e delimitador', () => {
  const rows = parseCsv('a;b;c\r\n1;"x;y";"linha1\nlinha2 ""aspas"""\r\n', ';')
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[1], ['1', 'x;y', 'linha1\nlinha2 "aspas"'])
})

test('decodeBytes detecta UTF-8 com BOM e cai para Windows-1252', () => {
  assert.equal(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x61])), 'a')
  assert.equal(decodeBytes(new Uint8Array([0x4d, 0xe9, 0x64])), 'Méd')
})

test('CSV lista de corte (Cut Pro): peças, material, chapa e fitas', () => {
  const imp = load('promob-lista.csv')
  assert.equal(imp.format, 'csv-lista')
  const s = importStats(imp)
  assert.equal(s.lines, 48)
  assert.equal(s.units, 60)
  const mats = summarizeMaterials(imp.parts)
  assert.deepEqual(mats.map((m) => m.name).sort(), ['Branco 15mm', 'Branco 6mm', 'Copenhagem 15mm'])
  const cop = mats.find((m) => m.name === 'Copenhagem 15mm')
  assert.equal(cop.sheetWidth, 2720)
  assert.equal(cop.sheetHeight, 1820)
  assert.equal(cop.thickness, 15)
  const p = imp.parts[0]
  assert.equal(p.label, 'Painel')
  assert.equal(p.length, 2360)
  assert.equal(p.width, 800)
  assert.ok(p.edges.top && p.edges.bottom && p.edges.left && p.edges.right)
  assert.ok(p.grain, 'VEIO = 1 impede girar')
  assert.equal(imp.info.client, 'LOJISTA ARTESANI-RODRIGO-DORMITORIO')
  const edges = summarizeEdges(imp.parts)
  assert.ok(edges.length >= 2, 'fitas separadas por acabamento')
  assert.ok(edges.reduce((t, e) => t + e.meters, 0) > 67 && edges.reduce((t, e) => t + e.meters, 0) < 68)
  assert.ok(edges.slice(0, 2).every((e) => e.height === 22))
  assert.equal(edges[0].name, "Noce Amêndoa")
})

test('CSV de peças: contorno em L, fitas parciais, furos por face e rasgos nos dois sentidos', () => {
  const imp = load('promob-pecas.csv')
  assert.equal(imp.format, 'csv-pecas')
  assert.equal(imp.parts.length, 3, 'itens sem matéria-prima ficam de fora')
  assert.ok(imp.warnings.some((w) => /sem matéria-prima/.test(w)))
  const [inf, sup, rod] = imp.parts
  assert.equal(inf.length, 984.5)
  assert.equal(inf.width, 784.5)
  assert.equal(inf.contour.length, 6, 'peça em L mantém o contorno')
  assert.equal(inf.thickness, 15)
  // fita nas arestas internas do L (434,5 + 234,5 mm) não coincide com o retângulo envolvente
  assert.equal(sup.edgeExtra, 669)
  assert.equal(sup.contour.filter((c) => c.edge).length, 2)
  assert.ok(Math.abs(edgeMetersOf({ ...sup, edgeTop: sup.edges.top, edgeBottom: sup.edges.bottom, edgeLeft: sup.edges.left, edgeRight: sup.edges.right }) - 0.669) < 1e-9)
  // rodapé 880×80: fita no lado y=0 (aresta do último vértice para o primeiro)
  assert.equal(rod.contour, undefined)
  assert.ok(rod.edges.bottom && !rod.edges.top && !rod.edges.left && !rod.edges.right)
  assert.equal(rod.edgeHeight, 22)
  // furos
  const byFace = (p, face) => p.machining.filter((m) => m.kind === 'furo' && m.face === face).length
  assert.equal(byFace(inf, 'topo'), 12)
  assert.equal(byFace(inf, 'fundo'), 10)
  assert.equal(rod.machining.filter((m) => m.face === 'borda').length, 4)
  const edgeFront = rod.machining.find((m) => m.face === 'borda' && m.y === 0)
  assert.ok(edgeFront && edgeFront.x > 0 && edgeFront.depth === 25)
  // rasgos: SlotType 1 → ao longo de x; 2 → ao longo de y
  const grooves = inf.machining.filter((m) => m.kind === 'rasgo')
  assert.deepEqual(grooves.map((g) => g.axis).sort(), ['x', 'y'])
  const gy = grooves.find((g) => g.axis === 'y')
  assert.equal(gy.x, 965.75)
  assert.equal(gy.length, 675)
  // diâmetros reais preservados
  assert.ok(inf.machining.some((m) => m.method === 'minifix_15' && m.diameter === 20))
})

test('CSV de peças em inglês (colunas traduzidas)', () => {
  const imp = load('promob-en.csv')
  assert.equal(imp.format, 'csv-pecas')
  assert.equal(importStats(imp).units, 9)
  const mats = summarizeMaterials(imp.parts)
  assert.deepEqual(mats.map((m) => m.name).sort(), ['White 13mm', 'White 19mm'])
  assert.equal(mats.find((m) => m.name === 'White 19mm').sheetWidth, 2438)
  const shelf = imp.parts.find((p) => /Internal Mobile Shelf/.test(p.label))
  assert.equal(shelf.length, 562)
  assert.equal(shelf.width, 519.6)
  assert.ok(shelf.edges.bottom)
  assert.equal(imp.info.client, 'ANGELA')
})

test('XML de listagem: peças, fitas por aresta, materiais e ferragens com multiplicador', () => {
  const imp = load('promob.xml')
  assert.equal(imp.format, 'xml')
  assert.equal(importStats(imp).units, 39)
  const mats = summarizeMaterials(imp.parts)
  assert.ok(mats.some((m) => m.name === 'Mint 15mm' && m.thickness === 15))
  assert.ok(mats.some((m) => m.name === 'Branco 6mm' && m.thickness === 6))
  const painel = imp.parts.find((p) => p.length === 1015 && p.width === 50)
  assert.ok(painel.edges.top && painel.edges.bottom && painel.edges.left && painel.edges.right, '4 bordas de 1015+5 e 50+5 mm')
  assert.equal(painel.edgeHeight, 22)
  assert.equal(imp.info.client, 'EPITACIO DE SOUZA BARBOSA NETO')
  const screws = imp.hardware.find((h) => h.reference === 'PARC4540')
  assert.equal(screws.quantity, 24)
  assert.ok(imp.warnings.some((w) => /coordenadas/.test(w)))
})

test('DXF por chapa: contornos, furos por face, rasgos e rótulos', () => {
  const imp = load('1_15MDFBRANCO15(CHAPA).dxf')
  assert.equal(imp.format, 'dxf')
  assert.equal(imp.parts.length, 8)
  const lateral = imp.parts.find((p) => p.ref === '55')
  assert.equal(lateral.label, 'Lateral esquerda')
  assert.equal(lateral.length, 2700)
  assert.ok(Math.abs(lateral.width - 571.5) < 0.1)
  assert.equal(lateral.thickness, 15)
  assert.equal(lateral.sheetWidth, 2750)
  assert.equal(lateral.sheetHeight, 1850)
  assert.equal(importStats(imp).grooves, 2)
  // furos dentro dos limites da peça
  for (const p of imp.parts)
    for (const m of p.machining) {
      assert.ok(m.x >= -0.5 && m.x <= p.length + 0.5, `x ${m.x} fora de ${p.length}`)
      assert.ok(m.y >= -0.5 && m.y <= p.width + 0.5, `y ${m.y} fora de ${p.width}`)
    }
  assert.ok(imp.parts.some((p) => p.machining.some((m) => m.face === 'fundo')), 'FACE B vira face inferior')
  const rasgo = imp.parts.flatMap((p) => p.machining).find((m) => m.kind === 'rasgo')
  assert.equal(rasgo.axis, 'x')
  assert.equal(rasgo.depth, 5)
  assert.ok(Math.abs(rasgo.width - 7) < 0.01)
})

test('DXF simples de peças (PARTS/LABELS) e vários DXFs juntos', () => {
  const simple = load('pecas_para_otimizador.dxf')
  assert.equal(importStats(simple).units, 14)
  assert.ok(simple.parts.some((p) => p.label === 'Fundo' && p.length === 2328 && p.width === 1018))
  const two = load('1_15MDFBRANCO15(CHAPA).dxf', '7_6MDFBRANCO6(CHAPA).dxf')
  const mats = summarizeMaterials(two.parts)
  assert.deepEqual(mats.map((m) => m.thickness).sort((a, b) => a - b), [6, 15])
})

test('DXT lista de peças: materiais, quantidades e giro', () => {
  const imp = load('promob.dxt')
  assert.equal(imp.format, 'dxt')
  assert.equal(importStats(imp).units, 6)
  const base = imp.parts.find((p) => /Base/.test(p.label))
  assert.equal(base.length, 820)
  assert.equal(base.width, 350)
  assert.equal(base.thickness, 15)
  assert.equal(base.material, 'Branco Tx 15mm')
  assert.equal(base.grain, false, 'AllowRotate = 1')
  assert.equal(imp.info.project, 'Teste integracao')
})

test('mapeamento sugere chapa pela cor e exige a mesma espessura', () => {
  const stock = [
    { id: 'a', name: 'MDF Branco Ártico 18mm', category: 'chapa', thickness: 18, sheetWidth: 2750, sheetHeight: 1850, active: true },
    { id: 'b', name: 'MDF Branco Ártico 15mm', category: 'chapa', thickness: 15, sheetWidth: 2750, sheetHeight: 1850, active: true },
    { id: 'c', name: 'MDF Carvalho 15mm', category: 'chapa', thickness: 15, sheetWidth: 2750, sheetHeight: 1850, active: true },
  ]
  assert.equal(suggestMaterial('Cores Branco 15mm', 15, {}, stock, 'chapa').id, 'b')
  assert.equal(suggestMaterial('Branco', 6, {}, stock, 'chapa'), null)
  const imp = load('promob-pecas.csv')
  assert.equal(autoMapMaterials(imp.parts, stock)['Cores Branco 15mm|15'], 'b')
})

test('importação → plano: otimiza com a chapa mapeada e G-code usa o contorno em L', () => {
  const imp = load('promob-pecas.csv')
  const pieces = toCutPieces(imp.parts, { 'Cores Branco 15mm|15': 'mat1' })
  assert.equal(pieces.length, 3)
  assert.ok(pieces.every((p) => p.materialId === 'mat1'))
  assert.equal(pieces[0].contour.length, 6)
  const t = totalsOf(pieces)
  assert.ok(t.holes > 30)
  assert.ok(Math.abs(t.edgeMeters - 1.55) < 0.01, `fita ${t.edgeMeters}`)
  const spec = { key: 'mat1', materialId: 'mat1', materialName: 'MDF Branco 15mm', thickness: 15, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 300 }
  const { groups, unresolved } = planGroups(pieces, () => spec, 7, 10)
  assert.equal(unresolved.length, 0)
  assert.equal(groups.length, 1)
  const out = generateGcode({ title: 'Importado', mode: 'cnc', kerf: 7 }, groups[0], 0, pieces, DEFAULT_GCODE)
  // peça em L: 6 lados por passada em vez de 4 — mais segmentos G1 de contorno
  const contourBlock = out.code.slice(out.code.indexOf('(CONTORNOS'))
  assert.ok(contourBlock.includes('PECA Base L Inferior Dir'))
  assert.ok(out.warnings.some((w) => /face inferior/.test(w)), 'furos da face inferior são avisados')
  assert.ok(!/[^\x00-\x7F]/.test(out.code))
  // coordenadas dentro da chapa
  for (const m of out.code.matchAll(/X(-?\d+(?:\.\d+)?)/g)) assert.ok(Number(m[1]) >= -0.01 && Number(m[1]) <= 2750.01)
})

test('offsetPolygon afasta um L para fora pelo raio da fresa', () => {
  const L = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 50, y: 50 },
    { x: 50, y: 100 },
    { x: 0, y: 100 },
  ]
  for (const poly of [L, [...L].reverse()]) {
    const o = offsetPolygon(poly, 3)
    const xs = o.map((p) => p.x)
    const ys = o.map((p) => p.y)
    assert.ok(Math.abs(Math.min(...xs) + 3) < 1e-9 && Math.abs(Math.max(...xs) - 103) < 1e-9)
    assert.ok(Math.abs(Math.min(...ys) + 3) < 1e-9 && Math.abs(Math.max(...ys) - 103) < 1e-9)
    assert.equal(o.length, 6)
  }
})

// ───────── importação em volume (centenas de lotes de chapa) ─────────

function sheetDxf(index, th, pieces = 12) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES']
  const poly = (layer, x0, y0, x1, y1) => out.push('0', 'LWPOLYLINE', '8', layer, '90', '4', '70', '1', '10', x0, '20', y0, '10', x0, '20', y1, '10', x1, '20', y1, '10', x1, '20', y0)
  poly(`CHAPA Z ${th}`, 0, 0, 2750, 1850)
  // peças de tamanhos únicos por lote (índice entra na medida) para que nenhuma seja somada a outra
  for (let i = 0; i < pieces; i++) {
    const x = 10 + (i % 6) * 440
    const y = 10 + Math.floor(i / 6) * 400
    poly(`CORTE M 7 Z ${th}.1`, x, y, x + 300 + (index % 90), y + 200 + i * 3)
    out.push('0', 'TEXT', '8', 'PECA_LABEL', '10', x + 5, '20', y + 5, '40', 8, '1', String(i + 1))
  }
  out.push('0', 'ENDSEC', '0', 'EOF')
  return new TextEncoder().encode(out.join('\r\n'))
}

test('500 lotes de chapa (DXF) são lidos sem perder nenhuma peça', () => {
  const files = []
  for (let i = 1; i <= 500; i++) {
    const th = [15, 18, 6][i % 3]
    files.push({ name: `${i}_${th}MDFBRANCO${th}(CHAPA).dxf`, bytes: sheetDxf(i, th) })
  }
  const t = performance.now()
  const imp = parsePromobFiles(files)
  assert.ok(performance.now() - t < 5000, 'a leitura de 500 chapas deve levar poucos segundos')
  assert.equal(imp.format, 'dxf')
  assert.equal(imp.lots, 500)
  assert.equal(imp.ignored, 0)
  assert.equal(importStats(imp).units, 500 * 12)
  const mats = summarizeMaterials(imp.parts)
  assert.equal(mats.length, 3)
  assert.equal(mats.reduce((s, m) => s + m.units, 0), 6000)
  for (const m of mats) assert.equal(m.sheetWidth, 2750)
  // o plano resultante conserva todas as peças e não as sobrepõe
  const map = Object.fromEntries(mats.map((m) => [m.key, m.key]))
  const pieces = toCutPieces(imp.parts, map)
  const byKey = Object.fromEntries(mats.map((m) => [m.key, m]))
  const plan = planGroups(
    pieces,
    (piece) => {
      const m = byKey[piece.materialId]
      return { key: m.key, materialId: m.key, materialName: m.name, thickness: m.thickness, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 100 }
    },
    3,
    10,
  )
  const placed = plan.groups.reduce((s, g) => s + g.sheets.reduce((s2, sh) => s2 + sh.placements.length, 0), 0)
  const unplaced = plan.groups.reduce((s, g) => s + g.unplaced.length, 0)
  assert.equal(placed + unplaced, 6000)
  assert.equal(unplaced, 0)
})

test('importação avisa arquivos repetidos e conta os que não são do Promob', () => {
  const dxf = sheetDxf(1, 15)
  const imp = parsePromobFiles([
    { name: '1_15MDFBRANCO15(CHAPA).dxf', bytes: dxf },
    { name: '1_15MDFBRANCO15(CHAPA).dxf', bytes: dxf },
    { name: 'foto.bmp', bytes: new Uint8Array([66, 77, 1, 2, 3]) },
  ])
  assert.equal(imp.lots, 2)
  assert.ok(imp.warnings.some((w) => /nome repetido/.test(w)), 'deve avisar nome repetido')
  assert.equal(imp.ignored, 1)
  // peças idênticas dos dois arquivos são somadas (quantidade 2), nunca descartadas
  assert.equal(importStats(imp).units, 24)
})
