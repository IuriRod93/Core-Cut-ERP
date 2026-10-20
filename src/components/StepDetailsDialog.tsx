import { useEffect, useMemo, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, Tab, Tabs, TextField, Typography } from '@mui/material'
import { Stack } from './Stack'
import { EmptyState, LoadingState } from './ui'
import { ArticleIcon } from './icons'
import { api, fileUrl } from '../lib/api'
import { useCollections } from '../lib/store'
import type { CutPiece, CutPlan, FileDoc, OpOperation, ProductionOrder } from '../types'

const MAX_ROWS = 300

const edges = (p: CutPiece) =>
  [p.edgeTop && 'sup', p.edgeBottom && 'inf', p.edgeLeft && 'esq', p.edgeRight && 'dir'].filter(Boolean).join(' · ') || '—'

/**
 * O que o operador precisa para fazer a etapa sem papel: peças dos planos de corte da ordem (medidas,
 * material, fitas e usinagens), desenhos e arquivos do projeto e as observações da ordem.
 */
export function StepDetailsDialog({ order, op, planIds, onClose }: { order: ProductionOrder; op: OpOperation; planIds: string[]; onClose: () => void }) {
  const [tab, setTab] = useState<'pieces' | 'files' | 'notes'>('pieces')
  const [plans, setPlans] = useState<CutPlan[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const { data, maps } = useCollections(['files', 'materials'] as const)

  useEffect(() => {
    let alive = true
    setPlans(null)
    setError(null)
    Promise.all(planIds.map((id) => api.get<CutPlan>(`/data/cutPlans/${id}`)))
      .then((list) => alive && setPlans(list))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [planIds.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const pieces = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = (plans ?? []).flatMap((plan) => (plan.pieces ?? []).map((piece) => ({ plan, piece })))
    return q ? rows.filter(({ piece }) => [piece.label, piece.module, piece.environment, piece.sourceMaterial].some((v) => v?.toLowerCase().includes(q))) : rows
  }, [plans, search])

  const files = useMemo(() => data.files.filter((f: FileDoc) => order.projectId && f.projectId === order.projectId).sort((a, b) => a.name.localeCompare(b.name)), [data.files, order.projectId])
  const notes = [order.notes, ...order.items.filter((i) => i.notes).map((i) => `${i.name}: ${i.notes}`)].filter(Boolean)
  const material = (p: CutPiece) => (p.materialId ? maps.materials.get(p.materialId)?.name : undefined) ?? p.sourceMaterial ?? '—'

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {order.code} · {op.name}
        <Typography variant="body2" color="text.secondary">
          {order.title}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab value="pieces" label={`Peças${plans ? ` (${pieces.length})` : ''}`} />
          <Tab value="files" label={`Arquivos (${files.length})`} />
          <Tab value="notes" label="Observações" />
        </Tabs>

        {tab === 'pieces' ? (
          error ? (
            <Typography color="error">{error}</Typography>
          ) : !planIds.length ? (
            <EmptyState title="Sem plano de corte" description="Esta ordem ainda não tem plano de corte vinculado." />
          ) : !plans ? (
            <LoadingState label="Carregando peças…" />
          ) : (
            <Box>
              <TextField size="small" fullWidth label="Buscar peça, módulo ou material" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ mb: 1.5 }} />
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', '& th, & td': { textAlign: 'left', p: 0.75, borderBottom: '1px solid', borderColor: 'divider' }, '& td.n': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }}>
                <thead>
                  <tr>
                    <th>Peça</th>
                    <th>Módulo</th>
                    <th>C × L (mm)</th>
                    <th>Qtd</th>
                    <th>Material</th>
                    <th>Fitas</th>
                    <th>Usinagens</th>
                  </tr>
                </thead>
                <tbody>
                  {pieces.slice(0, MAX_ROWS).map(({ plan, piece }) => (
                    <tr key={plan.id + piece.id}>
                      <td>{piece.label}</td>
                      <td>{piece.module || piece.environment || '—'}</td>
                      <td className="n">
                        {piece.length} × {piece.width}
                      </td>
                      <td className="n">{piece.quantity}</td>
                      <td>{material(piece)}</td>
                      <td>{edges(piece)}</td>
                      <td className="n">{piece.machining?.length || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </Box>
              {pieces.length > MAX_ROWS ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Mostrando {MAX_ROWS} de {pieces.length}. Use a busca para achar a peça.
                </Typography>
              ) : null}
            </Box>
          )
        ) : null}

        {tab === 'files' ? (
          files.length ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
              {files.map((f) => (
                <Link key={f.id} href={fileUrl(f.id, { inline: true })} target="_blank" rel="noopener" underline="none" sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden', color: 'text.primary' }}>
                  {f.mime.startsWith('image/') ? (
                    <Box component="img" src={fileUrl(f.id, { inline: true })} alt={f.name} loading="lazy" sx={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <Stack alignItems="center" justifyContent="center" sx={{ aspectRatio: '4 / 3', bgcolor: 'action.hover' }}>
                      <ArticleIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
                    </Stack>
                  )}
                  <Typography variant="caption" noWrap sx={{ display: 'block', p: 1 }}>
                    {f.name}
                  </Typography>
                </Link>
              ))}
            </Box>
          ) : (
            <EmptyState title="Nenhum arquivo no projeto" description="Desenhos, fotos e PDFs anexados ao projeto aparecem aqui." />
          )
        ) : null}

        {tab === 'notes' ? (
          notes.length ? (
            <Stack spacing={1}>
              {notes.map((n, i) => (
                <Typography key={i} variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>
                  {n}
                </Typography>
              ))}
            </Stack>
          ) : (
            <Typography color="text.secondary">Sem observações nesta ordem.</Typography>
          )
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}
