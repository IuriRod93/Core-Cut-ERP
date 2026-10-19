import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildLabelsPdf } from '../../src/domain/cutPlanPdf.ts'
import { planGroups } from '../../src/domain/cutting.ts'

const pieces = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, label: `Painel ${i}`, length: 400 + i * 7, width: 250 + i * 3, quantity: 2, rotate: true, materialId: 'm' }))
const resolve = () => ({ key: 'm', materialId: 'm', materialName: 'MDF Branco 15mm', thickness: 15, sheetWidth: 2750, sheetHeight: 1850, sheetCost: 100 })
const plan = planGroups(pieces, resolve, 3, 10)
const base = { groups: plan.groups, pieces, materialNames: new Map(), code: 'PLC-1', projectName: 'Teste', baseUrl: 'https://erp.exemplo', planId: 'plano-1' }

test('etiquetas: gera o PDF devolvendo o controle ao navegador e informando o progresso', async () => {
  for (const layout of ['compacta', 'completa']) {
    const calls = []
    const blob = await buildLabelsPdf({ ...base, layout, onProgress: (done, total) => calls.push([done, total]) })
    const head = Buffer.from(await blob.arrayBuffer()).subarray(0, 5).toString()
    assert.equal(head, '%PDF-')
    assert.ok(calls.length >= 2, 'progresso informado mais de uma vez')
    assert.deepEqual(calls.at(-1), [60, 60], 'termina em total/total')
    assert.ok(calls.every(([done, total]) => done <= total && total === 60))
  }
})

test('etiquetas: a geração pode ser cancelada no meio', async () => {
  const controller = new AbortController()
  await assert.rejects(
    buildLabelsPdf({ ...base, layout: 'compacta', signal: controller.signal, onProgress: (done) => done >= 8 && controller.abort() }),
    (error) => error.name === 'AbortError',
  )
})
