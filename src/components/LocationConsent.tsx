import { useEffect, useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { Stack } from './Stack'
import { useAuth } from '../auth/AuthContext'
import { geoPermission, getPosition } from '../lib/geo'

const WEEK = 7 * 24 * 3_600_000

/**
 * Pede a localização do aparelho ao entrar no sistema, explicando para que ela serve.
 * O navegador só mostra o aviso próprio depois que a pessoa aceita aqui; se ela recusar, o sistema
 * continua funcionando (o ponto é registrado sem local) e a pergunta volta em uma semana.
 */
export function LocationConsent() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const key = user ? `core-cut-erp.geo-asked.${user.id}` : ''

  useEffect(() => {
    if (!user || !key) return
    let alive = true
    void (async () => {
      const state = await geoPermission()
      if (!alive || state !== 'prompt') return
      let asked = 0
      try {
        asked = Number(localStorage.getItem(key) ?? 0)
      } catch {
        /* sem armazenamento: pergunta nesta visita */
      }
      if (Date.now() - asked > WEEK) setOpen(true)
    })()
    return () => {
      alive = false
    }
  }, [user, key])

  const remember = () => {
    try {
      localStorage.setItem(key, String(Date.now()))
    } catch {
      /* ignora */
    }
  }

  const allow = async () => {
    remember()
    setOpen(false)
    await getPosition(8000) // dispara o aviso de permissão do navegador
  }

  return (
    <Dialog open={open} onClose={() => { remember(); setOpen(false) }} maxWidth="xs" fullWidth>
      <DialogTitle>Permitir a sua localização?</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Typography variant="body2">O Core Cut usa a localização do seu aparelho apenas para:</Typography>
          <Typography variant="body2" component="div">
            • mostrar <strong>onde você estava ao bater o ponto</strong>;<br />• acompanhar a <strong>rota das entregas e instalações</strong> que você iniciar.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Não acompanhamos você o tempo todo: a posição só é lida quando você registra o ponto ou liga a rota de uma entrega. Você pode mudar isso a qualquer momento nas permissões do navegador.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button color="inherit" onClick={() => { remember(); setOpen(false) }}>
          Agora não
        </Button>
        <Button variant="contained" onClick={() => void allow()}>
          Permitir
        </Button>
      </DialogActions>
    </Dialog>
  )
}
