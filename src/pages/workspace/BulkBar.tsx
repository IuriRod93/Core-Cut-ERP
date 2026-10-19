import { useState } from 'react'
import { Box, Button, Divider, IconButton, Menu, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { Stack } from '../../components/Stack'
import { CloseIcon, ContentCopyIcon, DeleteIcon } from '../../components/icons'
import { Dot } from '../../components/ui'
import { useConfirm } from '../../components/feedback'
import { TASK_PRIORITIES } from '../../domain/constants'
import { colors } from '../../theme'
import { useWorkspace } from './useWorkspace'
import type { Task } from '../../types'

/** Barra de ações em lote (aparece ao selecionar tarefas na lista): status, responsável, prioridade, entrega, lista, duplicar e excluir. */
export function BulkBar() {
  const ws = useWorkspace()
  const confirm = useConfirm()
  const [menu, setMenu] = useState<{ kind: 'status' | 'assign' | 'priority' | 'list'; el: HTMLElement } | null>(null)
  const n = ws.selected.length
  if (!n) return null

  const close = () => setMenu(null)
  const open = (kind: 'status' | 'assign' | 'priority' | 'list') => (e: React.MouseEvent<HTMLElement>) => setMenu({ kind, el: e.currentTarget })

  const assign = async (userId: string) => {
    close()
    for (const id of ws.selected) {
      const t = ws.tasks.find((x) => x.id === id)
      if (t && !(t.assigneeIds ?? []).includes(userId)) await ws.updateTask(id, { assigneeIds: [...(t.assigneeIds ?? []), userId] })
    }
  }

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: 'translateX(-50%)',
        zIndex: 1300,
        px: 2,
        py: 1,
        borderRadius: 3,
        border: `1px solid ${colors.borderStrong}`,
        maxWidth: 'calc(100vw - 32px)',
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        <Box sx={{ px: 1, py: 0.25, borderRadius: 2, bgcolor: colors.brand, color: '#fff', fontWeight: 700, fontSize: 13 }}>{n}</Box>
        <Typography variant="body2" sx={{ fontWeight: 600, mr: 0.5 }}>
          {n === 1 ? 'tarefa selecionada' : 'tarefas selecionadas'}
        </Typography>
        <Divider orientation="vertical" flexItem />
        <Button size="small" color="inherit" onClick={open('status')}>
          Status
        </Button>
        <Button size="small" color="inherit" onClick={open('assign')}>
          Responsável
        </Button>
        <Button size="small" color="inherit" onClick={open('priority')}>
          Prioridade
        </Button>
        <Button size="small" color="inherit" onClick={open('list')}>
          Lista
        </Button>
        <TextField
          type="date"
          label="Entrega"
          size="small"
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: { xs: 'calc(50% - 6px)', sm: 150 } }}
          onChange={(e) => e.target.value && void ws.bulkUpdate({ dueDate: e.target.value })}
        />
        <Divider orientation="vertical" flexItem />
        <Button size="small" color="inherit" startIcon={<ContentCopyIcon />} onClick={() => ws.bulkDuplicate()}>
          Duplicar
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={async () => {
            if (await confirm({ title: `Excluir ${n} tarefa(s)?`, message: 'As tarefas e suas subtarefas vão para a lixeira.', confirmLabel: 'Excluir', danger: true })) await ws.bulkDelete()
          }}
        >
          Excluir
        </Button>
        <IconButton size="small" onClick={ws.clearSelection} aria-label="Limpar seleção">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Menu anchorEl={menu?.el} open={menu?.kind === 'status'} onClose={close}>
        {ws.statuses.map((s) => (
          <MenuItem key={s.id} onClick={() => { close(); void ws.bulkUpdate({ status: s.id }) }}>
            <Dot color={s.color} />
            <Box component="span" sx={{ ml: 1 }}>{s.label}</Box>
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={menu?.el} open={menu?.kind === 'priority'} onClose={close}>
        {TASK_PRIORITIES.map((p) => (
          <MenuItem key={p.value} onClick={() => { close(); void ws.bulkUpdate({ priority: p.value as Task['priority'] }) }}>
            <Dot color={p.color ?? colors.textMuted} />
            <Box component="span" sx={{ ml: 1 }}>{p.label}</Box>
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={menu?.el} open={menu?.kind === 'list'} onClose={close}>
        {ws.lists.map((l) => (
          <MenuItem key={l.id} onClick={() => { close(); void ws.bulkUpdate({ listId: l.id }) }}>
            <Dot color={l.color ?? colors.textMuted} />
            <Box component="span" sx={{ ml: 1 }}>{l.name}</Box>
          </MenuItem>
        ))}
      </Menu>
      <Menu anchorEl={menu?.el} open={menu?.kind === 'assign'} onClose={close} slotProps={{ paper: { sx: { maxHeight: 320 } } }}>
        {ws.users.map((u) => (
          <MenuItem key={u.id} onClick={() => void assign(u.id)}>
            {u.name}
          </MenuItem>
        ))}
      </Menu>
    </Paper>
  )
}
