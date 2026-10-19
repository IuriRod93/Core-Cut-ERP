import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optimizeCutting, isGuillotine } from '../../src/domain/cutting.ts'

const params = { sheetWidth: 2750, sheetHeight: 1850, kerf: 3, trim: 10 }
const piece = (label, length, width, quantity, rotate = false) => ({ id: label, label, length, width, quantity, rotate })

const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

test('todas as peças são alocadas dentro da área útil, sem sobreposição e respeitando o corte', () => {
  const pieces = [piece('Lateral', 720, 560, 12), piece('Base', 764, 560, 6), piece('Porta', 716, 396, 12), piece('Tampo', 1200, 600, 3), piece('Rodapé', 2400, 100, 4)]
  const r = optimizeCutting(pieces, params)
  assert.equal(r.unplaced.length, 0)
  assert.equal(r.placedPieces, 37)
  for (const sheet of r.sheets) {
    for (const p of sheet.placements) {
      assert.ok(p.x >= params.trim && p.y >= params.trim, 'respeita refilo')
      assert.ok(p.x + p.w <= params.sheetWidth - params.trim && p.y + p.h <= params.sheetHeight - params.trim, 'dentro da chapa')
    }
    for (let i = 0; i < sheet.placements.length; i++)
      for (let j = i + 1; j < sheet.placements.length; j++) {
        const a = sheet.placements[i]
        const b = sheet.placements[j]
        // com o kerf, retângulos "inflados" também não podem se sobrepor
        assert.ok(!overlaps({ ...a, w: a.w + params.kerf, h: a.h + params.kerf }, b), `peças ${a.label} e ${b.label} sobrepostas`)
      }
  }
  assert.ok(r.utilization > 55 && r.utilization <= 100)
})

test('peças maiores que a chapa são reportadas e não travam o cálculo', () => {
  const r = optimizeCutting([piece('Gigante', 3000, 2000, 1), piece('Normal', 500, 500, 2)], params)
  assert.equal(r.unplaced.length, 1)
  assert.equal(r.placedPieces, 2)
})

test('rotação só é usada quando permitida', () => {
  // 1800 x 2700 só cabe girada em uma chapa 2750 x 1850
  const sem = optimizeCutting([piece('Alta', 1800, 2700, 1, false)], params)
  assert.equal(sem.unplaced.length, 1)
  const com = optimizeCutting([piece('Alta', 1800, 2700, 1, true)], params)
  assert.equal(com.unplaced.length, 0)
  assert.equal(com.sheets[0].placements[0].rotated, true)
})

test('plano encontra solução ótima simples: 2 peças que ocupam uma chapa', () => {
  const r = optimizeCutting([piece('A', 1300, 1800, 2)], { ...params, kerf: 0, trim: 0 })
  assert.equal(r.sheets.length, 1)
})

// ---------------------------------------------- seccionadora: cortes de ponta a ponta
const rects = (sheet) => sheet.placements.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }))

test('seccionadora: todo mapa é executável com cortes de ponta a ponta, sem perder peças', () => {
  let seed = 99
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  for (let run = 0; run < 6; run++) {
    const pieces = Array.from({ length: 40 }, (_, i) => piece(`P${run}-${i}`, 150 + Math.floor(rand() * 900), 100 + Math.floor(rand() * 600), 1 + Math.floor(rand() * 3), rand() < 0.5))
    const total = pieces.reduce((s, p) => s + p.quantity, 0)
    const r = optimizeCutting(pieces, { ...params, guillotine: true })
    assert.equal(r.unplaced.length, 0)
    assert.equal(r.placedPieces, total)
    for (const sheet of r.sheets) {
      assert.ok(isGuillotine(rects(sheet), params.kerf + 0.5), `chapa ${sheet.index} deve ser cortável de ponta a ponta`)
      for (const p of sheet.placements) {
        assert.ok(p.x >= params.trim - 1e-6 && p.y >= params.trim - 1e-6)
        assert.ok(p.x + p.w <= params.sheetWidth - params.trim + 1e-6 && p.y + p.h <= params.sheetHeight - params.trim + 1e-6)
      }
      for (let i = 0; i < sheet.placements.length; i++)
        for (let j = i + 1; j < sheet.placements.length; j++) {
          const a = sheet.placements[i]
          const b = sheet.placements[j]
          assert.ok(!overlaps({ ...a, w: a.w + params.kerf, h: a.h + params.kerf }, b), 'sem sobreposição considerando o disco')
        }
    }
  }
})

test('seccionadora: aproveitamento fica próximo do encaixe livre e peças gigantes continuam recusadas', () => {
  const pieces = [piece('Lateral', 720, 560, 12), piece('Base', 764, 560, 6), piece('Porta', 716, 396, 12), piece('Tampo', 1200, 600, 3), piece('Rodapé', 2400, 100, 4)]
  const livre = optimizeCutting(pieces, params)
  const guilhotina = optimizeCutting(pieces, { ...params, guillotine: true })
  assert.ok(guilhotina.sheets.length <= livre.sheets.length + 1, 'no máximo uma chapa a mais que o encaixe livre')
  assert.ok(guilhotina.utilization >= livre.utilization - 8)
  const gigante = optimizeCutting([piece('Gigante', 3000, 2000, 1), piece('Normal', 500, 500, 2)], { ...params, guillotine: true })
  assert.equal(gigante.unplaced.length, 1)
  assert.equal(gigante.placedPieces, 2)
})

