import { brl, fmtDate } from '../lib/format.ts'

/** Telefone só com dígitos e o código do Brasil (formato do wa.me). */
export const waPhone = (phone?: string | null) => {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.startsWith('55') && digits.length >= 12 ? digits : `55${digits}`
}

/** Mensagem de cobrança educada, pronta para o WhatsApp. */
export function chargeMessage(d: { contactName?: string; description: string; amount: number; dueDate: string; overdue: boolean; companyName?: string }) {
  const hello = d.contactName ? `Olá, ${d.contactName.split(/\s+/)[0]}! Tudo bem?` : 'Olá! Tudo bem?'
  const when = d.overdue ? `com vencimento em ${fmtDate(d.dueDate)}, que ainda consta em aberto` : `que vence em ${fmtDate(d.dueDate)}`
  return [
    hello,
    `Passando para lembrar da parcela "${d.description}", no valor de ${brl(d.amount)}, ${when}.`,
    d.overdue ? 'Se já pagou, pode desconsiderar e, se possível, me enviar o comprovante.' : 'Qualquer dúvida, estou à disposição.',
    d.companyName ? `— ${d.companyName}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export const whatsappUrl = (phone: string, text: string) => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
