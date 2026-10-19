import { useState } from 'react'
import { Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Tooltip, Typography } from '@mui/material'
import { Stack } from '../../components/Stack'
import { BookmarkAddIcon, BookmarkIcon } from '../../components/icons'
import { updateDoc } from '../../lib/store'
import { uid } from '../../lib/format'
import { colors } from '../../theme'
import { DEFAULT_FILTERS, useWorkspace } from './useWorkspace'
import type { SavedView } from '../../types'

/** Visões salvas do projeto: guarda a aba, os filtros e o agrupamento atuais com um nome. */
export function SavedViews({ view, onApply }: { view: string; onApply: (v: string) => void }) {
  const ws = useWorkspace()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const views = ws.project.savedViews ?? []

  const save = async () => {
    const n = name.trim()
    if (!n) return
    const f = ws.filters
    const entry: SavedView = {
      id: uid(),
      name: n,
      view,
      filters: { search: f.search, assignees: f.assignees, priorities: f.priorities, statuses: f.statuses, tags: f.tags, due: f.due, showDone: f.showDone, mine: f.mine, groupBy: f.groupBy },
    }
    await updateDoc('projects', ws.project.id, { savedViews: [...views, entry] })
    setNaming(false)
    setName('')
  }

  const apply = (v: SavedView) => {
    ws.setFilters({ ...DEFAULT_FILTERS, ...v.filters })
    onApply(v.view)
  }

  if (!views.length && !naming)
    return (
      <Stack direction="row" sx={{ mb: 1 }}>
        <Button size="small" startIcon={<BookmarkAddIcon />} onClick={() => setNaming(true)} sx={{ color: 'text.secondary' }}>
          Salvar visão atual
        </Button>
      </Stack>
    )

  return (
    <>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.75 }}>
        <BookmarkIcon sx={{ fontSize: 18, color: colors.textMuted }} />
        <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
          Visões salvas
        </Typography>
        {views.map((v) => (
          <Tooltip key={v.id} title="Aplicar visão">
            <Chip
              size="small"
              label={v.name}
              onClick={() => apply(v)}
              onDelete={() => updateDoc('projects', ws.project.id, { savedViews: views.filter((x) => x.id !== v.id) })}
              variant="outlined"
            />
          </Tooltip>
        ))}
        <Button size="small" startIcon={<BookmarkAddIcon />} onClick={() => setNaming(true)}>
          Salvar visão atual
        </Button>
      </Stack>
      <Dialog open={naming} onClose={() => setNaming(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Salvar visão</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Guarda a aba atual, os filtros e o agrupamento para voltar a eles com um clique — por exemplo “Minhas tarefas da semana” ou “Atrasadas da produção”.
          </Typography>
          <TextField autoFocus label="Nome da visão" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setNaming(false)}>
            Cancelar
          </Button>
          <Button variant="contained" disabled={!name.trim()} onClick={save}>
            Salvar
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
