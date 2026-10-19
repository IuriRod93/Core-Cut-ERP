import { useEffect, useState } from 'react'
import { Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from '@mui/material'
import { Stack } from './Stack'
import { ImageIcon, StorefrontIcon } from './icons'
import { LoadingState, SearchField } from './ui'
import { RelationSelect } from './forms'
import { useToast } from './feedback'
import { api } from '../lib/api'
import { refreshCollection } from '../lib/store'
import { brl } from '../lib/format'
import { colors } from '../theme'
import type { Material, MaterialCategory } from '../types'

interface CatalogItem {
  id: string
  kind: 'chapa' | 'ferragem' | 'fita'
  code: string
  name: string
  brand: string | null
  thickness: number | null
  width: number | null
  height: number | null
  unit: string
  price: number | null
  pricePerM2: number | null
  image: string | null
}

const KIND_OF: Record<string, 'chapa' | 'ferragem' | 'fita'> = { chapa: 'chapa', fita_borda: 'fita', ferragem: 'ferragem' }

/** Seleciona um material do estoque ou o importa direto do catálogo Leo Madeiras (preço em R$). */
export function MaterialPicker({
  label,
  value,
  onChange,
  category,
  placeholder,
  size = 'small',
}: {
  label?: string
  value?: string | null
  onChange: (id: string | null, material?: Material) => void
  category: MaterialCategory
  placeholder?: string
  size?: 'small' | 'medium'
}) {
  const [open, setOpen] = useState(false)
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <RelationSelect
          collection="materials"
          label={label}
          value={value}
          size={size}
          placeholder={placeholder}
          filter={(m) => m.category === category && m.active !== false}
          onChange={(id) => onChange(id)}
        />
      </Box>
      <Tooltip title="Buscar no catálogo Leo Madeiras">
        <IconButton onClick={() => setOpen(true)} aria-label="Buscar no catálogo Leo Madeiras" sx={{ border: `1px solid ${colors.borderStrong}`, borderRadius: 2 }}>
          <StorefrontIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {open ? (
        <CatalogDialog
          kind={KIND_OF[category] ?? 'chapa'}
          onClose={() => setOpen(false)}
          onPick={(m) => {
            setOpen(false)
            onChange(m.id, m)
          }}
        />
      ) : null}
    </Stack>
  )
}

function CatalogDialog({ kind, onClose, onPick }: { kind: 'chapa' | 'ferragem' | 'fita'; onClose: () => void; onPick: (m: Material) => void }) {
  const toast = useToast()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<CatalogItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [busy, setBusy] = useState('')

  useEffect(() => {
    setItems(null)
    const t = window.setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ kind, q, priced: '1', pageSize: '30', sort: 'name' })
        const res = await api.get<{ items: CatalogItem[]; total: number }>(`/catalog/leo?${qs}`)
        setItems(res.items)
        setTotal(res.total)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Falha ao consultar o catálogo.')
        setItems([])
      }
    }, 220)
    return () => window.clearTimeout(t)
  }, [q, kind, toast])

  const pick = async (item: CatalogItem) => {
    setBusy(item.id)
    try {
      const res = await api.post<{ materials: Material[] }>('/catalog/leo/import', { ids: [item.id] })
      await refreshCollection('materials')
      if (res.materials[0]) onPick(res.materials[0])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao importar.')
    } finally {
      setBusy('')
    }
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Catálogo Leo Madeiras — {kind === 'chapa' ? 'chapas' : kind === 'fita' ? 'fitas de borda' : 'ferragens'}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 1.5 }}>
          <SearchField value={q} onChange={setQ} placeholder="Nome, cor, espessura ou código…" width="100%" autoFocus />
        </Box>
        {items === null ? (
          <LoadingState />
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            Nenhum item com preço encontrado.
          </Typography>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              {total.toLocaleString('pt-BR')} itens com preço — mostrando os primeiros {items.length}. O item escolhido é adicionado ao estoque automaticamente.
            </Typography>
            {items.map((it) => (
              <Stack
                key={it.id}
                direction="row"
                spacing={1.5}
                alignItems="center"
                onClick={() => !busy && pick(it)}
                sx={{ p: 1, borderRadius: 2, cursor: 'pointer', opacity: busy && busy !== it.id ? 0.5 : 1, '&:hover': { bgcolor: colors.brandTint } }}
              >
                <Avatar variant="rounded" src={it.image ?? undefined} sx={{ width: 48, height: 48, bgcolor: colors.subtle, border: `1px solid ${colors.border}` }}>
                  <ImageIcon fontSize="small" />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                    {it.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {it.code}
                    {it.brand ? ` · ${it.brand}` : ''}
                    {it.kind === 'chapa' && it.width ? ` · ${it.width}×${it.height} mm` : ''}
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: colors.brand }}>
                    {it.price !== null ? brl(it.price) : '—'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    / {it.unit}
                  </Typography>
                </Box>
                {busy === it.id ? <Chip size="small" label="Adicionando…" /> : null}
              </Stack>
            ))}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}
