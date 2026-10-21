import { useEffect, useState } from 'react'
import { api } from './api'
import { labelCode } from '../domain/shopfloor'
import type { CutPiece, CutPlan } from '../types'

/** Uma etiqueta = uma unidade de peça (o QR traz plano, peça e número da unidade). */
export interface LabelUnit {
  key: string
  planId: string
  planCode: string
  piece: CutPiece
  n: number
  /** código curto impresso na etiqueta */
  code: string
}

export const unitKey = (planId: string, pieceId: string, n: number) => `${planId}:${pieceId}:${n}`

// planos completos chegam a vários MB: cada um é baixado uma vez por sessão da tela
const cache = new Map<string, Promise<CutPlan>>()
export const loadPlan = (id: string) => {
  let p = cache.get(id)
  if (!p) {
    p = api.get<CutPlan>(`/data/cutPlans/${id}`)
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

export function unitsOf(plans: CutPlan[]): LabelUnit[] {
  const out: LabelUnit[] = []
  for (const plan of plans)
    (plan.pieces ?? []).forEach((piece, index) => {
      for (let n = 1; n <= (Number(piece.quantity) || 0); n++)
        out.push({ key: unitKey(plan.id, piece.id, n), planId: plan.id, planCode: plan.code ?? '', piece, n, code: plan.code ? labelCode(plan.code, index, n) : '' })
    })
  return out
}

/** Etiquetas dos planos informados (carrega sob demanda). */
export function useLabelUnits(planIds: string[]) {
  const [state, setState] = useState<{ units: LabelUnit[] | null; error: string | null }>({ units: null, error: null })
  const key = planIds.join('|')
  useEffect(() => {
    let alive = true
    setState({ units: null, error: null })
    Promise.all(planIds.map(loadPlan))
      .then((plans) => alive && setState({ units: unitsOf(plans), error: null }))
      .catch((e: Error) => alive && setState({ units: null, error: e.message }))
    return () => {
      alive = false
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}
