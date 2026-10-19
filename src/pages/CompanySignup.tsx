import { useEffect, useState, type FormEvent } from 'react'
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, Paper, TextField, Typography } from '@mui/material'
import { PaymentMethodPicker, type PaymentChoice } from '../components/PaymentOptions'
import { PixPaymentDialog } from '../components/PixPaymentDialog'
import { fallbackMethods, isUnlimited, type BillingMethods, type BillingPlan, type CheckoutResponse } from '../lib/billing'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/feedback'
import { api } from '../lib/api'
import { brl } from '../lib/format'
import { colors } from '../theme'

const fallbackPlans: BillingPlan[] = [
  { id: 'essencial', name: 'Essencial', price: 99, currency: 'BRL', interval: 'month', description: 'Projetos, clientes, orçamentos e financeiro básico.', highlights: ['Até 3 usuários', 'Projetos e orçamentos', 'Estoque e fornecedores'], limits: { maxUsers: 3, maxProjects: 50, maxBudgets: 100, maxProductionOrders: 50, maxInventoryItems: 200 } },
  { id: 'profissional', name: 'Profissional', price: 199, currency: 'BRL', interval: 'month', description: 'Operação completa para marcenarias em crescimento.', highlights: ['Até 10 usuários', 'Produção e plano de corte', 'Compras e qualidade', 'Aplicativo Android e iOS'], limits: { maxUsers: 10, maxProjects: 200, maxBudgets: 500, maxProductionOrders: 200, maxInventoryItems: 1000 } },
  { id: 'industrial', name: 'Industrial', price: 399, currency: 'BRL', interval: 'month', description: 'Controle avançado para produção em escala.', highlights: ['Usuários ilimitados', 'Chão de fábrica e manutenção', 'Relatórios e automações', 'Aplicativo Android e iOS'], limits: { maxUsers: 999999, maxProjects: 999999, maxBudgets: 999999, maxProductionOrders: 999999, maxInventoryItems: 999999 } },
]

type Start = 'trial' | 'pay'

