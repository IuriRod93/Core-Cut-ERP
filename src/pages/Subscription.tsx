import { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { PaymentMethodPicker, PayButton, type PaymentChoice } from '../components/PaymentOptions'
import { PixPaymentDialog } from '../components/PixPaymentDialog'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/feedback'
import { api } from '../lib/api'
import { brl, fmtDate } from '../lib/format'
import { fallbackMethods, methodLabel, type BillingMethods, type BillingPlan, type CheckoutResponse } from '../lib/billing'
import { colors } from '../theme'

type Phase = 'checking' | 'paid' | 'pending' | 'expired' | 'cancelled' | 'error'

interface CheckoutStatus {
  state: 'paid' | 'pending' | 'expired' | 'unknown'
  method: 'card' | 'pix'
  companyStatus: string | null
  paidUntil: string | null
  planName: string | null
  mobileApp?: boolean
}

const POLL_MS = 4000
const POLL_MAX = 100 // ~6 min

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: colors.subtle, py: { xs: 3, md: 6 }, px: 2 }}>
      <Box sx={{ maxWidth: 560, mx: 'auto' }}>
        <Box sx={{ mb: 4 }}><Logo height={26} /></Box>
        {children}
      </Box>
    </Box>
  )
}

/** Retorno do Mercado Pago (`/assinatura?checkout=success&ref=…`). Pública: funciona logado ou não. */
export function SubscriptionResultPage() {
  const [params] = useSearchParams()
  const { user, refresh } = useAuth()
  const navigate = useNavigate()
  const sessionId = params.get('ref')
  const [phase, setPhase] = useState<Phase>(params.get('checkout') === 'cancelled' ? 'cancelled' : sessionId ? 'checking' : 'error')
  const [status, setStatus] = useState<CheckoutStatus | null>(null)
  const [error, setError] = useState('')
  const attempts = useRef(0)

  const check = useCallback(async () => {
    if (!sessionId) return
    try {
      const result = await api.get<CheckoutStatus>(`/billing/checkout-status?ref=${encodeURIComponent(sessionId)}`)
      setStatus(result)
      if (result.state === 'paid') {
        setPhase('paid')
        if (user) await refresh().catch(() => undefined)
      } else if (result.state === 'expired') setPhase('expired')
      else if (result.state === 'unknown') {
        setError('Não encontramos este pagamento. Se você já pagou, aguarde alguns minutos e entre no sistema.')
        setPhase('error')
      } else setPhase('pending')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível confirmar o pagamento.')
      setPhase('error')
    }
  }, [sessionId, user, refresh])

  useEffect(() => {
    if (params.get('checkout') !== 'success' || !sessionId) return
    void check()
  }, [check, params, sessionId])

  useEffect(() => {
    if (phase !== 'pending') return
    if (attempts.current >= POLL_MAX) return
    const timer = window.setTimeout(() => {
      attempts.current += 1
      void check()
    }, POLL_MS)
    return () => window.clearTimeout(timer)
  }, [phase, status, check])

  const isAndroid = /Android/i.test(navigator.userAgent)
  const hasApp = Boolean(status?.mobileApp)
  const enter = () => navigate(user ? '/' : '/login', { replace: true })
  // plano com aplicativo (Profissional e Industrial): no Android já abre a página de download depois do login
  const downloadApp = () => navigate(user ? '/app' : '/login?next=%2Fapp', { replace: true })

  useEffect(() => {
    if (phase !== 'paid' || !hasApp || !isAndroid) return
    const timer = window.setTimeout(downloadApp, 2500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, hasApp, isAndroid])

  return (
    <Shell>
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: 3, textAlign: 'center' }}>
        {phase === 'checking' ? (
          <Stack alignItems="center" spacing={2}>
            <CircularProgress size={32} sx={{ color: colors.brand }} />
            <Typography variant="h5">Confirmando seu pagamento…</Typography>
            <Typography color="text.secondary">Isso leva só alguns segundos.</Typography>
          </Stack>
        ) : null}

        {phase === 'paid' ? (
          <Stack alignItems="center" spacing={2}>
            <Typography variant="h4" color="primary">Pagamento confirmado</Typography>
            <Typography color="text.secondary">
              {status?.planName ? `Plano ${status.planName} ativo` : 'Plano ativo'} via {methodLabel(status?.method)}
              {status?.paidUntil ? ` · válido até ${fmtDate(status.paidUntil)}` : ''}.
            </Typography>
            {hasApp ? (
              <Typography color="text.secondary">
                Seu plano inclui o <b>aplicativo Android</b>.{isAndroid ? ' Abrindo a página de download…' : ' Abra esta página no celular para baixar.'}
              </Typography>
            ) : null}
            <Button variant="contained" size="large" onClick={hasApp && isAndroid ? downloadApp : enter}>
              {hasApp && isAndroid ? 'Baixar o aplicativo' : user ? 'Abrir o ERP' : 'Entrar no ERP'}
            </Button>
            {hasApp && isAndroid ? <Button onClick={enter}>{user ? 'Abrir o ERP' : 'Entrar no ERP'}</Button> : null}
          </Stack>
        ) : null}

        {phase === 'pending' ? (
          <Stack alignItems="center" spacing={2}>
            <CircularProgress size={32} sx={{ color: colors.brand }} />
            <Typography variant="h5">Aguardando a confirmação</Typography>
            <Typography color="text.secondary">
              {status?.method === 'pix'
                ? 'Assim que o PIX for compensado o acesso é liberado automaticamente. Você pode fechar esta página e entrar depois.'
                : 'Estamos aguardando o Mercado Pago confirmar a autorização do cartão.'}
            </Typography>
            <Button onClick={() => void check()}>Verificar agora</Button>
          </Stack>
        ) : null}

        {phase === 'expired' ? (
          <Stack alignItems="center" spacing={2}>
            <Typography variant="h5">Este pagamento expirou</Typography>
            <Typography color="text.secondary">O pagamento não foi concluído a tempo. Entre no sistema para gerar um novo pagamento.</Typography>
            <Button variant="contained" onClick={() => navigate('/login')}>Entrar</Button>
          </Stack>
        ) : null}

        {phase === 'cancelled' ? (
          <Stack alignItems="center" spacing={2}>
            <Typography variant="h5">Pagamento não concluído</Typography>
            <Typography color="text.secondary">Nada foi cobrado. Seu cadastro continua salvo: entre com seu e-mail e senha para escolher a forma de pagamento.</Typography>
            <Button variant="contained" onClick={() => navigate('/login')}>Entrar para pagar</Button>
          </Stack>
        ) : null}

        {phase === 'error' ? (
          <Stack alignItems="center" spacing={2}>
            <Alert severity="warning" sx={{ width: '100%', textAlign: 'left' }}>{error || 'Não foi possível identificar o pagamento.'}</Alert>
            <Button component={RouterLink} to="/login" variant="contained">Ir para o login</Button>
          </Stack>
        ) : null}
      </Paper>
    </Shell>
  )
}

