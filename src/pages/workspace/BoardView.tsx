import { useMemo, useState } from 'react'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Box, Button, Paper, TextField, Typography, alpha } from '@mui/material'
import { Stack } from '../../components/Stack'
import { AddIcon, CheckBoxIcon, KeyboardArrowDownIcon, KeyboardArrowRightIcon, SubdirectoryArrowRightIcon } from '../../components/icons'
import { Dot } from '../../components/ui'
import { AssigneePicker, DueChip, PriorityFlag, TagChips } from './shared'
import { useWorkspace } from './useWorkspace'
import { groupTasks, type TaskGroup } from './grouping'
import { isDoneStatus, orderBetween } from '../../domain/tasks'
import { colors } from '../../theme'
import type { Task } from '../../types'

function Card({ task }: { task: Task }) {
  const ws = useWorkspace()
  const subs = ws.tasks.filter((t) => t.parentId === task.id)
  const subsDone = subs.filter((s) => isDoneStatus(ws.statuses, s.status)).length
  const cl = (task.checklists ?? []).reduce((s, c) => s + c.items.length, 0)
  const clDone = (task.checklists ?? []).reduce((s, c) => s + c.items.filter((i) => i.done).length, 0)
  const list = ws.lists.find((l) => l.id === task.listId)
  const done = isDoneStatus(ws.statuses, task.status)
  return (
    <Paper
      variant="outlined"
      onClick={() => ws.openTask(task.id)}
      sx={{ p: 1.5, borderRadius: 2.5, cursor: 'pointer', bgcolor: '#fff', '&:hover': { borderColor: colors.brand } }}
    >
      {list ? (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mb: 0.25 }}>
          {list.name}
        </Typography>
      ) : null}
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1, textDecoration: done ? 'line-through' : 'none', color: done ? 'text.secondary' : 'text.primary' }}>
        {task.title}
      </Typography>
      <TagChips tags={task.tags} max={3} />
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
        <AssigneePicker task={task} size={22} />
        <DueChip task={task} onChange={(d) => ws.updateTask(task.id, { dueDate: d })} />
        <Box sx={{ flex: 1 }} />
        {subs.length ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            <SubdirectoryArrowRightIcon sx={{ fontSize: 14 }} />
            {subsDone}/{subs.length}
          </Typography>
        ) : null}
        {cl ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
            <CheckBoxIcon sx={{ fontSize: 14 }} />
            {clDone}/{cl}
          </Typography>
        ) : null}
        <PriorityFlag priority={task.priority} onChange={(p) => ws.updateTask(task.id, { priority: p as Task['priority'] })} />
      </Stack>
    </Paper>
  )
}

function Column({ group }: { group: TaskGroup }) {
  const ws = useWorkspace()
  const [adding, setAdding] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [title, setTitle] = useState('')
  const wip = ws.statuses.find((s) => s.id === group.id)?.wipLimit
  const overWip = Boolean(wip && group.tasks.length > wip)
  const add = async () => {
    const t = title.trim()
    if (t) await ws.createTask({ title: t, ...group.patch })
    setTitle('')
  }
  return (
    <Box sx={{ width: collapsed ? 64 : 296, flexShrink: 0, display: 'flex', flexDirection: 'column', maxHeight: '100%' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        onClick={() => setCollapsed((c) => !c)}
        sx={{ px: 1.25, py: 1, borderRadius: 2, bgcolor: overWip ? alpha('#c62828', 0.14) : alpha(group.color, 0.1), mb: 1, cursor: 'pointer', outline: overWip ? '1px solid #c62828' : 'none' }}
      >
        {collapsed ? <KeyboardArrowRightIcon sx={{ fontSize: 16 }} /> : <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />}
        <Dot color={group.color} size={10} />
        {collapsed ? null : (
          <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
            {group.label}
          </Typography>
        )}
        <Typography variant="caption" sx={{ fontWeight: 700, color: overWip ? '#c62828' : group.color }} title={wip ? `Limite de ${wip} tarefas` : undefined}>
          {group.tasks.length}
          {wip ? `/${wip}` : ''}
        </Typography>
      </Stack>
      {collapsed ? null : <Droppable droppableId={group.id} isDropDisabled={!group.droppable}>
        {(p, snap) => (
          <Box
            ref={p.innerRef}
            {...p.droppableProps}
            sx={{ flex: 1, minHeight: 60, overflowY: 'auto', p: 0.5, borderRadius: 2, bgcolor: snap.isDraggingOver ? alpha(colors.brand, 0.05) : 'transparent' }}
          >
            {group.tasks.map((t, i) => (
              <Draggable key={t.id} draggableId={t.id} index={i} isDragDisabled={!group.droppable}>
                {(dp, ds) => (
                  <Box ref={dp.innerRef} {...dp.draggableProps} {...dp.dragHandleProps} sx={{ mb: 1, opacity: ds.isDragging ? 0.92 : 1 }}>
                    <Card task={t} />
                  </Box>
                )}
              </Draggable>
            ))}
            {p.placeholder}
          </Box>
        )}
      </Droppable>}
      {group.droppable && !collapsed ? (
        adding ? (
          <TextField
            autoFocus
            placeholder="Nome da tarefa"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (!title.trim()) setAdding(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
              if (e.key === 'Escape') setAdding(false)
            }}
            sx={{ mt: 0.5 }}
          />
        ) : (
          <Button size="small" startIcon={<AddIcon />} onClick={() => setAdding(true)} sx={{ color: 'text.secondary', justifyContent: 'flex-start' }}>
            Adicionar tarefa
          </Button>
        )
      ) : null}
    </Box>
  )
}

export function BoardView() {
  const ws = useWorkspace()
  const groups = useMemo(
    () => groupTasks(ws.filtered, ws.filters.groupBy === 'none' ? 'status' : ws.filters.groupBy, { statuses: ws.statuses, lists: ws.lists, users: ws.users }),
    [ws.filtered, ws.filters.groupBy, ws.statuses, ws.lists, ws.users],
  )

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return
    const dest = groups.find((g) => g.id === r.destination!.droppableId)
    const src = groups.find((g) => g.id === r.source.droppableId)
    const task = src?.tasks[r.source.index]
    if (!dest || !task) return
    const list = dest.tasks.filter((t) => t.id !== task.id)
    void ws.updateTask(task.id, { ...dest.patch, order: orderBetween(list[r.destination.index - 1]?.order, list[r.destination.index]?.order) })
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2, minHeight: 420, alignItems: 'stretch' }}>
        {groups.map((g) => (
          <Column key={g.id} group={g} />
        ))}
      </Box>
    </DragDropContext>
  )
}
