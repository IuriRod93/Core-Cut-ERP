// Verifica se a conta Mercado Pago e o servidor estão prontos para cobrar.
//   npm run billing:check
//   npm run billing:check -- --test-pix            cria um PIX de R$ 1,00 (não pago) para validar a conta
//   npm run billing:check -- --test-card           cria uma assinatura PENDENTE (não cobra) para validar o retorno
//   opções: --email comprador@exemplo.com  (e-mail do pagador usado nos testes)
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { createMercadoPago, gatewayMode, gatewayToken, returnBase } from '../backend/lib/billing.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)

const ok = (text) => console.log(`  \x1b[32m✔\x1b[0m ${text}`)
const bad = (text) => console.log(`  \x1b[31m✖\x1b[0m ${text}`)
const warn = (text) => console.log(`  \x1b[33m!\x1b[0m ${text}`)

const mode = gatewayMode()
const live = mode === 'live'
const problems = []
const need = (condition, good, fail, { blocking = true } = {}) => {
  if (condition) return ok(good)
  if (blocking) {
    bad(fail)
    problems.push(fail)
  } else warn(fail)
}

console.log(`\nCore Cut ERP — verificação de cobrança (Mercado Pago · ${mode === 'live' ? 'PRODUÇÃO' : mode === 'test' ? 'modo teste' : 'sem credencial'})\n`)

if (!gatewayToken()) {
  bad('MERCADOPAGO_ACCESS_TOKEN não configurado no .env.')
  console.log('\n  Pegue o Access Token em: https://www.mercadopago.com.br/developers/panel/app → sua aplicação → Credenciais.\n  Para testes use as credenciais de teste (e MERCADOPAGO_MODE=test se o token começar com APP_USR-).\n')
  process.exit(1)
}
const gateway = createMercadoPago()

// ------------------------------------------------------------------ conta
console.log('Conta Mercado Pago')
let me
try {
  me = await gateway.get('/users/me')
} catch (error) {
  bad(`Não foi possível ler a conta: ${error.message}`)
  process.exit(1)
}
console.log(`  ${me.nickname ?? me.first_name ?? me.id} · id ${me.id} · ${me.email ?? 'e-mail oculto'} · país ${me.country_id ?? me.site_id ?? '?'}`)
need((me.site_id ?? '') === 'MLB' || me.country_id === 'BR', 'Conta do Brasil (BRL, PIX disponível).', `A conta não é do Brasil (site ${me.site_id ?? me.country_id}): PIX não funciona.`)
const looksTest = /^TEST/i.test(String(me.nickname ?? '')) || /@testuser\.com$/i.test(String(me.email ?? ''))
if (looksTest && mode === 'live') warn('A conta parece ser um usuário de teste, mas o servidor está em modo produção: defina MERCADOPAGO_MODE=test.')
if (!looksTest && mode === 'test' && !/^TEST-/.test(gatewayToken())) warn('MERCADOPAGO_MODE=test com uma conta que não parece de teste: confira se não são credenciais de produção.')
if (me.status?.site_status && me.status.site_status !== 'active') warn(`Situação da conta: ${me.status.site_status}`)

// --------------------------------------------------------------- servidor
console.log('\nServidor')
need(live, 'Credenciais de produção em uso.', 'Ainda em modo teste: nenhum pagamento real será cobrado.', { blocking: live })
const appUrl = process.env.APP_URL ?? ''
const publicDeploy = /^https:\/\//i.test(appUrl)
const localDeploy = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[a-z0-9-]+\.(localhost|local|test|lan))(:\d+)?(\/|$)/i.test(appUrl)
if (publicDeploy) ok(`APP_URL pública com HTTPS (${appUrl}).`)
else if (localDeploy) warn(`APP_URL local (${appUrl}): só esta máquina acessa o sistema e o Mercado Pago não consegue chamar o webhook. Serve para testar; clientes reais precisam de HTTPS público (domínio ou túnel).`)
else need(false, '', `APP_URL deve ser https://seu-dominio ou um endereço local como http://localhost:5174 (atual: ${appUrl || 'vazio'}).`, { blocking: live })
need(Boolean(process.env.MERCADOPAGO_WEBHOOK_SECRET), 'MERCADOPAGO_WEBHOOK_SECRET definido.', 'MERCADOPAGO_WEBHOOK_SECRET ausente: pagamentos serão conferidos só no retorno e no login.', { blocking: live && publicDeploy })
need(process.env.ALLOW_SIMULATED_SIGNUP !== '1', 'Simulação de pagamento desativada.', 'ALLOW_SIMULATED_SIGNUP=1 libera contas sem pagamento: remova em produção.', { blocking: live })

