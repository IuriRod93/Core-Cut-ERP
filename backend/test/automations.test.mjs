import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runAutomations, automationTemplates, describeTrigger, describeAction } from '../../src/domain/automations.ts'

const statuses = [
  { id: 'todo', label: 'A fazer', type: 'open' },
  { id: 'doing', label: 'Em andamento', type: 'active' },
  { id: 'review', label: 'Em revisão', type: 'active' },
  { id: 'done', label: 'Concluído', type: 'done' },
]
const lists = [
  { id: 'l1', name: 'Projeto' },
  { id: 'l2', name: 'Produção' },
]
const ctx = { statuses, lists, today: '2026-10-10' }
const task = { id: 't1', projectId: 'p', title: 'Medir', status: 'todo', assigneeIds: [], order: 1, priority: 'normal', listId: 'l1', tags: [] }
const rule = (over) => ({ id: `r${Math.random()}`, name: 'regra', enabled: true, ...over })

test('status muda → aplica ações e registra comentário/subtarefas', () => {
  const r = runAutomations(
    [rule({ name: 'Revisão', trigger: { type: 'status_changed', statusId: 'review' }, actions: [{ type: 'assign', userId: 'u1' }, { type: 'set_priority', priority: 'alta' }, { type: 'comment', text: 'Conferir' }, { type: 'create_subtasks', titles: ['A', 'B'] }] })],
    [{ type: 'status_changed', statusId: 'review' }],
    task,
    ctx,
  )
  assert.deepEqual(r.patch.assigneeIds, ['u1'])
  assert.equal(r.patch.priority, 'alta')
  assert.deepEqual(r.comments, ['Conferir'])
  assert.deepEqual(r.subtasks, ['A', 'B'])
  assert.deepEqual(r.ran, ['Revisão'])
})

test('regras desativadas ou de outro status não executam', () => {
  const rules = [
    rule({ enabled: false, trigger: { type: 'status_changed', statusId: 'review' }, actions: [{ type: 'add_tag', tag: 'x' }] }),
    rule({ trigger: { type: 'status_changed', statusId: 'done' }, actions: [{ type: 'add_tag', tag: 'y' }] }),
  ]
  const r = runAutomations(rules, [{ type: 'status_changed', statusId: 'review' }], task, ctx)
  assert.equal(r.ran.length, 0)
  assert.deepEqual(r.patch, {})
})

test('efeitos encadeiam outras regras, sem laço', () => {
  const rules = [
    rule({ name: 'A', trigger: { type: 'status_changed', statusId: 'doing' }, actions: [{ type: 'set_status', statusId: 'review' }] }),
    rule({ name: 'B', trigger: { type: 'status_changed', statusId: 'review' }, actions: [{ type: 'set_status', statusId: 'doing' }, { type: 'set_due_in', days: 5 }] }),
  ]
  const r = runAutomations(rules, [{ type: 'status_changed', statusId: 'doing' }], task, ctx)
  assert.deepEqual(r.ran, ['A', 'B'])
  assert.equal(r.patch.dueDate, '2026-10-15')
  // A e B executam uma única vez cada, mesmo se refazem o status um do outro
  assert.equal(r.ranIds.length, 2)
})

test('concluir define completedAt; tarefa criada respeita a lista do gatilho', () => {
  const done = runAutomations([rule({ trigger: { type: 'task_created' }, actions: [{ type: 'set_status', statusId: 'done' }] })], [{ type: 'task_created' }], task, ctx)
  assert.equal(done.patch.status, 'done')
  assert.ok(done.patch.completedAt)
  const other = runAutomations([rule({ trigger: { type: 'task_created', listId: 'l2' }, actions: [{ type: 'add_tag', tag: 'prod' }] })], [{ type: 'task_created' }], task, ctx)
  assert.equal(other.ran.length, 0)
  const moved = runAutomations([rule({ trigger: { type: 'task_created', listId: 'l1' }, actions: [{ type: 'move_list', listId: 'l2' }, { type: 'add_tag', tag: 'prod' }] })], [{ type: 'task_created' }], task, ctx)
  assert.equal(moved.patch.listId, 'l2')
  assert.deepEqual(moved.patch.tags, ['prod'])
})

test('modelos e descrições em português', () => {
  const t = automationTemplates(statuses)
  assert.ok(t.length >= 3)
  assert.match(describeTrigger({ type: 'status_changed', statusId: 'review' }, ctx), /Em revisão/)
  assert.match(describeAction({ type: 'move_list', listId: 'l2' }, ctx), /Produção/)
})
