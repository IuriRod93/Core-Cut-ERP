import { useMemo, useState } from 'react'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Box, Button, Checkbox, Chip, IconButton, MenuItem, TextField, Typography, alpha } from '@mui/material'
import { Stack } from '../../components/Stack'
import { DragIndicatorIcon, KeyboardArrowDownIcon, KeyboardArrowRightIcon, AddIcon, SubdirectoryArrowRightIcon, CheckBoxIcon } from '../../components/icons'
import { Dot } from '../../components/ui'
import { AssigneePicker, DoneToggle, DueChip, PriorityFlag, TagChips } from './shared'
import { useWorkspace, type Filters } from './useWorkspace'
import { groupTasks, type TaskGroup } from './grouping'
import { doneStatus, firstStatus, isDoneStatus, orderBetween } from '../../domain/tasks'
import { colors } from '../../theme'
import { fmtHours } from '../../lib/format'
import type { Task } from '../../types'

const GRID = '30px 28px 28px minmax(220px, 1fr) 110px 96px 64px 76px'

export const GROUP_OPTIONS: { value: Filters['groupBy']; label: string }[] = [
  { value: 'status', label: 'Agrupar por status' },
  { value: 'list', label: 'Agrupar por lista' },
  { value: 'assignee', label: 'Agrupar por responsável' },
  { value: 'priority', label: 'Agrupar por prioridade' },
  { value: 'due', label: 'Agrupar por entrega' },
  { value: 'none', label: 'Sem agrupamento' },
]

