import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectCost } from '../../src/domain/projectCost.ts'

const budget = {
  id: 'b1',
  code: 'ORC-1',
  projectId: 'p1',
  status: 'aprovado',
  marginPercent: 30,
  taxPercent: 0,
  freight: 200,
  installation: 800,
  laborHours: 40,
  laborRate: 50,
  items: [
    { id: 'i1', group: 'Cozinha', description: 'Módulos', kind: 'modulo', unit: 'un', quantity: 1, unitCost: 5000, unitPrice: 0 },
    { id: 'i2', group: 'Cozinha', description: 'Ferragens', kind: 'ferragem', unit: 'un', quantity: 1, unitCost: 1000, unitPrice: 0 },
  ],
}

test('custo real: compara o previsto do orçamento com compras, horas e despesas do projeto', () => {
  const r = projectCost({
    projectId: 'p1',
    budgets: [budget],
    purchases: [
      { id: 'c1', projectId: 'p1', status: 'recebido', items: [{ description: 'MDF', quantity: 10, unitCost: 300 }], freight: 100 },
      { id: 'c2', projectId: 'p1', status: 'parcial', items: [{ description: 'Ferragem', quantity: 10, unitCost: 50, received: 4 }] },
      { id: 'c3', projectId: 'p1', status: 'pedido', items: [{ description: 'Fita', quantity: 1, unitCost: 400 }] },
      { id: 'c4', projectId: 'p1', status: 'rascunho', items: [{ description: 'Rascunho', quantity: 1, unitCost: 9999 }] },
      { id: 'c5', projectId: 'outro', status: 'recebido', items: [{ description: 'Outro projeto', quantity: 1, unitCost: 7777 }] },
    ],
    orders: [
      { projectId: 'p1', status: 'em_producao', operations: [{ workCenterId: 'w1', plannedMinutes: 120, actualSeconds: 7200 }, { workCenterId: 'w2', plannedMinutes: 60, actualSeconds: 1800 }] },
      { projectId: 'p1', status: 'cancelada', operations: [{ workCenterId: 'w1', plannedMinutes: 600, actualSeconds: 36000 }] },
    ],
    workCenters: [{ id: 'w1', hourlyCost: 80 }, { id: 'w2', hourlyCost: 40 }],
    payables: [
      { projectId: 'p1', status: 'pago', amount: 350 },
      { projectId: 'p1', status: 'pendente', amount: 150 },
      { projectId: 'p1', status: 'pago', amount: 3100, purchaseId: 'c1' }, // já está nas compras
      { projectId: 'p1', status: 'cancelado', amount: 999 },
    ],
    receivables: [{ projectId: 'p1', status: 'pago', amount: 5000 }, { projectId: 'p1', status: 'pendente', amount: 4000 }],
  })
  assert.ok(r)
  const [mat, labor, other] = r.lines
  assert.equal(mat.planned, 6000)
  assert.equal(mat.actual, 3100 + 200) // recebido (3000+100 de frete) + 4 ferragens recebidas
  assert.equal(mat.committed, 300 + 400) // saldo da parcial + pedido; rascunho e outro projeto ficam de fora
  assert.equal(labor.planned, 2000)
  assert.equal(labor.actual, 2 * 80 + 0.5 * 40) // ordem cancelada não conta
  assert.equal(other.planned, 1000)
  assert.equal(other.actual, 350)
  assert.equal(other.committed, 150)
  assert.equal(r.received, 5000)
  assert.deepEqual(r.hours, { planned: 3, actual: 2.5 })
  assert.equal(r.planned, 9000)
  assert.equal(r.projected, r.actual + r.committed)
  assert.equal(r.variance, r.projected - r.planned)
})

test('custo real: sem orçamento no projeto não há comparação; estouro marca o status', () => {
  assert.equal(projectCost({ projectId: 'p9', budgets: [budget], purchases: [] }), null)
  const r = projectCost({
    projectId: 'p1',
    budgets: [budget],
    purchases: [{ id: 'x', projectId: 'p1', status: 'recebido', items: [{ description: 'Caro', quantity: 1, unitCost: 12000 }] }],
  })
  assert.equal(r.status, 'estouro')
  assert.ok(r.projectedProfit < r.plannedProfit)
})