export function CompanySignupPage() {
  const { user, login } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [plans, setPlans] = useState<BillingPlan[]>(fallbackPlans)
  const [methods, setMethods] = useState<BillingMethods>(fallbackMethods)
  const [start, setStart] = useState<Start>(params.get('contratar') === '1' ? 'pay' : 'trial')
  const [choice, setChoice] = useState<PaymentChoice>({ method: 'pix', months: 1 })
  const [canSimulate, setCanSimulate] = useState(false)
  const [pixCheckout, setPixCheckout] = useState<CheckoutResponse | null>(null)
  const [planId, setPlanId] = useState(() => {
    const wanted = params.get('plano')
    return fallbackPlans.some((plan) => plan.id === wanted) ? (wanted as string) : 'profissional'
  })
  const [companyName, setCompanyName] = useState('')
  const [legalName, setLegalName] = useState('')
  const [document, setDocument] = useState('')
  const [phone, setPhone] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document_title('Cadastro | Core Cut')
    api.get<{ plans: BillingPlan[]; methods?: BillingMethods; simulationAllowed?: boolean }>('/billing/plans').then((response) => {
      if (response.plans?.length) setPlans(response.plans)
      if (response.methods) setMethods(response.methods)
      setCanSimulate(Boolean(response.simulationAllowed))
    }).catch(() => undefined)
  }, [])

  if (user) return <Navigate to="/painel" replace />

  const selectedPlan = plans.find((plan) => plan.id === planId)
  const base = { companyName, legalName, document, phone, ownerName, email, password, planId, acceptTerms: accepted }

  const validate = () => {
    if (password !== confirmPassword) return 'As senhas não conferem.'
    if (!accepted) return 'Aceite os Termos de Uso e a Política de Privacidade para continuar.'
    return ''
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = validate()
    if (problem) return toast.error(problem)
    setBusy(true)
    try {
      if (start === 'trial') {
        await api.post('/auth/register-company', { ...base, trial: true })
        await login(email.trim(), password) // a conta já nasce ativa por 48 h
        toast.success('Seu teste gratuito de 48 horas começou. Bom trabalho!')
        const withApp = ['profissional', 'industrial'].includes(planId) && /Android/i.test(navigator.userAgent)
        navigate(withApp ? '/app' : '/painel', { replace: true })
        return
      }
      const response = await api.post<CheckoutResponse & { simulated?: boolean }>('/auth/register-company', { ...base, paymentMethod: choice.method, pixMonths: choice.months })
      if (response.pix) {
        setPixCheckout(response)
        setBusy(false)
      } else if (response.checkoutUrl) {
        window.location.assign(response.checkoutUrl)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível concluir o cadastro.')
      setBusy(false)
    }
  }

  const simulatePayment = async () => {
    const problem = password !== confirmPassword ? 'As senhas não conferem.' : !companyName || !email || !ownerName ? 'Preencha todos os campos obrigatórios.' : ''
    if (problem) return toast.error(problem)
    setBusy(true)
    try {
      await api.post('/auth/register-company', { ...base, simulate: true })
      toast.success('Conta criada com sucesso! Faça login para continuar.')
      window.location.href = '/login'
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Não foi possível criar a conta.')
      setBusy(false)
    }
  }

  const submitLabel = start === 'trial' ? 'Começar teste grátis de 48 horas' : choice.method === 'pix' ? 'Continuar e gerar PIX' : 'Continuar para o Mercado Pago'

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: colors.subtle, py: { xs: 3, md: 5 }, px: 2 }}>
      <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
          <RouterLink to="/" aria-label="Voltar ao site"><Logo height={28} /></RouterLink>
          <Stack direction="row" spacing={1}>
            <Button component={RouterLink} to="/" variant="text">Voltar ao site</Button>
            <Button component={RouterLink} to="/login" variant="outlined">Já tenho acesso</Button>
          </Stack>
        </Stack>

        <Box sx={{ textAlign: 'center', mb: 4 }}>
          <Typography variant="h2" sx={{ mb: 1 }}>Crie a conta da sua empresa</Typography>
          <Typography color="text.secondary">Teste o Core Cut ERP por 48 horas, sem cartão. Depois, escolha o plano que cabe na sua marcenaria.</Typography>
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', lg: 'minmax(0,1fr) 360px' }, gap: 3, alignItems: 'start' }}>
          <Box component="form" onSubmit={submit}>
            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, mb: 3 }}>
              <Typography variant="h5" sx={{ mb: 0.5 }}>1. Escolha o plano</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>No teste você usa o plano escolhido com todos os recursos dele.</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(3, minmax(0,1fr))' }, gap: 1.5 }}>
                {plans.map((plan) => (
                  <Paper
                    key={plan.id}
                    variant="outlined"
                    role="radio"
                    aria-checked={planId === plan.id}
                    tabIndex={0}
                    onClick={() => setPlanId(plan.id)}
                    onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setPlanId(plan.id)}
                    sx={{ p: 2, borderRadius: 2.5, cursor: 'pointer', border: `2px solid ${planId === plan.id ? colors.brand : colors.border}`, bgcolor: planId === plan.id ? colors.brandTint : '#fff' }}
                  >
                    <Typography sx={{ fontWeight: 700, fontSize: '1.1rem' }}>{plan.name}</Typography>
                    <Typography variant="h5" color="primary" sx={{ mt: 0.5 }}>{brl(plan.price)}<Typography component="span" variant="body2" color="text.secondary"> / mês</Typography></Typography>
                    <Stack spacing={0.4} sx={{ mt: 1.5 }}>
                      {plan.highlights.map((highlight) => <Typography key={highlight} variant="body2">✓ {highlight}</Typography>)}
                    </Stack>
                  </Paper>
                ))}
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3, mb: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>2. Dados da empresa e do administrador</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', md: 'repeat(2, minmax(0,1fr))' }, gap: 2 }}>
                <TextField label="Nome comercial" value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
                <TextField label="Razão social" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                <TextField label="CNPJ ou CPF" value={document} onChange={(e) => setDocument(e.target.value)} />
                <TextField label="Telefone / WhatsApp" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                <TextField label="Nome do administrador" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
                <TextField label="E-mail de acesso" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                <TextField label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required helperText="Mínimo de 8 caracteres" autoComplete="new-password" />
                <TextField label="Confirmar senha" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" />
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, borderRadius: 3 }}>
              <Typography variant="h5" sx={{ mb: 2 }}>3. Como você quer começar?</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0,1fr)', sm: 'repeat(2, minmax(0,1fr))' }, gap: 1.5 }}>
                {([
                  { id: 'trial' as Start, title: 'Teste grátis por 48 horas', text: 'Entre agora, sem cartão e sem compromisso.', tag: 'Recomendado' },
                  { id: 'pay' as Start, title: 'Contratar agora', text: 'Pague por cartão (assinatura) ou PIX e comece já.', tag: '' },
                ]).map((option) => (
                  <Paper
                    key={option.id}
                    variant="outlined"
                    role="radio"
                    aria-checked={start === option.id}
                    tabIndex={0}
                    onClick={() => setStart(option.id)}
                    onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && setStart(option.id)}
                    sx={{ p: 2, borderRadius: 2.5, cursor: 'pointer', border: `2px solid ${start === option.id ? colors.brand : colors.border}`, bgcolor: start === option.id ? colors.brandTint : '#fff' }}
                  >
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography sx={{ fontWeight: 700 }}>{option.title}</Typography>
                      {option.tag ? <Typography variant="caption" sx={{ color: colors.brandDark, fontWeight: 700 }}>{option.tag}</Typography> : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">{option.text}</Typography>
                  </Paper>
                ))}
              </Box>

              {start === 'pay' ? (
                <Box sx={{ mt: 2.5 }}>
                  <PaymentMethodPicker plan={selectedPlan} methods={methods} value={choice} onChange={setChoice} />
                </Box>
              ) : (
                <Alert severity="info" sx={{ mt: 2.5 }}>
                  Durante 48 horas você usa o plano {selectedPlan?.name ?? 'escolhido'} completo. Quando o teste terminar, o acesso fica em pausa e os seus dados continuam guardados até você escolher um plano.
                </Alert>
              )}

              <FormControlLabel
                sx={{ mt: 2, alignItems: 'flex-start' }}
                control={<Checkbox checked={accepted} onChange={(e) => setAccepted(e.target.checked)} sx={{ pt: 0.5 }} />}
                label={
                  <Typography variant="body2">
                    Li e aceito os <RouterLink to="/termos" target="_blank" style={{ color: colors.brandDark }}>Termos de Uso</RouterLink> e a{' '}
                    <RouterLink to="/privacidade" target="_blank" style={{ color: colors.brandDark }}>Política de Privacidade</RouterLink>.
                  </Typography>
                }
              />

              <Button type="submit" variant="contained" size="large" fullWidth sx={{ mt: 2 }} disabled={busy}>
                {busy ? <CircularProgress size={22} color="inherit" /> : submitLabel}
              </Button>
              {canSimulate ? (
                <Button variant="outlined" size="large" fullWidth sx={{ mt: 1.5 }} disabled={busy} onClick={simulatePayment}>
                  Simular pagamento (somente desenvolvimento)
                </Button>
              ) : null}
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1.5 }}>
                Pagamentos processados pelo Mercado Pago. Nenhum dado de cartão é armazenado pelo ERP.
              </Typography>
            </Paper>
          </Box>

          <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, position: { lg: 'sticky' }, top: { lg: 24 } }}>
            <Typography variant="overline" color="text.secondary">Resumo</Typography>
            <Typography variant="h4" sx={{ mt: 0.5 }}>{selectedPlan?.name}</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>{selectedPlan?.description}</Typography>
            <Typography variant="h3" color="primary">{brl(selectedPlan?.price ?? 0)}<Typography component="span" variant="body2" color="text.secondary"> / mês</Typography></Typography>
            <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }}>
              {start === 'trial' ? 'Hoje: R$ 0,00 — teste de 48 horas' : choice.method === 'pix' ? `Hoje: ${brl((selectedPlan?.price ?? 0) * choice.months)} por PIX` : `Hoje: ${brl(selectedPlan?.price ?? 0)} no cartão`}
            </Typography>
            {selectedPlan?.limits ? (
              <Stack spacing={0.5} sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>INCLUI</Typography>
                <Typography variant="body2">• {isUnlimited(selectedPlan.limits.maxUsers) ? 'Usuários ilimitados' : `${selectedPlan.limits.maxUsers} usuários`}</Typography>
                <Typography variant="body2">• {isUnlimited(selectedPlan.limits.maxProjects) ? 'Projetos ilimitados' : `${selectedPlan.limits.maxProjects} projetos`}</Typography>
                <Typography variant="body2">• {isUnlimited(selectedPlan.limits.maxBudgets) ? 'Orçamentos ilimitados' : `${selectedPlan.limits.maxBudgets} orçamentos`}</Typography>
                <Typography variant="body2">• {isUnlimited(selectedPlan.limits.maxProductionOrders) ? 'Ordens de produção ilimitadas' : `${selectedPlan.limits.maxProductionOrders} ordens de produção`}</Typography>
                <Typography variant="body2">• {isUnlimited(selectedPlan.limits.maxInventoryItems) ? 'Itens de estoque ilimitados' : `${selectedPlan.limits.maxInventoryItems} itens de estoque`}</Typography>
              </Stack>
            ) : null}
            <Stack spacing={0.5} sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>SEGURANÇA</Typography>
              <Typography variant="body2">• Conexão protegida (HTTPS)</Typography>
              <Typography variant="body2">• Dados da sua empresa isolados das demais</Typography>
              <Typography variant="body2">• Cancele quando quiser</Typography>
            </Stack>
          </Paper>
        </Box>
      </Box>
      {pixCheckout?.pix ? (
        <PixPaymentDialog
          checkoutRef={pixCheckout.ref}
          pix={pixCheckout.pix}
          title="Pague com PIX para ativar sua conta"
          onClose={() => setPixCheckout(null)}
          onPaid={() => window.location.assign(`/assinatura?checkout=success&ref=${pixCheckout.ref}`)}
        />
      ) : null}
    </Box>
  )
}

function document_title(title: string) {
  if (typeof window !== 'undefined') window.document.title = title
}