export function GroupBySelect() {
  const { filters, setFilters } = useWorkspace()
  return (
    <TextField select value={filters.groupBy} onChange={(e) => setFilters({ groupBy: e.target.value as Filters['groupBy'] })} sx={{ width: { xs: 'calc(50% - 6px)', sm: 220 } }}>
      {GROUP_OPTIONS.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  )
}

function TaskRow({ task, index, group, depth = 0, draggable }: { task: Task; index: number; group: TaskGroup; depth?: number; draggable: boolean }) {
  const ws = useWorkspace()
  const [open, setOpen] = useState(false)
  const subs = ws.filtered.filter((t) => t.parentId === task.id).sort((a, b) => a.order - b.order)
  const list = ws.lists.find((l) => l.id === task.listId)
  const done = isDoneStatus(ws.statuses, task.status)
  const status = ws.statuses.find((s) => s.id === task.status)
  const checklistTotal = (task.checklists ?? []).reduce((s, c) => s + c.items.length, 0)
  const checklistDone = (task.checklists ?? []).reduce((s, c) => s + c.items.filter((i) => i.done).length, 0)

  const toggleDone = () =>
    ws.updateTask(task.id, { status: done ? firstStatus(ws.statuses).id : doneStatus(ws.statuses).id })
  const isSelected = ws.selected.includes(task.id)

  const row = (dragProps?: { innerRef: (el: HTMLElement | null) => void; draggableProps: object; dragHandleProps: object | null | undefined }, dragging = false) => (
    <Box ref={dragProps?.innerRef} {...(dragProps?.draggableProps ?? {})}>
      <Box
        onClick={() => ws.openTask(task.id)}
        sx={{
          display: 'grid',
          gridTemplateColumns: GRID,
          alignItems: 'center',
          gap: 0.75,
          minHeight: 40,
          pl: depth * 3,
          pr: 1,
          cursor: 'pointer',
          bgcolor: dragging ? '#fff' : isSelected ? alpha(colors.brand, 0.07) : 'transparent',
          boxShadow: dragging ? '0 8px 24px rgba(30,26,25,0.18)' : 'none',
          borderRadius: dragging ? 2 : 0,
          borderBottom: `1px solid ${colors.border}`,
          '&:hover': { bgcolor: alpha(colors.brand, 0.035), '& .row-drag': { opacity: 1 }, '& .row-select': { opacity: 1 } },
        }}
      >
        <Checkbox
          className="row-select"
          size="small"
          checked={isSelected}
          onClick={(e) => e.stopPropagation()}
          onChange={() => ws.toggleSelect(task.id)}
          slotProps={{ input: { 'aria-label': 'Selecionar tarefa' } }}
          sx={{ p: 0.25, opacity: isSelected || ws.selected.length ? 1 : 0 }}
        />
        <Box {...(dragProps?.dragHandleProps ?? {})} className="row-drag" sx={{ opacity: 0, color: colors.textMuted, display: 'grid', placeItems: 'center', cursor: draggable ? 'grab' : 'default' }} onClick={(e) => e.stopPropagation()}>
          {draggable ? <DragIndicatorIcon sx={{ fontSize: 18 }} /> : null}
        </Box>
        <DoneToggle done={done} color={status?.color} onToggle={toggleDone} />
        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
          {subs.length || (ws.tasks.some((t) => t.parentId === task.id)) ? (
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} sx={{ p: 0.25 }} aria-label="Expandir subtarefas">
              {open ? <KeyboardArrowDownIcon sx={{ fontSize: 18 }} /> : <KeyboardArrowRightIcon sx={{ fontSize: 18 }} />}
            </IconButton>
          ) : null}
          <Typography variant="body2" noWrap sx={{ fontWeight: 500, textDecoration: done ? 'line-through' : 'none', color: done ? 'text.secondary' : 'text.primary' }}>
            {task.title}
          </Typography>
          {task.milestone ? <Chip size="small" label="Marco" sx={{ height: 18, fontSize: 10, bgcolor: alpha(colors.brand, 0.1), color: colors.brand }} /> : null}
          {ws.tasks.some((t) => t.parentId === task.id) ? (
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
              <SubdirectoryArrowRightIcon sx={{ fontSize: 14 }} />
              {ws.tasks.filter((t) => t.parentId === task.id && isDoneStatus(ws.statuses, t.status)).length}/{ws.tasks.filter((t) => t.parentId === task.id).length}
            </Typography>
          ) : null}
          {checklistTotal ? (
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
              <CheckBoxIcon sx={{ fontSize: 14 }} />
              {checklistDone}/{checklistTotal}
            </Typography>
          ) : null}
          <TagChips tags={task.tags} max={2} />
          {ws.filters.groupBy !== 'list' && list ? (
            <Typography variant="caption" color="text.disabled" noWrap sx={{ display: { xs: 'none', lg: 'block' } }}>
              {list.name}
            </Typography>
          ) : null}
        </Stack>
        <Box onClick={(e) => e.stopPropagation()}>
          <AssigneePicker task={task} />
        </Box>
        <DueChip task={task} onChange={(d) => ws.updateTask(task.id, { dueDate: d })} />
        <PriorityFlag priority={task.priority} onChange={(p) => ws.updateTask(task.id, { priority: p as Task['priority'] })} />
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'right' }}>
          {task.estimateMinutes ? fmtHours(task.estimateMinutes / 60) : ''}
        </Typography>
      </Box>
    </Box>
  )

  return (
    <>
      {draggable ? (
        <Draggable draggableId={task.id} index={index}>
          {(p, snap) => row({ innerRef: p.innerRef, draggableProps: p.draggableProps, dragHandleProps: p.dragHandleProps }, snap.isDragging)}
        </Draggable>
      ) : (
        row()
      )}
      {open
        ? subs.map((s) => (
            <TaskRow key={s.id} task={s} index={0} group={group} depth={depth + 1} draggable={false} />
          ))
        : null}
    </>
  )
}

function QuickAdd({ group }: { group: TaskGroup }) {
  const ws = useWorkspace()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const submit = async () => {
    const t = title.trim()
    if (!t) return setEditing(false)
    await ws.createTask({ title: t, ...group.patch })
    setTitle('')
  }
  if (!editing)
    return (
      <Button size="small" startIcon={<AddIcon />} onClick={() => setEditing(true)} sx={{ color: 'text.secondary', ml: 5, my: 0.5 }}>
        Adicionar tarefa
      </Button>
    )
  return (
    <Box sx={{ pl: 5, pr: 1.5, py: 0.75 }}>
      <TextField
        autoFocus
        placeholder="Nome da tarefa e Enter para criar"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit()
          if (e.key === 'Escape') setEditing(false)
        }}
      />
    </Box>
  )
}

