import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Chip, CircularProgress, Grid, MenuItem, TextField, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { KeyValue, PageHeader, Panel } from '../components/ui'
import { useToast } from '../components/feedback'
import { api } from '../lib/api'
import { brl, fmtDateTime } from '../lib/format'
import { colors } from '../theme'
import type { PixPayload } from '../lib/billing'

interface MpStatus {
  configured: boolean
  mode: 'unconfigured' | 'test' | 'live'
  reachable: boolean
  latencyMs?: number
  error?: string
  tokenHint: string | null
  webhookSecret: boolean
  appUrl: string | null
  notificationUrl: string | null
  simulationAllowed: boolean
  account?: { id: number; nickname: string | null; email: string | null; siteId: string | null; country: string | null }
}

type ChargeState = 'pending' | 'paid' | 'expired'

/** Página dedicada: diagnostica a API do Mercado Pago e gera o QR Code PIX de teste (R$ 1,00). */
export function PlatformPaymentTestPage() {
  const toast = useToast()
  const [params] = useSearchParams()
  const [status, setStatus] = useState<MpStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState(() => {
    const wanted = Number(params.get('valor'))
    return [1, 2, 5, 10].includes(wanted) ? wanted : 1
  })
  const [busy, setBusy] = useState(false)
  const [charge, setCharge] = useState<{ ref: string; pix: PixPayload } | null>(null)
  const [state, setState] = useState<ChargeState>('pending')
  const [now, setNow] = useState(() => Date.now())
  const autoStarted = useRef(false)

  const diagnose = useCallback(async () => {
    setLoading(true)
    try {
      setStatus(await api.get<MpStatus>('/platform/mercadopago'))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível consultar o Mercado Pago.')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    document.title = 'Teste de pagamento | Painel Admin'
    void diagnose()
  }, [diagnose])

  const generate = useCallback(async () => {
    setBusy(true)
    setState('pending')
    try {
      const result = await api.post<{ ref: string; pix: PixPayload }>('/platform/payment-test', { method: 'pix', amount })
      setCharge({ ref: result.ref, pix: result.pix })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o PIX.')
    } finally {
      setBusy(false)
    }
  }, [amount, toast])

  // ?gerar=1 abre a página já com o QR Code de teste gerado
  useEffect(() => {
    if (params.get('gerar') === '1' && !autoStarted.current && status?.reachable) {
      autoStarted.current = true
      void generate()
    }
  }, [params, status, generate])

  // confirma o pagamento sozinho
  useEffect(() => {
    if (!charge || state !== 'pending') return
    const timer = window.setInterval(async () => {
      setNow(Date.now())
      try {
        const result = await api.get<{ state: string }>(`/billing/checkout-status?ref=${encodeURIComponent(charge.ref)}`)
        if (result.state === 'paid') {
          setState('paid')
          toast.success('Pagamento confirmado pelo Mercado Pago!')
        } else if (result.state === 'expired') setState('expired')
      } catch {
        /* tenta no próximo ciclo */
      }
    }, 3000)
    return () => window.clearInterval(timer)
  }, [charge, state, toast])

  const copy = async () => {
    if (!charge) return
    try {
      await navigator.clipboard.writeText(charge.pix.qrCode)
      toast.success('Código PIX copiado.')
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  const secondsLeft = charge ? Math.max(0, Math.floor((Date.parse(charge.pix.expiresAt) - now) / 1000)) : 0
  const modeChip = status ? (
    <Chip size="small" color={status.mode === 'live' ? 'success' : status.mode === 'test' ? 'warning' : 'error'} label={status.mode === 'live' ? 'Produção' : status.mode === 'test' ? 'Teste' : 'Não configurado'} />
  ) : null

  return (
    <Box>
      <PageHeader title="Teste de pagamento — Mercado Pago" subtitle="Diagnostica a conexão com a API e gera um QR Code PIX real para confirmar que o dinheiro chega na sua conta." />
      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12, lg: 5 }}>
          <Panel title="Diagnóstico da API" subtitle="Consulta ao vivo à conta configurada no servidor" actions={<Button size="small" onClick={() => void diagnose()} disabled={loading}>Verificar de novo</Button>}>
            {loading || !status ? (
              <Stack direction="row" spacing={1.5} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Consultando o Mercado Pago…</Typography></Stack>
            ) : (
              <Stack spacing={2}>
                {status.reachable ? (
                  <Alert severity="success">API conectada · resposta em {status.latencyMs} ms</Alert>
                ) : (
                  <Alert severity="error">{status.error ?? 'Não foi possível conectar à API do Mercado Pago.'}</Alert>
                )}
                {status.mode === 'test' ? <Alert severity="warning">Credenciais de teste: o dinheiro não é real.</Alert> : null}
                <KeyValue
                  columns={1}
                  items={[
                    { label: 'Modo', value: modeChip },
                    { label: 'Conta que recebe', value: status.account ? `${status.account.nickname ?? '—'} · id ${status.account.id}` : '—' },
                    { label: 'E-mail da conta', value: status.account?.email ?? '—' },
                    { label: 'País / site', value: status.account ? `${status.account.country ?? '—'} · ${status.account.siteId ?? '—'}` : '—' },
                    { label: 'Token (parcial)', value: status.tokenHint ?? '—' },
                    { label: 'Assinatura do webhook', value: status.webhookSecret ? 'configurada' : 'ausente' },
                    { label: 'URL de notificação', value: status.notificationUrl ?? 'indisponível (APP_URL não é https)' },
                  ]}
                />
                {!status.webhookSecret ? <Alert severity="info">Sem a assinatura secreta, o servidor não valida notificações automáticas. A confirmação nesta tela funciona do mesmo jeito, consultando o Mercado Pago.</Alert> : null}
              </Stack>
            )}
          </Panel>
        </Grid>

        <Grid size={{ xs: 12, lg: 7 }}>
          <Panel title="QR Code PIX de teste" subtitle="Cobrança real — não altera nenhuma empresa nem a receita do painel">
            <Stack spacing={2.5}>
              <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
                <TextField select size="small" label="Valor" value={amount} onChange={(e) => setAmount(Number(e.target.value))} sx={{ width: { xs: 'calc(50% - 6px)', sm: 140 } }} disabled={busy}>
                  {[1, 2, 5, 10].map((value) => (
                    <MenuItem key={value} value={value}>{brl(value)}</MenuItem>
                  ))}
                </TextField>
                <Button variant="contained" size="large" disabled={busy || !status?.reachable} onClick={() => void generate()}>
                  {busy ? <CircularProgress size={22} color="inherit" /> : `Gerar QR Code de ${brl(amount)}`}
                </Button>
              </Stack>

              {charge ? (
                state === 'paid' ? (
                  <Alert severity="success" sx={{ alignItems: 'center' }}>
                    <Typography sx={{ fontWeight: 700 }}>Pagamento de {brl(charge.pix.amount)} confirmado!</Typography>
                    <Typography variant="body2">Confira em Mercado Pago → Seu negócio → Atividade. Você pode estornar por lá. A cobrança aparece no Painel Admin → Pagamentos como “Teste”.</Typography>
                  </Alert>
                ) : state === 'expired' ? (
                  <Alert severity="warning">Este PIX expirou ou foi cancelado. Gere outro QR Code.</Alert>
                ) : (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '280px 1fr' }, gap: 3, alignItems: 'start' }}>
                    <Box sx={{ textAlign: 'center' }}>
                      {charge.pix.qrCodeBase64 ? (
                        <Box component="img" alt="QR Code do PIX" src={`data:image/png;base64,${charge.pix.qrCodeBase64}`} sx={{ width: 260, height: 260, border: `1px solid ${colors.border}`, borderRadius: 3, p: 1.5, bgcolor: '#fff' }} />
                      ) : (
                        <Alert severity="info">Imagem indisponível: use o código “copia e cola”.</Alert>
                      )}
                      <Typography variant="h5" color="primary" sx={{ mt: 1.5 }}>{brl(charge.pix.amount)}</Typography>
                    </Box>
                    <Stack spacing={1.5}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <CircularProgress size={16} />
                        <Typography variant="body2" color="text.secondary">Aguardando o pagamento… confirmação automática</Typography>
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        Leia o QR Code no aplicativo do seu banco (use uma conta bancária; não pague pela mesma conta do Mercado Pago que recebe). Expira em {Math.floor(secondsLeft / 60)} min {secondsLeft % 60} s — {fmtDateTime(charge.pix.expiresAt)}.
                      </Typography>
                      <TextField value={charge.pix.qrCode} size="small" fullWidth slotProps={{ input: { readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.78rem' } } }} onFocus={(e) => e.target.select()} label="PIX copia e cola" />
                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        <Button variant="outlined" onClick={() => void copy()}>Copiar código</Button>
                        {charge.pix.ticketUrl ? <Button variant="outlined" href={charge.pix.ticketUrl} target="_blank" rel="noreferrer">Abrir página de pagamento</Button> : null}
                      </Stack>
                    </Stack>
                  </Box>
                )
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Dica: abra esta página já com o QR Code pronto usando o link <code>/admin/teste-pagamento?gerar=1</code> (valor padrão R$ 1,00; use <code>&amp;valor=5</code> para outro valor).
                </Typography>
              )}
            </Stack>
          </Panel>
        </Grid>
      </Grid>
      <Alert severity="info" sx={{ mt: 2.5 }}>
        Para testar o cartão (assinatura de R$ 1,00), use <strong>Painel Admin → Teste de cobrança</strong>.
      </Alert>
    </Box>
  )
}
