/**
 * Retalhos reservados pelos planos de corte. Quando um plano usa um retalho do estoque ele fica
 * "reservado" (ninguém mais o escolhe), vira "usado" quando o plano é concluído e volta a ficar
 * "disponível" se o plano deixar de usá-lo (recalculado sem ele).
 */
export function syncPlanOffcuts(db, plan) {
  if (!plan?.id) return
  const wanted = new Set((Array.isArray(plan.groups) ? plan.groups : []).map((g) => g?.offcutId).filter(Boolean))
  const done = plan.status === 'concluido'

  for (const id of wanted) {
    const offcut = db.get('offcuts', id)
    if (!offcut) continue
    const free = offcut.status === 'disponivel' || (offcut.usedInPlanId === plan.id && ['reservado', 'usado'].includes(offcut.status))
    if (!free) continue
    const status = done ? 'usado' : 'reservado'
    if (offcut.status !== status || offcut.usedInPlanId !== plan.id) db.update('offcuts', id, { status, usedInPlanId: plan.id })
  }

  for (const offcut of db.col('offcuts')) {
    if (offcut.usedInPlanId === plan.id && offcut.status === 'reservado' && !wanted.has(offcut.id)) {
      db.update('offcuts', offcut.id, { status: 'disponivel', usedInPlanId: null })
    }
  }
}