export function ListView() {
  const ws = useWorkspace()
  const groups = useMemo(() => groupTasks(ws.filtered, ws.filters.groupBy, { statuses: ws.statuses, lists: ws.lists, users: ws.users }), [ws.filtered, ws.filters.groupBy, ws.statuses, ws.lists, ws.users])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const canDrag = groups.some((g) => g.droppable)

  const onDragEnd = (r: DropResult) => {
    if (!r.destination) return
    const dest = groups.find((g) => g.id === r.destination!.droppableId)
    const srcGroup = groups.find((g) => g.id === r.source.droppableId)
    const task = srcGroup?.tasks[r.source.index]
    if (!dest || !task) return
    const list = dest.tasks.filter((t) => t.id !== task.id)
    const prev = list[r.destination.index - 1]
    const next = list[r.destination.index]
    void ws.updateTask(task.id, { ...dest.patch, order: orderBetween(prev?.order, next?.order) })
  }

  const empty = groups.every((g) => g.tasks.length === 0) && ws.filters.groupBy !== 'status' && ws.filters.groupBy !== 'list'

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 3, bgcolor: '#fff', overflow: 'hidden' }}>
        <Box sx={{ display: { xs: 'none', md: 'grid' }, gridTemplateColumns: GRID, gap: 0.75, px: 1, py: 0.75, bgcolor: colors.subtle, borderBottom: `1px solid ${colors.border}` }}>
          <span />
          <span />
          <span />
          {['Tarefa', 'Responsável', 'Entrega', 'Prior.', 'Estim.'].map((h, i) => (
            <Typography key={h} variant="overline" color="text.secondary" sx={{ textAlign: i === 4 ? 'right' : 'left' }}>
              {h}
            </Typography>
          ))}
        </Box>
        {empty ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
            Nenhuma tarefa corresponde aos filtros atuais.
          </Typography>
        ) : null}
        {groups.map((g) => {
          const isCollapsed = collapsed[g.id]
          return (
            <Box key={g.id}>
              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                sx={{ px: 1.5, py: 1, cursor: 'pointer', bgcolor: alpha(g.color, 0.06), borderBottom: `1px solid ${colors.border}`, borderTop: `1px solid ${colors.border}`, '&:first-of-type': { borderTop: 0 } }}
              >
                {isCollapsed ? <KeyboardArrowRightIcon sx={{ fontSize: 18 }} /> : <KeyboardArrowDownIcon sx={{ fontSize: 18 }} />}
                <Dot color={g.color} size={10} />
                <Typography variant="subtitle2">{g.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {g.tasks.length}
                </Typography>
                {g.tasks.length ? (
                  <Typography
                    variant="caption"
                    onClick={(e) => {
                      e.stopPropagation()
                      const ids = g.tasks.map((t) => t.id)
                      const all = ids.every((id) => ws.selected.includes(id))
                      ws.setSelected(all ? ws.selected.filter((id) => !ids.includes(id)) : [...new Set([...ws.selected, ...ids])])
                    }}
                    sx={{ ml: 'auto', color: colors.brand, cursor: 'pointer', fontWeight: 600 }}
                  >
                    {g.tasks.every((t) => ws.selected.includes(t.id)) ? 'Desmarcar grupo' : 'Selecionar grupo'}
                  </Typography>
                ) : null}
              </Stack>
              {isCollapsed ? null : (
                <Droppable droppableId={g.id} isDropDisabled={!g.droppable}>
                  {(p, snap) => (
                    <Box ref={p.innerRef} {...p.droppableProps} sx={{ minHeight: 8, bgcolor: snap.isDraggingOver ? alpha(colors.brand, 0.04) : 'transparent' }}>
                      {g.tasks.map((t, i) => (
                        <TaskRow key={t.id} task={t} index={i} group={g} draggable={canDrag && g.droppable} />
                      ))}
                      {p.placeholder}
                    </Box>
                  )}
                </Droppable>
              )}
              {isCollapsed || !g.droppable ? null : <QuickAdd group={g} />}
            </Box>
          )
        })}
      </Box>
    </DragDropContext>
  )
}