test('isGuillotine reconhece o padrão em cata-vento como impossível de cortar de ponta a ponta', () => {
  // quatro retângulos em volta de um quadrado central: nenhuma linha atravessa sem cortar uma peça
  const pinwheel = [
    { x: 0, y: 0, w: 200, h: 100 },
    { x: 200, y: 0, w: 100, h: 200 },
    { x: 100, y: 200, w: 200, h: 100 },
    { x: 0, y: 100, w: 100, h: 200 },
    { x: 100, y: 100, w: 100, h: 100 },
  ]
  assert.equal(isGuillotine(pinwheel, 0.5), false)
  assert.equal(isGuillotine(pinwheel.slice(0, 2), 0.5), true)
})

// ---------------------------------------------- sequência de cortes e sobras
import { analyzeSheet, usableLeftovers } from '../../src/domain/cutSequence.ts'

test('sequência de cortes: desmonta o mapa da seccionadora e as sobras não tocam nas peças', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)
  const bounds = { x: params.trim, y: params.trim, w: params.sheetWidth - params.trim * 2, h: params.sheetHeight - params.trim * 2 }
  for (let run = 0; run < 5; run++) {
    const pieces = Array.from({ length: 25 }, (_, i) => piece(`S${run}-${i}`, 200 + Math.floor(rand() * 900), 150 + Math.floor(rand() * 500), 1 + Math.floor(rand() * 2), rand() < 0.5))
    const r = optimizeCutting(pieces, { ...params, guillotine: true })
    for (const sheet of r.sheets) {
      const a = analyzeSheet(rects(sheet), bounds, params.kerf)
      assert.equal(a.guillotine, true, 'mapa de seccionadora tem sequência')
      assert.ok(a.steps.length >= sheet.placements.length - 1, 'ao menos um corte para separar cada peça')
      assert.deepEqual(a.steps.map((s) => s.n), a.steps.map((_, i) => i + 1))
      for (const s of a.steps) assert.ok(s.to > s.from)
      for (const l of a.leftovers) {
        assert.ok(l.x >= bounds.x - 1 && l.y >= bounds.y - 1 && l.x + l.w <= bounds.x + bounds.w + 1 && l.y + l.h <= bounds.y + bounds.h + 1, 'sobra dentro da chapa')
        for (const p of sheet.placements) assert.ok(!overlaps(l, p), 'sobra não pode cobrir peça')
      }
      const covered = sheet.placements.reduce((s, p) => s + p.w * p.h, 0) + a.leftovers.reduce((s, l) => s + l.area, 0)
      assert.ok(covered <= bounds.w * bounds.h + 1, 'peças + sobras não passam da área útil')
    }
  }
})

test('sobras aproveitáveis: descarta tiras estreitas e mantém as grandes', () => {
  const l = [
    { x: 0, y: 0, w: 900, h: 600, area: 540000 },
    { x: 0, y: 0, w: 2000, h: 80, area: 160000 },
    { x: 0, y: 0, w: 300, h: 300, area: 90000 },
  ]
  assert.equal(usableLeftovers(l).length, 1)
  assert.equal(usableLeftovers(l, { minSide: 250, minArea: 50000 }).length, 2)
})

test('mapa que não é de ponta a ponta não gera sequência', () => {
  const pinwheel = [
    { x: 0, y: 0, w: 200, h: 100 },
    { x: 200, y: 0, w: 100, h: 200 },
    { x: 100, y: 200, w: 200, h: 100 },
    { x: 0, y: 100, w: 100, h: 200 },
    { x: 100, y: 100, w: 100, h: 100 },
  ]
  const a = analyzeSheet(pinwheel, { x: 0, y: 0, w: 300, h: 300 }, 0)
  assert.equal(a.guillotine, false)
  assert.equal(a.steps.length, 0)
})

// ---------------------------------------------- reaproveitamento de retalhos
import { planGroups } from '../../src/domain/cutting.ts'

test('retalhos: peças que cabem usam o retalho do mesmo material e só o resto abre chapa nova', () => {
  const spec = { key: 'mdf', materialId: 'mdf-18', materialName: 'MDF 18', thickness: 18, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 300 }
  const pieces = [piece('Prateleira', 500, 300, 2), piece('Lateral', 2000, 600, 1)]
  const offcuts = [
    { id: 'r1', code: 'RET-1', materialId: 'mdf-18', thickness: 18, width: 1010, height: 400 },
    { id: 'r2', code: 'RET-2', materialId: 'outro', thickness: 18, width: 2700, height: 1800 }, // outro material: ignorado
    { id: 'r3', code: 'RET-3', materialId: 'mdf-18', thickness: 15, width: 2700, height: 1800 }, // outra espessura: ignorado
  ]
  const r = planGroups(pieces, () => spec, 3, 10, { guillotine: true, offcuts })
  const retalho = r.groups.find((g) => g.offcutId === 'r1')
  assert.ok(retalho, 'usou o retalho r1')
  assert.equal(retalho.cost, 0)
  assert.equal(retalho.sheets[0].placements.length, 2)
  assert.equal(r.groups.some((g) => g.offcutId === 'r2' || g.offcutId === 'r3'), false)
  const nova = r.groups.find((g) => !g.offcutId)
  assert.equal(nova.sheets.length, 1)
  // todas as 3 peças foram alocadas, nenhuma duplicada
  const placed = r.groups.reduce((s, g) => s + g.sheets.reduce((a, sh) => a + sh.placements.length, 0), 0)
  assert.equal(placed, 3)
})

test('retalhos: se tudo cabe no retalho, nenhuma chapa nova é aberta', () => {
  const spec = { key: 'mdf', materialId: 'mdf-18', materialName: 'MDF 18', thickness: 18, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 300 }
  const r = planGroups([piece('Tampo', 800, 300, 1)], () => spec, 3, 10, { offcuts: [{ id: 'r1', materialId: 'mdf-18', thickness: 18, width: 1000, height: 500 }] })
  assert.equal(r.groups.length, 1)
  assert.equal(r.groups[0].offcutId, 'r1')
})
