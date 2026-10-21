import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dueReminders, groupReminders } from '../lib/finance-reminders.mjs'
import { chargeMessage, waPhone, whatsappUrl } from '../../src/domain/collection.ts'

const entry = (id, dueDate, extra = {}) => ({ id, description: `Parcela ${id}`, amount: 1000, dueDate, status: 'pendente', ...extra })

test('avisos de vencimento: 3 dias antes, no dia e nos marcos de atraso, só para contas pendentes', () => {
  const today = '2026-10-21'
  const list = [
    entry('a', '2026-10-24'), // em 3 dias
    entry('b', '2026-10-21'), // hoje
    entry('c', '2026-10-20'), // 1 dia de atraso
    entry('d', '2026-10-14'), // 7 dias
    entry('e', '2026-10-22'), // amanhã: sem marco
    entry('f', '2026-10-21', { status: 'pago' }),
  ]
  const recv = dueReminders(list, today, 'receivable', () => 'Família Silva')
  assert.deepEqual(recv.map((r) => [r.entry.id, r.stage, r.title]), [
    ['a', 'em3', 'Recebimento vence em 3 dias'],
    ['b', 'hoje', 'Recebimento vence hoje'],
    ['c', 'atraso1', 'Recebimento atrasado há 1 dia'],
    ['d', 'atraso7', 'Recebimento atrasado há 7 dias'],
  ])
  assert.match(recv[0].body, /Parcela a — R\$\s?1\.000,00 · Família Silva · vencimento 24\/10\/2026/)
  // contas a pagar não têm o marco de 15 e 30 dias
  assert.equal(dueReminders([entry('g', '2026-10-06')], today, 'payable').length, 0)
  assert.equal(dueReminders([entry('g', '2026-10-06')], today, 'receivable')[0].stage, 'atraso15')
  // a chave muda se o vencimento for renegociado (avisa de novo na nova data)
  assert.notEqual(dueReminders([entry('h', '2026-10-21')], today, 'receivable')[0].key, dueReminders([entry('h', '2026-10-24')], '2026-10-24', 'receivable')[0].key)
})

test('muitos avisos no mesmo marco viram um resumo', () => {
  const list = Array.from({ length: 9 }, (_, i) => entry(`x${i}`, '2026-10-21'))
  const grouped = groupReminders(dueReminders(list, '2026-10-21', 'receivable'), 'receivable', '2026-10-21')
  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].title, '9 recebimentos: vence hoje')
  assert.match(grouped[0].body, /Total R\$\s?9\.000,00/)
})

test('cobrança pelo WhatsApp: telefone no formato do wa.me e mensagem pronta', () => {
  assert.equal(waPhone('(21) 99307-0000'), '5521993070000')
  assert.equal(waPhone('+55 21 99307-0000'), '5521993070000')
  assert.equal(waPhone('123'), null)
  const late = chargeMessage({ contactName: 'Maria Souza', description: 'ORC-1 — Entrada', amount: 1500, dueDate: '2026-10-10', overdue: true, companyName: 'Marcenaria X' })
  assert.match(late, /^Olá, Maria! Tudo bem\?/)
  assert.match(late, /ainda consta em aberto/)
  assert.match(late, /— Marcenaria X$/)
  assert.match(whatsappUrl('5521993070000', 'oi tudo'), /^https:\/\/wa\.me\/5521993070000\?text=oi%20tudo$/)
})
