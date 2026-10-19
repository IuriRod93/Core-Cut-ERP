import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { DataTable, type Column } from '../../components/ui'
import { AssigneePicker, DueChip, PriorityFlag, StatusPill, TagChips } from './shared'
import { useWorkspace } from './useWorkspace'
import { PRIORITY_RANK, trackedSeconds } from '../../domain/tasks'
import { fmtDuration, fmtHours } from '../../lib/format'
import type { Task } from '../../types'

export function TableView() {
  const ws = useWorkspace()
  const rows = useMemo(() => ws.filtered, [ws.filtered])

  const columns: Column<Task>[] = [
    {
      key: 'title',
      header: 'Tarefa',
      sort: (t) => t.title,
      render: (t) => (
        <Box sx={{ pl: t.parentId ? 2.5 : 0, minWidth: 200 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: t.completedAt ? 'line-through' : 'none' }}>
            {t.title}
          </Typography>
          <TagChips tags={t.tags} max={2} />
        </Box>
      ),
    },
    { key: 'list', header: 'Lista', hideBelow: 'lg', sort: (t) => ws.lists.find((l) => l.id === t.listId)?.name, render: (t) => ws.lists.find((l) => l.id === t.listId)?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      sort: (t) => ws.statuses.findIndex((s) => s.id === t.status),
      render: (t) => <StatusPill task={t} statuses={ws.statuses} onChange={(status) => ws.updateTask(t.id, { status })} />,
    },
    {
      key: 'assignees',
      header: 'Responsáveis',
      sort: (t) => ws.userMap.get(t.assigneeIds?.[0] ?? '')?.name,
      render: (t) => <AssigneePicker task={t} />,
    },
    {
      key: 'priority',
      header: 'Prioridade',
      sort: (t) => PRIORITY_RANK[t.priority ?? 'normal'],
      render: (t) => <PriorityFlag priority={t.priority} showLabel onChange={(p) => ws.updateTask(t.id, { priority: p as Task['priority'] })} />,
    },
    { key: 'start', header: 'Início', hideBelow: 'md', sort: (t) => t.startDate, render: (t) => <DueChip task={t} field="startDate" onChange={(d) => ws.updateTask(t.id, { startDate: d })} /> },
    { key: 'due', header: 'Entrega', sort: (t) => t.dueDate, render: (t) => <DueChip task={t} onChange={(d) => ws.updateTask(t.id, { dueDate: d })} /> },
    {
      key: 'estimate',
      header: 'Estimado',
      align: 'right',
      hideBelow: 'md',
      sort: (t) => t.estimateMinutes,
      render: (t) => (t.estimateMinutes ? fmtHours(t.estimateMinutes / 60) : '—'),
    },
    {
      key: 'tracked',
      header: 'Registrado',
      align: 'right',
      hideBelow: 'md',
      sort: (t) => trackedSeconds(ws.entries, t.id),
      render: (t) => {
        const s = trackedSeconds(ws.entries, t.id)
        return s ? fmtDuration(s) : '—'
      },
    },
    ...(ws.project.customFields ?? []).map<Column<Task>>((f) => ({
      key: `cf-${f.id}`,
      header: f.name,
      hideBelow: 'lg',
      sort: (t) => String(t.custom?.[f.id] ?? ''),
      render: (t) => String(t.custom?.[f.id] ?? '—'),
    })),
  ]

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 3, bgcolor: '#fff', overflow: 'hidden' }}>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(t) => t.id}
        onRowClick={(t) => ws.openTask(t.id)}
        pageSize={25}
        dense
        initialSort={{ key: 'due', dir: 'asc' }}
        empty={
          <Typography variant="body2" color="text.secondary" sx={{ p: 4, textAlign: 'center' }}>
            Nenhuma tarefa corresponde aos filtros atuais.
          </Typography>
        }
      />
    </Box>
  )
}
