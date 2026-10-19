import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from '@mui/material'
import { Stack } from './Stack'
import { PhotoUpload } from './PhotoUpload'
import { useToast } from './feedback'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { refreshCollection } from '../lib/store'
import { maskPhone } from '../lib/format'

export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useAuth()
  const toast = useToast()
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [photo, setPhoto] = useState<string | null>(user?.photoFileId ?? null)
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const save = async () => {
    setBusy(true)
    try {
      await api.put('/auth/profile', { name: name.trim() || user.name, phone, photoFileId: photo })
      await Promise.all([refresh(), refreshCollection('users')])
      toast.success('Perfil atualizado.')
      onClose()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Meu perfil</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 0.5 }}>
          <PhotoUpload user={{ id: user.id, name, color: user.color }} photoFileId={photo} onChange={setPhoto} />
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Telefone" value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} />
          <TextField label="E-mail" value={user.email} disabled />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={save} disabled={busy}>
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
