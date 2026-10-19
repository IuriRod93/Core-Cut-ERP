import { useMemo, useRef, useState } from 'react'
import { Box, Button, IconButton, MenuItem, Paper, TextField, Tooltip, Typography, alpha } from '@mui/material'
import { Stack } from './Stack'
import { DeleteIcon, DownloadIcon, ImageIcon, PictureAsPdfIcon, AttachFileIcon, UploadFileIcon, VisibilityIcon, DescriptionIcon } from './icons'
import { DataTable, EmptyState, LoadingState, SearchField, StatusChip, type Column } from './ui'
import { useConfirm, useToast } from './feedback'
import { api, fileUrl } from '../lib/api'
import { refreshCollection, removeDoc, useCollection } from '../lib/store'
import { FILE_VISIBILITY } from '../domain/constants'
import { fmtDateTime, matches } from '../lib/format'
import { colors } from '../theme'
import type { FileDoc } from '../types'

const fmtSize = (n: number) => (n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const iconFor = (mime: string) =>
  mime.startsWith('image/') ? <ImageIcon fontSize="small" /> : mime === 'application/pdf' ? <PictureAsPdfIcon fontSize="small" /> : mime.includes('sheet') || mime.includes('word') ? <DescriptionIcon fontSize="small" /> : <AttachFileIcon fontSize="small" />

export function FileBrowser({ projectId, clientId, showFolders = true }: { projectId?: string; clientId?: string; showFolders?: boolean }) {
  const files = useCollection('files')
  const toast = useToast()
  const confirm = useConfirm()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [folder, setFolder] = useState('')
  const [visibility, setVisibility] = useState<FileDoc['visibility']>('interno')
  const [uploadFolder, setUploadFolder] = useState('Geral')
  const [drag, setDrag] = useState(false)

  const scoped = useMemo(
    () => files.items.filter((f) => (projectId ? f.projectId === projectId : clientId ? f.clientId === clientId : true) && f.refType !== 'task' && f.refType !== 'avatar'),
    [files.items, projectId, clientId],
  )
  const folders = useMemo(() => [...new Set(scoped.map((f) => f.folder))].sort(), [scoped])
  const rows = scoped.filter((f) => (!folder || f.folder === folder) && matches([f.name, f.folder, f.uploadedByName], query))

  const upload = async (list: FileList | File[] | null) => {
    const arr = list ? Array.from(list) : []
    if (!arr.length) return
    setBusy(true)
    try {
      for (const file of arr) {
        const qs = new URLSearchParams({ name: file.name, folder: uploadFolder || 'Geral', visibility })
        if (projectId) qs.set('projectId', projectId)
        if (clientId) qs.set('clientId', clientId)
        await api.upload(`/files/upload?${qs}`, file)
      }
      await refreshCollection('files')
      toast.success(arr.length === 1 ? 'Arquivo enviado.' : `${arr.length} arquivos enviados.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no envio.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  const columns: Column<FileDoc>[] = [
    {
      key: 'name',
      header: 'Arquivo',
      sort: (f) => f.name,
      render: (f) => (
        <Stack direction="row" spacing={1.25} alignItems="center">
          <Box sx={{ color: colors.brand, display: 'grid' }}>{iconFor(f.mime)}</Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {f.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {f.folder} · {fmtSize(f.size)}
            </Typography>
          </Box>
        </Stack>
      ),
    },
    { key: 'visibility', header: 'Acesso', hideBelow: 'md', render: (f) => <StatusChip options={FILE_VISIBILITY.map((v) => ({ ...v, color: v.value === 'financeiro' ? '#c23b3b' : v.value === 'compartilhado' ? '#2f6f9f' : '#7d838c' }))} value={f.visibility} /> },
    { key: 'by', header: 'Enviado por', hideBelow: 'lg', sort: (f) => f.uploadedByName, render: (f) => f.uploadedByName },
    { key: 'at', header: 'Data', hideBelow: 'sm', sort: (f) => f.createdAt, render: (f) => fmtDateTime(f.createdAt) },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 130,
      render: (f) => (
        <Stack direction="row" spacing={0} justifyContent="flex-end">
          {(f.mime.startsWith('image/') || f.mime === 'application/pdf') && (
            <Tooltip title="Visualizar">
              <IconButton size="small" component="a" href={fileUrl(f.id, { inline: true })} target="_blank" rel="noreferrer" aria-label="Visualizar">
                <VisibilityIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Baixar">
            <IconButton size="small" component="a" href={fileUrl(f.id)} aria-label="Baixar">
              <DownloadIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Excluir">
            <IconButton
              size="small"
              aria-label="Excluir"
              onClick={async () => {
                if (await confirm({ title: 'Excluir arquivo?', message: f.name, confirmLabel: 'Excluir', danger: true })) await removeDoc('files', f.id)
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ]

  return (
    <Paper
      variant="outlined"
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        void upload(e.dataTransfer.files)
      }}
      sx={{ borderRadius: 3, overflow: 'hidden', outline: drag ? `2px dashed ${colors.brand}` : 'none', bgcolor: drag ? alpha(colors.brand, 0.03) : '#fff' }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar arquivos…" />
        {showFolders ? (
          <TextField select label="Pasta" value={folder} onChange={(e) => setFolder(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 180 } }}>
            <MenuItem value="">Todas</MenuItem>
            {folders.map((f) => (
              <MenuItem key={f} value={f}>
                {f}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <TextField label="Enviar para pasta" value={uploadFolder} onChange={(e) => setUploadFolder(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }} />
        <TextField select label="Acesso" value={visibility} onChange={(e) => setVisibility(e.target.value as FileDoc['visibility'])} sx={{ width: { xs: 'calc(50% - 6px)', sm: 190 } }}>
          {FILE_VISIBILITY.map((v) => (
            <MenuItem key={v.value} value={v.value}>
              {v.label}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" startIcon={<UploadFileIcon />} onClick={() => input.current?.click()} disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar arquivos'}
        </Button>
        <input ref={input} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      </Stack>
      {files.loading ? (
        <LoadingState />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UploadFileIcon />}
          title={scoped.length ? 'Nenhum arquivo encontrado' : 'Nenhum arquivo enviado'}
          description="Arraste arquivos para esta área ou use o botão para enviar desenhos, listas de corte, contratos e fotos."
        />
      ) : (
        <DataTable rows={rows} columns={columns} rowKey={(f) => f.id} initialSort={{ key: 'at', dir: 'desc' }} />
      )}
    </Paper>
  )
}
