import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Paper,
  TextField,
  Typography,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { useAuth } from '../auth/AuthContext'
import { useToast } from '../components/feedback'
import { colors } from '../theme'

export function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const forced = Boolean(user?.passwordMustChange)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (next.length < 8) return setError('A nova senha deve ter ao menos 8 caracteres.')
    if (!/[A-Za-z]/.test(next) || !/\d/.test(next)) return setError('Use letras e números na nova senha.')
    if (next !== confirm) return setError('A confirmação não confere com a nova senha.')
    setBusy(true)
    try {
      await changePassword(current, next)
      toast.success('Senha alterada com sucesso.')
      const from = (location.state as { from?: unknown } | null)?.from
      navigate(typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/alterar-senha' ? from : '/painel', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: forced ? '100vh' : 'auto', display: 'grid', placeItems: forced ? 'center' : 'start', p: forced ? 3 : 0, bgcolor: forced ? colors.bg : undefined }}>
      <Paper variant="outlined" component="form" onSubmit={submit} sx={{ p: 4, width: '100%', maxWidth: 440, borderRadius: 3 }}>
        {forced ? (
          <Box sx={{ mb: 3 }}>
            <Logo height={20} />
          </Box>
        ) : null}
        <Typography variant="h4" sx={{ mb: 0.5 }}>
          {forced ? 'Defina sua senha' : 'Alterar senha'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {forced ? 'Por segurança, troque a senha provisória antes de usar o sistema.' : 'Informe a senha atual e escolha uma nova.'}
        </Typography>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Stack spacing={2}>
          <TextField label="Senha atual" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required autoFocus />
          <TextField label="Nova senha" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required helperText="Mínimo de 8 caracteres, com letras e números." />
          <TextField label="Confirmar nova senha" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {forced ? (
              <Button color="inherit" onClick={() => logout().then(() => navigate('/login'))}>
                Sair
              </Button>
            ) : null}
            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? 'Salvando…' : 'Salvar nova senha'}
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  )
}
