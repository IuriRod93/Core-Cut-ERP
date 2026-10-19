/** Modelos dos e-mails transacionais do Core Cut (texto + HTML simples, compatível com qualquer cliente de e-mail). */

const BRAND = '#1389a8'
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const frame = ({ title, paragraphs, action, footer }) => {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${esc(p)}</p>`).join('')
  const button = action
    ? `<p style="margin:22px 0"><a href="${esc(action.url)}" style="background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${esc(action.label)}</a></p>
       <p style="margin:0 0 14px;font-size:12px;color:#6b7780;word-break:break-all">Se o botão não abrir, copie este endereço no navegador:<br>${esc(action.url)}</p>`
    : ''
  return `<!doctype html><html><body style="margin:0;background:#f4f6f7;font-family:Arial,Helvetica,sans-serif;color:#13232b">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3e8ea">
    <div style="font-weight:800;letter-spacing:.5px;color:${BRAND};margin-bottom:18px">CORE CUT <span style="color:#13232b">ERP</span></div>
    <h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
    ${body}${button}
  </div>
  <p style="font-size:12px;color:#6b7780;text-align:center;margin:14px 0 0">${esc(footer ?? 'Core Cut ERP · www.cutcore.com.br')}</p>
</div></body></html>`
}

const plain = ({ title, paragraphs, action, footer }) =>
  [title, '', ...paragraphs, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', footer ?? 'Core Cut ERP · www.cutcore.com.br'].join('\n')

const build = (content) => ({ subject: content.subject, text: plain(content), html: frame(content) })
const first = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'olá'
const dateBr = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

export const emails = {
  clientUpdate: ({ clientName, companyName, projectName, message, url }) =>
    build({
      subject: `${projectName || 'Seu projeto'} — novidades da ${companyName || 'marcenaria'}`,
      title: projectName || 'Atualização do seu projeto',
      paragraphs: [`Olá, ${first(clientName)}.`, ...String(message).split(/\n+/).filter(Boolean), `${companyName || 'Sua marcenaria'}`],
      action: url ? { label: 'Acompanhar meu projeto', url } : undefined,
      footer: `Enviado por ${companyName || 'sua marcenaria'} pelo Core Cut ERP`,
    }),

  passwordReset: ({ name, url, minutes = 30 }) =>
    build({
      subject: 'Redefinição de senha — Core Cut ERP',
      title: 'Redefina sua senha',
      paragraphs: [
        `Olá, ${first(name)}. Recebemos um pedido para redefinir a senha da sua conta no Core Cut ERP.`,
        `O link abaixo vale por ${minutes} minutos e só pode ser usado uma vez.`,
        'Se você não pediu isso, ignore este e-mail: sua senha continua a mesma.',
      ],
      action: { label: 'Criar nova senha', url },
    }),

  trialEnding: ({ name, companyName, hoursLeft, url }) =>
    build({
      subject: `Seu teste do Core Cut termina em ${hoursLeft <= 1 ? 'menos de 1 hora' : `${hoursLeft} horas`}`,
      title: 'Seu teste gratuito está acabando',
      paragraphs: [
        `Olá, ${first(name)}. O teste de 48 horas de ${companyName || 'sua empresa'} termina em cerca de ${Math.max(Math.round(hoursLeft), 1)} hora(s).`,
        'Escolha um plano para continuar usando o sistema sem perder nenhum dado: seus projetos, peças e planos de corte ficam guardados.',
        'Pagamento por PIX ou cartão, com liberação automática.',
      ],
      action: { label: 'Escolher meu plano', url },
    }),

  paymentApproved: ({ name, companyName, planName, validUntil, url }) =>
    build({
      subject: 'Pagamento confirmado — Core Cut ERP',
      title: 'Pagamento confirmado',
      paragraphs: [
        `Olá, ${first(name)}. Recebemos o pagamento de ${companyName || 'sua empresa'}${planName ? ` (plano ${planName})` : ''}.`,
        validUntil ? `Seu acesso está liberado até ${dateBr(validUntil)}.` : 'Seu acesso está liberado.',
        'Obrigado por escolher o Core Cut!',
      ],
      action: url ? { label: 'Abrir o sistema', url } : undefined,
    }),

  accessExpiring: ({ name, companyName, daysLeft, validUntil, url }) =>
    build({
      subject: `Seu acesso ao Core Cut vence em ${daysLeft} dia(s)`,
      title: 'Seu plano vence em breve',
      paragraphs: [
        `Olá, ${first(name)}. O acesso de ${companyName || 'sua empresa'} vence em ${dateBr(validUntil)} (${daysLeft} dia(s)).`,
        'Renove antes do vencimento para não interromper o uso do sistema.',
      ],
      action: { label: 'Renovar agora', url },
    }),

  accessExpired: ({ name, companyName, url }) =>
    build({
      subject: 'Seu plano do Core Cut venceu',
      title: 'Seu plano venceu',
      paragraphs: [
        `Olá, ${first(name)}. O plano de ${companyName || 'sua empresa'} venceu. Sem a renovação, o acesso ao sistema é pausado.`,
        'Seus dados continuam guardados com segurança. Assim que o pagamento for confirmado, tudo volta ao normal automaticamente.',
      ],
      action: { label: 'Regularizar o pagamento', url },
    }),
}
