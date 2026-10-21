/**
 * Avisos de vencimento do financeiro. Cada conta pendente gera aviso em marcos fixos (antes, no dia e
 * depois do vencimento); cada marco avisa uma única vez (a chave inclui conta, marco e vencimento).
 */

const DAY = 86_400_000
const daysBetween = (dueISO, todayISO) => Math.round((Date.parse(`${String(dueISO).slice(0, 10)}T12:00:00`) - Date.parse(`${todayISO}T12:00:00`)) / DAY)
const brl = (n) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0)
const dmy = (iso) => String(iso).slice(0, 10).split('-').reverse().join('/')

const MARKS = {
  receivable: { before: [3, 0], late: [1, 7, 15, 30] },
  payable: { before: [3, 0], late: [1, 7] },
}

/** Avisos do dia para uma lista de contas (`kind`: receivable | payable). */
export function dueReminders(entries, todayISO, kind, nameOf = () => '') {
  const marks = MARKS[kind]
  const out = []
  for (const entry of entries) {
    if (entry.status !== 'pendente' || !entry.dueDate) continue
    const d = daysBetween(entry.dueDate, todayISO)
    const late = -d
    let stage = null
    if (d >= 0 && marks.before.includes(d)) stage = d === 0 ? 'hoje' : `em${d}`
    else if (d < 0 && marks.late.includes(late)) stage = `atraso${late}`
    if (!stage) continue
    const who = nameOf(entry)
    const what = kind === 'receivable' ? 'Recebimento' : 'Pagamento'
    const title = stage === 'hoje' ? `${what} vence hoje` : d > 0 ? `${what} vence em ${d} dias` : `${what} atrasado há ${late} dia${late > 1 ? 's' : ''}`
    out.push({
      entry,
      stage,
      overdue: d < 0,
      title,
      body: `${entry.description} — ${brl(entry.amount)}${who ? ` · ${who}` : ''} · vencimento ${dmy(entry.dueDate)}`,
      key: `fin:${kind}:${entry.id}:${stage}:${String(entry.dueDate).slice(0, 10)}`,
    })
  }
  return out
}

/** Muitos avisos no mesmo marco viram um resumo (não lota a caixa de notificações). */
export function groupReminders(reminders, kind, todayISO, limit = 6) {
  const byStage = new Map()
  for (const r of reminders) byStage.set(r.stage, [...(byStage.get(r.stage) ?? []), r])
  const out = []
  for (const [stage, list] of byStage) {
    if (list.length <= limit) {
      out.push(...list)
      continue
    }
    const total = list.reduce((sum, r) => sum + (Number(r.entry.amount) || 0), 0)
    const what = kind === 'receivable' ? 'recebimentos' : 'pagamentos'
    out.push({
      stage,
      overdue: list[0].overdue,
      title: `${list.length} ${what}: ${list[0].title.replace(/^(Recebimento|Pagamento) /, '').toLowerCase()}`,
      body: `Total ${brl(total)}. Veja a lista no Financeiro.`,
      key: `fin:${kind}:resumo:${stage}:${todayISO}`,
    })
  }
  return out
}
