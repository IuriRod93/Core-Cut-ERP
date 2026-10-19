import { useRef, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { Stack } from './Stack'
import { DeleteIcon, ImageIcon, UploadFileIcon } from './icons'
import { useToast } from './feedback'
import { api, fileUrl } from '../lib/api'
import { refreshCollection } from '../lib/store'
import { resizeToMax } from '../lib/image'
import { colors } from '../theme'
import type { FileDoc } from '../types'

/** Foto de um registro (material, produto…): escolher da galeria ou tirar na hora pelo celular. */
export function PhotoField({
  value,
  onChange,
  label = 'Foto',
  fallbackUrl,
  folder = 'Fotos',
  refType = 'photo',
}: {
  value?: string | null
  onChange: (fileId: string | null) => void
  label?: string
  /** imagem exibida quando não há foto enviada (ex.: imagem do catálogo) */
  fallbackUrl?: string | null
  folder?: string
  refType?: string
}) {
  const toast = useToast()
  const gallery = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const shown = value ? fileUrl(value, { inline: true }) : fallbackUrl || null

  const pick = async (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Escolha um arquivo de imagem (JPG, PNG ou WebP).')
    setBusy(true)
    try {
      const small = await resizeToMax(file)
      const qs = new URLSearchParams({ name: `${label.toLowerCase()}.jpg`, folder, refType, visibility: 'compartilhado' })
      const meta = await api.upload<FileDoc>(`/files/upload?${qs}`, small)
      onChange(meta.id)
      void refreshCollection('files')
      toast.success('Foto enviada. Salve para confirmar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar a foto.')
    } finally {
      setBusy(false)
      if (gallery.current) gallery.current.value = ''
      if (camera.current) camera.current.value = ''
    }
  }

  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Box sx={{ width: 96, height: 96, borderRadius: 2, border: `1px solid ${colors.border}`, bgcolor: colors.subtle, display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
        {shown ? <Box component="img" src={shown} alt={label} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon sx={{ color: colors.textMuted, fontSize: 34 }} />}
      </Box>
      <Box>
        <Typography variant="overline" color="primary" sx={{ display: 'block' }}>
          {label}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <Button size="small" variant="outlined" startIcon={<UploadFileIcon />} disabled={busy} onClick={() => gallery.current?.click()}>
            {busy ? 'Enviando…' : value ? 'Trocar foto' : 'Enviar foto'}
          </Button>
          <Button size="small" variant="text" disabled={busy} onClick={() => camera.current?.click()}>
            Tirar foto
          </Button>
          {value ? (
            <Button size="small" color="inherit" startIcon={<DeleteIcon />} onClick={() => onChange(null)}>
              Remover
            </Button>
          ) : null}
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          JPG, PNG ou WebP. A imagem é reduzida automaticamente.
        </Typography>
        <input ref={gallery} type="file" accept="image/*" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </Box>
    </Stack>
  )
}