console.log('\nWebhook (configurado no painel do Mercado Pago, não por API)')
console.log(`  URL de notificação: ${publicDeploy ? `${appUrl.replace(/\/$/, '')}/api/billing/webhook` : 'https://SEU-ENDERECO-PUBLICO/api/billing/webhook'}`)
console.log('  Painel: Suas integrações → sua aplicação → Webhooks → Configurar notificações')
console.log('  Eventos: Pagamentos (payment) · Planos e assinaturas (subscription_preapproval, subscription_authorized_payment)')
console.log('  Depois copie a "Assinatura secreta" para MERCADOPAGO_WEBHOOK_SECRET.')

// ------------------------------------------------------- testes opcionais
const payerEmail = option('--email', 'comprador-teste@example.com')
if (flag('--test-pix')) {
  console.log('\nTeste de PIX (cria um pagamento de R$ 1,00 que expira sem ser pago)')
  try {
    const ref = randomUUID()
    const expires = new Date(Date.now() + 30 * 60_000 - 3 * 3_600_000).toISOString().slice(0, -1) + '-03:00'
    const payment = await gateway.post('/v1/payments', {
      transaction_amount: 1,
      description: 'Core Cut ERP - teste de PIX (billing:check)',
      payment_method_id: 'pix',
      payer: { email: payerEmail, first_name: 'Teste', last_name: 'Core Cut' },
      external_reference: `billing-check-${ref}`,
      date_of_expiration: expires,
    }, ref)
    const qr = payment.point_of_interaction?.transaction_data?.qr_code
    need(Boolean(qr), `PIX criado (id ${payment.id}, status ${payment.status}). A conta consegue gerar QR Code.`, `O Mercado Pago respondeu sem QR Code (status ${payment.status}).`)
  } catch (error) {
    bad(`PIX recusado: ${error.message}`)
    problems.push('PIX recusado')
  }
}
if (flag('--test-card')) {
  console.log('\nTeste de assinatura (cria uma assinatura PENDENTE; nada é cobrado)')
  try {
    const ref = randomUUID()
    const origin = (appUrl || 'http://localhost:5174').replace(/\/$/, '')
    const preapproval = await gateway.post('/preapproval', {
      reason: 'Core Cut ERP - teste de assinatura (billing:check)',
      external_reference: `billing-check-${ref}`,
      payer_email: payerEmail,
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: 99, currency_id: 'BRL' },
      back_url: `${returnBase(origin)}/assinatura?checkout=success&ref=${ref}`,
      status: 'pending',
    })
    need(Boolean(preapproval.init_point), `Assinatura pendente criada (id ${preapproval.id}). Retorno aceito: ${origin}`, 'O Mercado Pago não retornou o link de pagamento da assinatura.')
    if (preapproval.id) await gateway.put(`/preapproval/${preapproval.id}`, { status: 'cancelled' }).catch(() => undefined)
  } catch (error) {
    bad(`Assinatura recusada: ${error.message}`)
    problems.push('Assinatura recusada')
  }
}

console.log('')
if (problems.length && live) {
  console.log(`\x1b[31mNão está pronto para produção: ${problems.length} item(ns) bloqueante(s).\x1b[0m\n`)
  process.exit(1)
}
if (!live) console.log(`\x1b[33mModo teste${problems.length ? `: ${problems.length} pendência(s) antes de cobrar de verdade.` : ': a conta está apta; use as credenciais de produção para cobrar de verdade.'}\x1b[0m\n`)
else console.log('\x1b[32mPronto para cobrar de verdade.\x1b[0m\n')
