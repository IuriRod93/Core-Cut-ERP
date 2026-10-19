import { useRef, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { Stack } from './Stack'
import { UserAvatar } from './ui'
import { UploadFileIcon, DeleteIcon } from './icons'
import { useToast } from './feedback'
import { api } from '../lib/api'
import { refreshCollection } from '../lib/store'
import { resizeToAvatar } from '../lib/image'
import type { FileDoc } from '../types'

/** Envia e recorta a foto de perfil; devolve o id do arquivo pelo `onChange`. */
export function PhotoUpload({
  user,
  photoFileId,
  onChange,
}: {
  user: { id: string; name: string; color?: string | null }
  photoFileId?: string | null
  onChange: (fileId: string | null) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const pick = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Escolha um arquivo de imagem (JPG, PNG ou WebP).')
    setBusy(true)
    try {
      const small = await resizeToAvatar(file)
      const qs = new URLSearchParams({ name: `foto-${user.name}.jpg`, folder: 'Fotos da equipe', refType: 'avatar', refId: user.id, visibility: 'compartilhado' })
      const meta = await api.upload<FileDoc>(`/files/upload?${qs}`, small)
      onChange(meta.id)
      void refreshCollection('files')
      toast.success('Foto atualizada. Salve para confirmar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar a foto.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <UserAvatar user={{ ...user, photoFileId: photoFileId ?? null }} size={72} />
      <Box>
        <Typography variant="overline" color="primary" sx={{ display: 'block' }}>
          Foto de perfil
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Aparece nos projetos, tarefas e quadros. A imagem é recortada em formato quadrado.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} onClick={() => input.current?.click()} disabled={busy}>
            {busy ? 'Enviando…' : photoFileId ? 'Trocar foto' : 'Enviar foto'}
          </Button>
          {photoFileId ? (
            <Button size="small" color="inherit" startIcon={<DeleteIcon />} onClick={() => onChange(null)}>
              Remover
            </Button>
          ) : null}
        </Stack>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </Box>
    </Stack>
  )
}
