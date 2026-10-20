import type { OpOperation, ProductionOrder } from '../../src/types'

export const SHOPFLOOR_ACTIONS: ('start' | 'pause' | 'finish')[]
export function elapsedSeconds(op: OpOperation, now: number): number
export function applyOperationAction(
  order: ProductionOrder,
  opId: string,
  action: 'start' | 'pause' | 'finish',
  opts: { user: { id: string; name: string }; now?: number; quantity?: number | null; running?: { orderId: string; opId: string; label: string }[]; reason?: string; note?: string },
): { operations: OpOperation[]; status?: ProductionOrder['status']; finished: boolean; unchanged?: boolean }
export function runningOperationsOf(orders: ProductionOrder[], userId: string): { orderId: string; opId: string; label: string }[]
export function nextWallTime(fromMs: number, hhmm: string, timeZone: string): number | null
