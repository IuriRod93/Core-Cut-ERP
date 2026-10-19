import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateLimiter } from '../lib/rate-limit.mjs'

test('limitador bloqueia acima do máximo e libera após a janela', () => {
  let clock = 1_000
  const limiter = createRateLimiter({ now: () => clock })
  for (let i = 0; i < 3; i++) assert.equal(limiter.hit('ip:1', 3, 60_000).ok, true)
  const blocked = limiter.hit('ip:1', 3, 60_000)
  assert.equal(blocked.ok, false)
  assert.ok(blocked.retryAfter >= 1 && blocked.retryAfter <= 60)
  assert.equal(limiter.hit('ip:2', 3, 60_000).ok, true) // outra chave não é afetada
  clock += 60_001
  assert.equal(limiter.hit('ip:1', 3, 60_000).ok, true)
  limiter.sweep()
  assert.ok(limiter.size() <= 2)
})