/** Tela única que o titular vê enquanto a assinatura está pendente, vencida ou cancelada. */
export function PaywallPage() {
  const { company, user, logout, refresh } = useAuth()
  const toast = useToast()
  const [plans, setPlans] = useState<BillingPlan[]>([])
  const [methods, setMethods] = useState<BillingMethods>(fallbackMethods)
  const [planId, setPlanId] = useState(company?.planId ?? 'profissional')
  const [choice, setChoice] = useState<PaymentChoice>({ method: 'pix', months: 1 })
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [pixCheckout, setPixCheckout] = useState<CheckoutResponse | null>(null)

  useEffect(() => {
    api.get<{ plans: BillingPlan[]; methods: BillingMethods }>('/billing/plans').then((r) => {
      setPlans(r.plans)
      if (r.methods) setMethods(r.methods)
    }).catch(() => undefined)
  }, [])

  const plan = plans.find((entry) => entry.id === planId)
  const isAdmin = user?.role === 'admin'

  const pay = async () => {
    setBusy(true)
    try {
      const response = await api.post<CheckoutResponse>('/billing/checkout', { planId, paymentMethod: choice.method, pixMonths: choice.months })
      if (response.pix) {
        setPixCheckout(response)
        setBusy(false)
      } else if (response.checkoutUrl) window.location.assign(response.checkoutUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível iniciar o pagamento.')
      setBusy(false)
    }
  }

  const verify = async () => {
    setChecking(true)
    try {
      await refresh()
      toast.info('Situação da assinatura atualizada.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível verificar o pagamento.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <Shell>
      <Paper variant="outlined" sx={{ p: { xs: 3, md: 4 }, borderRadius: 3 }}>
        <Typography variant="h5" sx={{ mb: 0.5 }}>{company?.name ?? 'Sua empresa'}</Typography>
        <Alert severity={company?.access.state === 'pending_payment' ? 'info' : 'warning'} sx={{ mb: 3 }}>
          {company?.access.message ?? 'Sua assinatura precisa ser regularizada para continuar.'}
        </Alert>

        {isAdmin ? (
          <Stack spacing={3}>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Plano</Typography>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
                {plans.map((entry) => (
                  <Paper
                    key={entry.id}
                    variant="outlined"
                    onClick={() => setPlanId(entry.id)}
                    sx={{ p: 1.5, borderRadius: 2, cursor: 'pointer', border: `2px solid ${planId === entry.id ? colors.brand : colors.border}`, bgcolor: planId === entry.id ? colors.brandTint : '#fff' }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{entry.name}</Typography>
                    <Typography variant="body2" color="primary">{brl(entry.price)} / mês</Typography>
                  </Paper>
                ))}
              </Box>
            </Box>
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Forma de pagamento</Typography>
              <PaymentMethodPicker plan={plan} methods={methods} value={choice} onChange={setChoice} />
            </Box>
            <PayButton busy={busy} onClick={() => void pay()} label={choice.method === 'pix' ? 'Gerar PIX' : 'Pagar com cartão (Mercado Pago)'} />
            <Button onClick={() => void verify()} disabled={checking}>Já paguei — verificar pagamento</Button>
          </Stack>
        ) : (
          <Typography color="text.secondary">Peça ao administrador da empresa para regularizar a assinatura.</Typography>
        )}

        <Button color="inherit" onClick={() => void logout()} sx={{ mt: 3 }}>Sair</Button>
      </Paper>
      {pixCheckout?.pix ? (
        <PixPaymentDialog
          checkoutRef={pixCheckout.ref}
          pix={pixCheckout.pix}
          onClose={() => setPixCheckout(null)}
          onPaid={() => {
            setPixCheckout(null)
            toast.success('Pagamento confirmado!')
            void refresh()
          }}
        />
      ) : null}
    </Shell>
  )
}
