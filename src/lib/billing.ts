import type { PlanLimits } from '../types'

export interface BillingPlan {
  id: string
  name: string
  price: number
  currency: string
  interval: string
  description: string
  highlights: string[]
  limits: PlanLimits
  modules?: string[]
  /** Aplicativo Android incluído (Profissional e Industrial). */
  mobileApp?: boolean
}

export interface BillingMethods {
  card: { label: string; recurring: boolean; description: string }
  pix: { label: string; recurring: boolean; months: number[]; description: string }
}

export interface PixPayload {
  qrCode: string
  qrCodeBase64: string | null
  ticketUrl: string | null
  expiresAt: string
  amount: number
}

/** Resposta ao iniciar um pagamento: cartão devolve `checkoutUrl`; PIX devolve o QR Code em `pix`. */
export interface CheckoutResponse {
  ref: string
  method: PaymentMethod
  months: number
  checkoutUrl?: string
  pix?: PixPayload
}

export type PaymentMethod = 'card' | 'pix'

export const UNLIMITED = 999999

export const fallbackMethods: BillingMethods = {
  card: { label: 'Cartão de crédito', recurring: true, description: 'Assinatura mensal com renovação automática.' },
  pix: { label: 'PIX', recurring: false, months: [1, 3, 6], description: 'Pagamento único que libera o plano por 1, 3 ou 6 meses.' },
}

export const limitLabels: Array<{ key: keyof PlanLimits; label: string; usage: string }> = [
  { key: 'maxUsers', label: 'Usuários', usage: 'users' },
  { key: 'maxProjects', label: 'Projetos', usage: 'projects' },
  { key: 'maxBudgets', label: 'Orçamentos', usage: 'budgets' },
  { key: 'maxProductionOrders', label: 'Ordens de produção', usage: 'productionOrders' },
  { key: 'maxInventoryItems', label: 'Itens de estoque', usage: 'inventoryItems' },
]

export const isUnlimited = (value: number) => value >= UNLIMITED

export const monthsLabel = (months: number) => (months === 1 ? '1 mês' : `${months} meses`)

export const methodLabel = (method: string | null | undefined) =>
  method === 'card' ? 'Cartão (assinatura mensal)' : method === 'pix' ? 'PIX' : method === 'simulated' ? 'Simulado (desenvolvimento)' : method === 'trial' ? 'Teste gratuito' : method === 'manual' ? 'Licença manual' : '—'
