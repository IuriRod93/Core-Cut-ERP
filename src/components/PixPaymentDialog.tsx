import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'
import { Stack } from './Stack'
import { useToast } from './feedback'
import { api } from '../lib/api'
import { brl, fmtDateTime } from '../lib/format'
import { colors } from '../theme'
import type { PixPayload } from '../lib/billing'

interface Status {
  state: 'paid' | 'pending' | 'expired' | 'unknown'
  paidUntil: string | null
}

const POLL_MS = 4000

/** QR Code e código "copia e cola" do PIX; confirma o pagamento sozinho assim que o Mercado Pago aprova. */
export function PixPaymentDialog({
  checkoutRef,
  pix,
  title = 'Pague com PIX',
  onPaid,
  onClose,
}: {
  checkoutRef: string
  pix: PixPayload
  title?: string
  onPaid: () => void
  onClose: () => void
}) {
  const toast = useToast()
  const [expired, setExpired] = useState(false)
  const [checking, setChecking] = useState(false)
  const done = useRef(false)

  const check = useCallback(
    async (manual = false) => {
      if (done.current) return
      if (manual) setChecking(true)
      try {
        const status = await api.get<Status>(`/billing/checkout-status?ref=${encodeURIComponent(checkoutRef)}`)
        if (status.state === 'paid') {
          done.current = true
          onPaid()
        } else if (status.state === 'expired') {
          done.current = true
          setExpired(true)
        } else if (manual) toast.info('Ainda não recebemos o pagamento.')
      } catch {
        /* nova tentativa no próximo ciclo */
      } finally {
        if (manual) setChecking(false)
      }
    },
    [checkoutRef, onPaid, toast],
  )

  useEffect(() => {
    const timer = window.setInterval(() => void check(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [check])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pix.qrCode)
      toast.success('Código PIX copiado.')
    } catch {
      toast.error('Não foi possível copiar. Selecione o código e copie manualmente.')
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} alignItems="center">
          <Typography variant="h4" color="primary">{brl(pix.amount)}</Typography>
          {expired ? (
            <Alert severity="warning" sx={{ width: '100%' }}>Este PIX expirou. Feche e gere um novo pagamento.</Alert>
          ) : (
            <>
              {pix.qrCodeBase64 ? (
                <Box component="img" alt="QR Code do PIX" src={`data:image/png;base64,${pix.qrCodeBase64}`} sx={{ width: 220, height: 220, border: `1px solid ${colors.border}`, borderRadius: 2, p: 1, bgcolor: '#fff' }} />
              ) : null}
              <Typography variant="body2" color="text.secondary" align="center">
                Abra o app do seu banco, escolha pagar com PIX e leia o QR Code — ou use o código copia e cola.
              </Typography>
              <TextField value={pix.qrCode} fullWidth size="small" slotProps={{ input: { readOnly: true } }} onFocus={(e) => e.target.select()} />
              <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
                <Button variant="contained" fullWidth onClick={() => void copy()}>Copiar código</Button>
                {pix.ticketUrl ? <Button variant="outlined" fullWidth href={pix.ticketUrl} target="_blank" rel="noreferrer">Abrir no Mercado Pago</Button> : null}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={16} sx={{ color: colors.brand }} />
                <Typography variant="caption" color="text.secondary">Aguardando o pagamento — a confirmação é automática.</Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">Válido até {fmtDateTime(pix.expiresAt)}</Typography>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {!expired ? <Button onClick={() => void check(true)} disabled={checking}>Já paguei — verificar</Button> : null}
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}
