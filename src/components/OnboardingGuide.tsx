import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Button, IconButton, LinearProgress, Paper, Typography } from '@mui/material'
import { Stack } from './Stack'
import { CheckCircleIcon, CloseIcon, RadioButtonUncheckedIcon } from './icons'
import { useAuth } from '../auth/AuthContext'
import { useCollections } from '../lib/store'
import { colors } from '../theme'

const DISMISS_KEY = 'core-cut-erp.onboarding-dismissed'

/**
 * Primeiros passos do teste de 48 horas: cadastrar a chapa, importar/criar o plano e calcular.
 * Some sozinho quando os três passos estão feitos (ou quando a pessoa dispensa).
 */
export function OnboardingGuide() {
  const { user, can } = useAuth()
  const navigate = useNavigate()
  const { data, loading } = useCollections(['materials', 'cutPlans'] as const)
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      return false
    }
  })
  if (hidden || !user?.companyId || !can('cutplan') || !can('inventory')) return null

  const sheets = data.materials.some((m) => m.category === 'chapa' && m.active !== false)
  const plans = data.cutPlans.length > 0
  const calculated = data.cutPlans.some((p) => (p.sheetCount ?? p.groups?.length ?? 0) > 0)
  const steps = [
    { done: sheets, title: 'Cadastre as chapas que você usa', text: 'Escolha do catálogo Leo Madeiras (com preço em R$) ou cadastre manualmente.', action: 'Abrir o estoque', to: '/estoque' },
    { done: plans, title: 'Importe o arquivo do Promob ou digite as peças', text: 'CSV, XML, DXF ou DXT. Aceita centenas de arquivos de uma vez, inclusive a pasta inteira.', action: 'Novo plano de corte', to: '/plano-de-corte?plano=novo' },
    { done: calculated, title: 'Calcule o plano e gere as etiquetas', text: 'Veja o aproveitamento, o custo e imprima as etiquetas com QR Code.', action: 'Abrir planos', to: '/plano-de-corte' },
  ]
  const finished = steps.filter((s) => s.done).length
  if (loading || finished === steps.length) return null
  const current = steps.findIndex((s) => !s.done)

  return (
    <Paper variant="outlined" sx={{ p: 2.5, mb: 3, borderRadius: 3, borderColor: colors.brandTint2, bgcolor: colors.brandTint }}>
      <Stack direction="row" alignItems="flex-start" spacing={1}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="overline" color="primary">
            Primeiros passos · {finished} de {steps.length}
          </Typography>
          <Typography variant="h5" sx={{ mb: 1.5 }}>
            Em 3 passos você vê o seu primeiro plano de corte
          </Typography>
          <LinearProgress variant="determinate" value={(finished / steps.length) * 100} sx={{ mb: 2, height: 6, borderRadius: 3, bgcolor: '#fff' }} />
          <Stack spacing={1.5}>
            {steps.map((step, index) => (
              <Stack key={step.title} direction="row" spacing={1.5} alignItems="center" sx={{ opacity: step.done ? 0.65 : 1 }}>
                {step.done ? <CheckCircleIcon sx={{ color: colors.success }} /> : <RadioButtonUncheckedIcon sx={{ color: colors.textMuted }} />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" sx={{ textDecoration: step.done ? 'line-through' : 'none' }}>
                    {step.title}
                  </Typography>
                  {!step.done ? (
                    <Typography variant="caption" color="text.secondary">
                      {step.text}
                    </Typography>
                  ) : null}
                </Box>
                {!step.done ? (
                  <Button size="small" variant={index === current ? 'contained' : 'outlined'} onClick={() => navigate(step.to)}>
                    {step.action}
                  </Button>
                ) : null}
              </Stack>
            ))}
          </Stack>
        </Box>
        <IconButton
          size="small"
          aria-label="Dispensar primeiros passos"
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, '1')
            } catch {
              /* sem armazenamento: some só nesta visita */
            }
            setHidden(true)
          }}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  )
}
