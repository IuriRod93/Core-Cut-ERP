import { companyAccess } from './billing.mjs'
import { emails } from './emails.mjs'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/**
 * E-mails de cobrança disparados pelo agendador (uma vez por situação, registrados em `company.mailSent`):
 *  - teste terminando (últimas 12 h);
 *  - plano a vencer (até 3 dias, PIX ou assinatura cancelada);
 *  - acesso vencido/suspenso por falta de pagamento.
 * Os destinatários são o titular da empresa (ou, na falta dele, um administrador ativo).
 */
export function createBillingEmails({ db, mailer, appUrl, now = () => Date.now() }) {
  const ownerOf = (companyId) => {
    const users = db.all('users').filter((user) => user.companyId === companyId && user.active !== false)
    return users.find((user) => user.companyRole === 'owner') ?? users.find((user) => user.role === 'admin') ?? null
  }
  const link = () => `${String(appUrl()).replace(/\/$/, '')}/configuracoes?aba=assinatura`

  async function run() {
    const stats = { trialEnding: 0, expiring: 0, expired: 0 }
    for (const company of db.all('companies')) {
      if (!company || company.status === 'suspended') continue
      const owner = ownerOf(company.id)
      if (!owner) continue
      const access = companyAccess(company, now())
      const sent = company.mailSent ?? {}
      const common = { name: owner.name, companyName: company.name, url: link() }
      let key = null
      let content = null

      if (access.state === 'trial' && company.trialEndsAt) {
        const hoursLeft = (Date.parse(company.trialEndsAt) - now()) / HOUR
        if (hoursLeft > 0 && hoursLeft <= 12 && sent['trial-ending'] !== company.trialEndsAt) {
          key = ['trial-ending', company.trialEndsAt]
          content = emails.trialEnding({ ...common, hoursLeft: Math.ceil(hoursLeft) })
          stats.trialEnding += 1
        }
      } else if (access.state === 'expiring' || access.state === 'active') {
        const until = company.paidUntil ? Date.parse(company.paidUntil) : 0
        const left = until - now()
        // cartão renova sozinho: avisa só PIX ou assinatura cancelada
        const manual = company.billingMethod === 'pix' || company.cancelAtPeriodEnd
        if (manual && until && left > 0 && left <= 3 * DAY && sent.expiring !== company.paidUntil) {
          key = ['expiring', company.paidUntil]
          content = emails.accessExpiring({ ...common, daysLeft: Math.max(1, Math.ceil(left / DAY)), validUntil: company.paidUntil })
          stats.expiring += 1
        }
      } else if (['grace', 'expired', 'past_due'].includes(access.state) && company.paidUntil && sent.expired !== company.paidUntil) {
        key = ['expired', company.paidUntil]
        content = emails.accessExpired(common)
        stats.expired += 1
      } else if (access.state === 'trial_expired' && company.trialEndsAt && sent['trial-expired'] !== company.trialEndsAt) {
        key = ['trial-expired', company.trialEndsAt]
        content = emails.accessExpired(common)
        stats.expired += 1
      }

      if (!key || !content) continue
      // marca antes de enviar: uma falha de SMTP não pode gerar uma enxurrada de repetições a cada rodada
      db.update('companies', company.id, { mailSent: { ...sent, [key[0]]: key[1] } })
      await mailer.sendMail({ to: owner.email, ...content })
    }
    return stats
  }

  /** Confirmação de pagamento (chamada pelo billing quando um checkout é aplicado). */
  function paymentApproved(company) {
    const owner = ownerOf(company.id)
    if (!owner) return
    void mailer.sendMail({
      to: owner.email,
      ...emails.paymentApproved({ name: owner.name, companyName: company.name, planName: company.planName, validUntil: company.paidUntil, url: String(appUrl()).replace(/\/$/, '') }),
    })
  }

  return { run, paymentApproved, ownerOf }
}
