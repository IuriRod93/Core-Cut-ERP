import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, LinearProgress, TextField, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { fmtDate } from '../lib/format'
import { colors } from '../theme'

interface PortalData {
  company: { name: string; phone: string; email: string; website: string }
  project: {
    code?: string
    name: string
    environment: string
    startDate: string | null
    dueDate: string | null
    progress: number
    stage: { label: string; index: number; total: number }
    stages: { label: string; state: 'done' | 'current' | 'todo' }[]
  }
  production: { title: string; progress: number; steps: { name: string; status: string; done: boolean }[] }[]
  visits: { kind: string; date: string; time: string | null; status: string }[]
}

const digits = (value: string) => value.replace(/\D/g, '')

/** Página pública do cliente: andamento do projeto por link secreto, sem login e sem nenhum valor financeiro. */
export function ClientPortalPage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<PortalData | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', contact: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<string | null>(null)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let alive = true
    document.title = 'Acompanhe seu projeto'
    // sem cabeçalho de autorização: esta página é pública
    fetch(`/api/public/portal/${encodeURIComponent(token)}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok) throw new Error(body?.error ?? 'Não foi possível abrir o acompanhamento.')
        return body as PortalData
      })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Não foi possível abrir o acompanhamento.'))
    return () => {
      alive = false
    }
  }, [token])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError('')
    setBusy(true)
    try {
      const r = await fetch(`/api/public/portal/${encodeURIComponent(token)}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      const body = await r.json().catch(() => null)
      if (!r.ok) throw new Error(body?.error ?? 'Não foi possível enviar agora.')
      setSent(body?.code ?? '')
      setForm({ name: '', contact: '', message: '' })
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível enviar agora.')
    } finally {
      setBusy(false)
    }
  }

  if (error)
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, bgcolor: colors.subtle }}>
        <Box sx={{ maxWidth: 420, bgcolor: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, p: 4, textAlign: 'center' }}>
          <Typography variant="h4" sx={{ mb: 1 }}>
            Link indisponível
          </Typography>
          <Typography color="text.secondary">{error}</Typography>
        </Box>
      </Box>
    )

  if (!data)
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    )

  const { company, project } = data
  const phone = digits(company.phone)
  const whatsapp = phone.length >= 10 ? `https://wa.me/${phone.startsWith('55') ? phone : `55${phone}`}?text=${encodeURIComponent(`Olá! Sobre o projeto ${project.name}…`)}` : null

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: colors.subtle, py: { xs: 2, sm: 5 }, px: 2 }}>
      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {company.name || 'Sua marcenaria'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Acompanhamento do projeto
          </Typography>
        </Stack>

        <Box sx={{ bgcolor: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, p: { xs: 2.5, sm: 3.5 }, mb: 2 }}>
          <Typography variant="overline" color="primary">
            {project.code}
          </Typography>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            {project.name}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            {[project.environment, project.dueDate ? `Previsão de entrega: ${fmtDate(project.dueDate)}` : ''].filter(Boolean).join(' · ')}
          </Typography>

          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Etapa atual: {project.stage.label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {project.progress}% concluído
            </Typography>
          </Stack>
          <LinearProgress variant="determinate" value={Math.min(Math.max(project.progress, 0), 100)} sx={{ height: 10, borderRadius: 5, mb: 3 }} />

          <Box sx={{ display: 'grid', gap: 0.75 }}>
            {project.stages.map((s) => (
              <Stack key={s.label} direction="row" spacing={1.25} alignItems="center">
                <Box
                  sx={{
                    width: 18,
                    height: 18,
                    borderRadius: '50%',
                    flex: 'none',
                    border: `2px solid ${s.state === 'todo' ? colors.border : colors.brand}`,
                    bgcolor: s.state === 'done' ? colors.brand : s.state === 'current' ? colors.brandTint : '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                    fontSize: 11,
                    lineHeight: 1,
                  }}
                >
                  {s.state === 'done' ? '✓' : ''}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: s.state === 'current' ? 700 : 400, color: s.state === 'todo' ? 'text.secondary' : 'text.primary' }}>
                  {s.label}
                  {s.state === 'current' ? ' — em andamento' : ''}
                </Typography>
              </Stack>
            ))}
          </Box>
        </Box>

        {data.production.length ? (
          <Box sx={{ bgcolor: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, p: { xs: 2.5, sm: 3.5 }, mb: 2 }}>
            <Typography variant="h5" sx={{ mb: 1.5 }}>
              Fabricação
            </Typography>
            {data.production.map((order) => (
              <Box key={order.title} sx={{ mb: 2, '&:last-child': { mb: 0 } }}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {order.title}
                  </Typography>
                  <Typography variant="body2">{order.progress}%</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={order.progress} sx={{ height: 6, borderRadius: 3, mb: 1 }} />
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
                  {order.steps.map((s, i) => (
                    <Typography key={i} variant="caption" sx={{ px: 1, py: 0.25, borderRadius: 1, bgcolor: s.done ? colors.brandTint : colors.subtle, border: `1px solid ${colors.border}` }}>
                      {s.done ? '✓ ' : ''}
                      {s.name}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            ))}
          </Box>
        ) : null}

        {data.visits.length ? (
          <Box sx={{ bgcolor: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, p: { xs: 2.5, sm: 3.5 }, mb: 2 }}>
            <Typography variant="h5" sx={{ mb: 1.5 }}>
              Agenda
            </Typography>
            {data.visits.map((v, i) => (
              <Stack key={i} direction="row" justifyContent="space-between" sx={{ py: 0.75, borderBottom: `1px solid ${colors.border}`, '&:last-child': { borderBottom: 0 } }}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {v.kind}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {fmtDate(v.date)}
                  {v.time ? ` às ${v.time}` : ''} · {v.status}
                </Typography>
              </Stack>
            ))}
          </Box>
        ) : null}

        <Box component="form" onSubmit={submit} sx={{ bgcolor: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, p: { xs: 2.5, sm: 3.5 }, mb: 2 }}>
          <Typography variant="h5" sx={{ mb: 0.5 }}>
            Precisa de ajuda?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Conte o que aconteceu e a equipe recebe o seu pedido.
          </Typography>
          {sent !== null ? (
            <Alert severity="success">Pedido enviado{sent ? ` (${sent})` : ''}. A marcenaria entrará em contato.</Alert>
          ) : (
            <Stack spacing={1.5}>
              <TextField label="Seu nome" size="small" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} />
              <TextField label="Telefone ou e-mail para retorno" size="small" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} slotProps={{ htmlInput: { maxLength: 80 } }} />
              <TextField label="O que aconteceu?" size="small" multiline minRows={3} required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} slotProps={{ htmlInput: { maxLength: 1500 } }} />
              {formError ? <Alert severity="error">{formError}</Alert> : null}
              <Box>
                <Button type="submit" variant="contained" disabled={busy || form.message.trim().length < 5}>
                  {busy ? 'Enviando…' : 'Enviar pedido'}
                </Button>
              </Box>
            </Stack>
          )}
        </Box>

        <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" sx={{ flexWrap: 'wrap', rowGap: 1, px: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {[company.phone, company.email].filter(Boolean).join(' · ')}
          </Typography>
          {whatsapp ? (
            <Button size="small" variant="outlined" href={whatsapp} target="_blank" rel="noopener noreferrer">
              Falar no WhatsApp
            </Button>
          ) : null}
        </Stack>
        <Box sx={{ mt: 3, display: 'flex', justifyContent: 'center', opacity: 0.6 }}>
          <Logo height={16} />
        </Box>
      </Box>
    </Box>
  )
}
