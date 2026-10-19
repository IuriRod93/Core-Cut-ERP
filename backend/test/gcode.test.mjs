import { test } from 'node:test'
import assert from 'node:assert/strict'
import { optimizeCutting, planGroups } from '../../src/domain/cutting.ts'
import { generateGcode } from '../../src/domain/gcode.ts'
import { hingeHoles, newMachining, pieceToSheet, shelfPinHoles } from '../../src/domain/machining.ts'
import { DEFAULT_GCODE, computeCosts, totalsOf } from '../../src/domain/cutPlan.ts'

const spec = { key: 'mdf18', materialName: 'MDF Branco 18mm', thickness: 18, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 397.9 }
const door = { id: 'p1', label: 'Porta', length: 716, width: 396, quantity: 2, rotate: false, materialId: 'm1', edgeTop: true, edgeBottom: true, edgeLeft: true, edgeRight: true, machining: hingeHoles(716, 396) }
const side = { id: 'p2', label: 'Lateral', length: 720, width: 560, quantity: 2, rotate: true, materialId: 'm1', edgeTop: true, machining: [...shelfPinHoles(720, 560, 2), newMachining('rasgo_fundo', 10, 10)] }

const plan = () => planGroups([door, side], () => spec, 7, 10)

test('hingeHoles segue a regra de quantidade por altura', () => {
  assert.equal(hingeHoles(700, 396).length, 2)
  assert.equal(hingeHoles(1400, 396).length, 3)
  assert.equal(hingeHoles(2100, 396).length, 4)
})

test('pieceToSheet mantém o furo dentro do retângulo da peça nas duas orientações', () => {
  const pl = { pieceId: 'p', label: 'p', x: 100, y: 200, w: 716, h: 396, rotated: false }
  const a = pieceToSheet(pl, { length: 716, width: 396 }, 22.5, 22.5)
  assert.ok(a.x >= 100 && a.x <= 816 && a.y >= 200 && a.y <= 596)
  const plr = { ...pl, w: 396, h: 716, rotated: true }
  const b = pieceToSheet(plr, { length: 716, width: 396 }, 22.5, 22.5)
  assert.ok(b.x >= 100 && b.x <= 496 && b.y >= 200 && b.y <= 916)
  // canto (0,0) local vai para um canto do retângulo, canto oposto para o canto oposto
  const c0 = pieceToSheet(plr, { length: 716, width: 396 }, 0, 0)
  const c1 = pieceToSheet(plr, { length: 716, width: 396 }, 716, 396)
  assert.equal(Math.round(Math.abs(c1.x - c0.x)), 396)
  assert.equal(Math.round(Math.abs(c1.y - c0.y)), 716)
})

test('G-code: cabeçalho, ordem das operações, limites e contagem de furos', () => {
  const { groups } = plan()
  const g = groups[0]
  const out = generateGcode({ title: 'Cozinha Silva', code: 'PLC-2026-0001', mode: 'cnc', kerf: 7 }, g, 0, [door, side], DEFAULT_GCODE)
  const text = out.code
  assert.match(text, /^%/)
  assert.match(text, /G21 G90 G17/)
  assert.match(text, /M30\n%$/)
  assert.ok(text.indexOf('FURACOES') < text.indexOf('CONTORNOS'), 'furos antes dos contornos')
  assert.ok(!/[^\x00-\x7F]/.test(text), 'somente ASCII')
  const expectedHoles = door.machining.length * 2 + side.machining.filter((m) => m.kind === 'furo').length * 2
  assert.equal(out.holes, expectedHoles)
  assert.equal(out.grooves, 2)
  assert.equal(out.contours, 4)
  // todas as coordenadas dentro da chapa
  for (const m of text.matchAll(/[XY](-?\d+(?:\.\d+)?)/g)) {
    const v = Number(m[1])
    assert.ok(v >= 0 && v <= 2750, `coordenada ${v} fora da chapa`)
  }
  for (const m of text.matchAll(/Y(-?\d+(?:\.\d+)?)/g)) assert.ok(Number(m[1]) <= 1850)
  // profundidade nunca excede espessura + sobrecorte
  for (const m of text.matchAll(/Z(-\d+(?:\.\d+)?)/g)) assert.ok(Number(m[1]) >= -18.3 - 1e-9, `Z ${m[1]} muito profundo`)
})

test('G-code avisa quando a folga é menor que a fresa e quando há furos de borda', () => {
  const { groups } = planGroups([{ ...door, machining: [newMachining('cavilha_8', 0, 100)] }], () => spec, 2, 10)
  const out = generateGcode({ title: 't', mode: 'seccionadora', kerf: 2 }, groups[0], 0, [{ ...door, machining: [newMachining('cavilha_8', 0, 100)] }], DEFAULT_GCODE)
  assert.ok(out.warnings.some((w) => /folga/i.test(w)))
  assert.ok(out.warnings.some((w) => /borda/i.test(w)))
  assert.ok(out.warnings.some((w) => /seccionadora/i.test(w)))
})

test('custos: chapas, fita, ferragens e usinagem somam o total', () => {
  const { groups } = plan()
  const mats = new Map([['edge', { id: 'edge', cost: 1.5 }]])
  const centers = [{ code: 'CNC', hourlyCost: 110 }, { code: 'CORTE', hourlyCost: 95 }, { code: 'BORDA', hourlyCost: 80 }]
  const costs = computeCosts({ pieces: [door, side], groups, hardware: [{ id: 'h', description: 'Dobradiça', quantity: 8, unitCost: 4.5 }], mode: 'cnc', edgeMaterialId: 'edge' }, mats, centers)
  const t = totalsOf([door, side])
  assert.equal(costs.edgeMeters, t.edgeMeters)
  assert.equal(costs.hardware, 36)
  assert.equal(costs.sheets, groups[0].cost)
  assert.equal(Math.round((costs.sheets + costs.edge + costs.hardware + costs.machining) * 100) / 100, costs.total)
  assert.ok(costs.machining > 0 && costs.edge > 0)
})

test('otimizador agrupa por material', () => {
  const r = planGroups(
    [door, { ...side, materialId: 'm2' }],
    (p) => ({ ...spec, key: p.materialId ?? 'x', materialId: p.materialId, thickness: p.materialId === 'm2' ? 6 : 18 }),
    3,
    10,
  )
  assert.equal(r.groups.length, 2)
  assert.deepEqual(r.groups.map((g) => g.thickness).sort((a, b) => a - b), [6, 18])
  void optimizeCutting
})
