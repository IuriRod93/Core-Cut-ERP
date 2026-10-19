import { useMemo, useState } from 'react'
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, TextField, Typography } from '@mui/material'
import { Stack } from './Stack'
import { ContentCopyIcon, EmailIcon, SendIcon } from './icons'
import { useToast } from './feedback'
import { api } from '../lib/api'
import { refreshCollection } from '../lib/store'
import { fmtDate } from '../lib/format'
import type { Client, Project, StageDef } from '../types'

const digits = (value?: string) => (value ?? '').replace(/\D/g, '')

/**
 * Avisos ao cliente: gera o link do portal (andamento sem valores) e envia uma mensagem pronta por e-mail
 * ou WhatsApp. A mensagem já vem escrita com a etapa e a previsão de entrega, para ajustar e enviar.
 */
export function ClientUpdateDialog({
  open,
  onClose,
  project,
  client,
  stage,
  companyName,
}: {
  open: boolean
  onClose: () => void
  project: Project
  client?: Client
  stage?: StageDef
  companyName?: string
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const enabled = project.portalEnabled !== false && Boolean(project.portalToken)
  const link = url ?? (enabled ? `${window.location.origin}/acompanhar/${project.portalToken}` : null)

  const firstName = (client?.name ?? '').trim().split(/\s+/)[0] || 'tudo bem'
  const draft = useMemo(
    () =>
      [
        `Olá, ${firstName}! Aqui é da ${companyName || 'marcenaria'}.`,
        `Seu projeto "${project.name}" está na etapa: ${stage?.label ?? 'em andamento'}.`,
        project.dueDate ? `A previsão de entrega é ${fmtDate(project.dueDate)}.` : '',
        link ? `Você pode acompanhar tudo por aqui: ${link}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    [firstName, companyName, project.name, project.dueDate, stage?.label, link],
  )
  const [message, setMessage] = useState('')
  const text = message || draft

  const enable = async (regenerate = false) => {
    setBusy(true)
    try {
      const r = await api.post<{ url: string }>(`/projects/${project.id}/portal`, { regenerate })
      setUrl(r.url)
      setMessage('')
      await refreshCollection('projects')
      toast.success(regenerate ? 'Novo link gerado. O anterior deixou de funcionar.' : 'Link do cliente ativado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar o link.')
    } finally {
      setBusy(false)
    }
  }
  const revoke = async () => {
    setBusy(true)
    try {
      await api.del(`/projects/${project.id}/portal`)
      setUrl(null)
      setMessage('')
      await refreshCollection('projects')
      toast.success('Link desativado: o cliente não consegue mais abrir.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível desativar o link.')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      toast.success('Link copiado.')
    } catch {
      toast.info(link)
    }
  }
  const sendEmail = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ to: string }>(`/projects/${project.id}/notify-client`, { message: text })
      toast.success(`E-mail enviado para ${r.to}.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar o e-mail.')
    } finally {
      setBusy(false)
    }
  }
  const phone = digits(client?.phone)
  const whatsapp = `https://wa.me/${phone ? (phone.startsWith('55') ? phone : `55${phone}`) : ''}?text=${encodeURIComponent(text)}`

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Atualizar o cliente</DialogTitle>
      <DialogContent>
        <Typography variant="overline" color="primary">
          Link de acompanhamento
        </Typography>
        {link ? (
          <Stack spacing={1} sx={{ mb: 2 }}>
            <TextField size="small" value={link} slotProps={{ input: { readOnly: true } }} fullWidth />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Button size="small" startIcon={<ContentCopyIcon />} onClick={copy}>
                Copiar
              </Button>
              <Button size="small" color="inherit" onClick={() => enable(true)} disabled={busy}>
                Gerar novo link
              </Button>
              <Button size="small" color="error" onClick={revoke} disabled={busy}>
                Desativar
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              O cliente vê a etapa, a fabricação e a agenda. Não aparece valor, custo nem nome de funcionário.
            </Typography>
          </Stack>
        ) : (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Crie um link para o cliente acompanhar o projeto sem precisar de senha.
            </Typography>
            <Button variant="outlined" onClick={() => enable(false)} disabled={busy}>
              Ativar link do cliente
            </Button>
          </Box>
        )}

        <Divider sx={{ mb: 2 }} />
        <Typography variant="overline" color="primary">
          Mensagem
        </Typography>
        <TextField multiline minRows={5} fullWidth value={text} onChange={(e) => setMessage(e.target.value)} sx={{ mt: 0.5 }} />
        {!client?.email && !phone ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            Este cliente não tem e-mail nem telefone cadastrados. Complete o cadastro em Clientes.
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button color="inherit" onClick={onClose}>
          Fechar
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" startIcon={<EmailIcon />} onClick={sendEmail} disabled={busy || !client?.email}>
          Enviar por e-mail
        </Button>
        <Button variant="contained" startIcon={<SendIcon />} href={whatsapp} target="_blank" rel="noopener noreferrer" disabled={!phone}>
          Abrir WhatsApp
        </Button>
      </DialogActions>
    </Dialog>
  )
}
