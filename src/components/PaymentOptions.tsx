import { Box, Button, CircularProgress, Paper, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { Stack } from './Stack'
import { brl } from '../lib/format'
import { colors } from '../theme'
import { fallbackMethods, monthsLabel, type BillingMethods, type BillingPlan, type PaymentMethod } from '../lib/billing'

export interface PaymentChoice {
  method: PaymentMethod
  months: number
}

/** Escolha entre cartão (assinatura) e PIX (1, 3 ou 6 meses) com o valor a cobrar. */
export function PaymentMethodPicker({
  plan,
  methods = fallbackMethods,
  value,
  onChange,
}: {
  plan: BillingPlan | undefined
  methods?: BillingMethods
  value: PaymentChoice
  onChange: (choice: PaymentChoice) => void
}) {
  const price = plan?.price ?? 0
  const pixTotal = price * value.months
  const options: Array<{ id: PaymentMethod; title: string; text: string; amount: string }> = [
    { id: 'card', title: 'Cartão de crédito', text: 'Assinatura mensal, renovação automática.', amount: `${brl(price)} / mês` },
    { id: 'pix', title: 'PIX', text: 'Pagamento único, sem recorrência.', amount: `${brl(pixTotal)} por ${monthsLabel(value.months)}` },
  ]
  return (
    <Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 1.5 }}>
        {options.map((option) => {
          const selected = value.method === option.id
          return (
            <Paper
              key={option.id}
              variant="outlined"
              role="radio"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => onChange({ ...value, method: option.id })}
              onKeyDown={(event) => (event.key === 'Enter' || event.key === ' ') && onChange({ ...value, method: option.id })}
              sx={{ p: 2, borderRadius: 2.5, cursor: 'pointer', border: `2px solid ${selected ? colors.brand : colors.border}`, bgcolor: selected ? colors.brandTint : '#fff' }}
            >
              <Typography sx={{ fontWeight: 700 }}>{option.title}</Typography>
              <Typography variant="body2" color="text.secondary">{option.text}</Typography>
              <Typography variant="subtitle1" color="primary" sx={{ mt: 1, fontWeight: 700 }}>{option.amount}</Typography>
            </Paper>
          )
        })}
      </Box>
      {value.method === 'pix' ? (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">Período pago por PIX</Typography>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={value.months}
            onChange={(_, months: number | null) => months && onChange({ ...value, months })}
            sx={{ display: 'flex', mt: 0.5 }}
          >
            {methods.pix.months.map((months) => (
              <ToggleButton key={months} value={months} sx={{ flex: 1, textTransform: 'none' }}>
                {monthsLabel(months)}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            O PIX libera o plano até a data de validade. Para continuar depois, basta gerar um novo PIX — ele soma à validade atual.
          </Typography>
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          O cartão é cobrado todo mês automaticamente pelo Mercado Pago. Você pode cancelar quando quiser em Configurações → Assinatura.
        </Typography>
      )}
    </Box>
  )
}

/** Botão de pagamento com estado de carregamento. */
export function PayButton({ label, busy, onClick, disabled }: { label: string; busy: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <Stack direction="row" spacing={1}>
      <Button variant="contained" size="large" fullWidth onClick={onClick} disabled={busy || disabled}>
        {busy ? <CircularProgress size={22} color="inherit" /> : label}
      </Button>
    </Stack>
  )
}
