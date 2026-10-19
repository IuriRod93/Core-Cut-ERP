import { useState, type FormEvent, type ReactNode } from 'react'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Link, TextField, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { api } from '../lib/api'
import { colors } from '../theme'

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3, bgcolor: colors.subtle }}>
      <Box sx={{ width: '100%', maxWidth: 420, bgcolor: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, p: { xs: 3, sm: 4 } }}>
        <Box sx={{ mb: 3 }}>
          <Logo height={22} />
        </Box>
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {subtitle}
        </Typography>
        {children}
      </Box>
    </Box>
  )
}

/** "Esqueci minha senha": pede o e-mail e envia o link de redefinição. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.post('/auth/forgot-password', { email: email.trim() })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível enviar o e-mail agora.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Esqueci minha senha" subtitle="Informe o e-mail da sua conta e enviaremos um link para criar uma nova senha.">
      {sent ? (
        <Stack spacing={2}>
          <Alert severity="success">Se o e-mail estiver cadastrado, o link foi enviado e vale por 30 minutos. Confira também a caixa de spam.</Alert>
          <Button component={RouterLink} to="/login" variant="contained">
            Voltar para o login
          </Button>
        </Stack>
      ) : (
        <Box component="form" onSubmit={submit}>
          <Stack spacing={2}>
            {error ? <Alert severity="error">{error}</Alert> : null}
            <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
            <Button type="submit" variant="contained" size="large" disabled={busy || !email.includes('@')}>
              {busy ? 'Enviando…' : 'Enviar link'}
            </Button>
            <Link component={RouterLink} to="/login" variant="body2" sx={{ textAlign: 'center' }}>
              Voltar para o login
            </Link>
          </Stack>
        </Box>
      )}
    </Card>
  )
}

/** Página aberta pelo link do e-mail: define a nova senha. */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mismatch = confirm.length > 0 && confirm !== password
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.post('/auth/reset-password', { token, newPassword: password })
      navigate('/login', { replace: true, state: { notice: 'Senha alterada. Entre com a nova senha.' } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.')
    } finally {
      setBusy(false)
    }
  }

  if (!token) {
    return (
      <Card title="Link inválido" subtitle="Este endereço de redefinição está incompleto.">
        <Button component={RouterLink} to="/esqueci-senha" variant="contained" fullWidth>
          Pedir um novo link
        </Button>
      </Card>
    )
  }
  return (
    <Card title="Criar nova senha" subtitle="Escolha uma senha com pelo menos 8 caracteres.">
      <Box component="form" onSubmit={submit}>
        <Stack spacing={2}>
          {error ? (
            <Alert severity="error" action={<Button color="inherit" size="small" component={RouterLink} to="/esqueci-senha">Novo link</Button>}>
              {error}
            </Alert>
          ) : null}
          <TextField label="Nova senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required />
          <TextField
            label="Repita a nova senha"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            required
            error={mismatch}
            helperText={mismatch ? 'As senhas não conferem.' : undefined}
          />
          <Button type="submit" variant="contained" size="large" disabled={busy || password.length < 8 || password !== confirm}>
            {busy ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
        </Stack>
      </Box>
    </Card>
  )
}
