import { useMemo, useState } from 'react'
import { Box, Chip, MenuItem, Paper, TextField, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { DataTable, EmptyState, LoadingState, PageHeader, SearchField, type Column } from '../components/ui'
import { HistoryIcon } from '../components/icons'
import { useCollection } from '../lib/store'
import { fmtDateTime, matches } from '../lib/format'
import { colors } from '../theme'
import type { AuditLog, Doc } from '../types'

const ACTIONS: Record<string, { label: string; color: string }> = {
  create: { label: 'Criação', color: '#2e7d4f' },
  update: { label: 'Alteração', color: '#2f6f9f' },
  delete: { label: 'Exclusão', color: '#c23b3b' },
  login: { label: 'Login', color: '#6b5fa8' },
  login_failed: { label: 'Login recusado', color: '#c23b3b' },
  logout: { label: 'Logout', color: '#7d838c' },
  password_change: { label: 'Troca de senha', color: '#b7791f' },
  upload: { label: 'Upload', color: '#2f8f8a' },
  receive: { label: 'Recebimento', color: '#2e7d4f' },
  backup: { label: 'Backup', color: '#6b5fa8' },
  restore: { label: 'Restauração', color: '#b7791f' },
  restore_item: { label: 'Restauração de item', color: '#b7791f' },
  catalog_import: { label: 'Importação de catálogo', color: '#a67b52' },
  catalog_sync: { label: 'Atualização de preços', color: '#a67b52' },
  demo_load: { label: 'Dados de demonstração', color: '#7d838c' },
  demo_clear: { label: 'Remoção de demonstração', color: '#7d838c' },
}

export function AuditLogPage() {
  const logs = useCollection('auditLogs')
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [collection, setCollection] = useState('')

  const rows = useMemo(
    () => (logs.items as unknown as (AuditLog & Doc)[]).filter((l) => (!action || l.action === action) && (!collection || l.collection === collection) && matches([l.userName, l.label, l.collection, l.ip], query)),
    [logs.items, query, action, collection],
  )
  const collections = [...new Set((logs.items as unknown as AuditLog[]).map((l) => l.collection))].sort()

  const columns: Column<AuditLog & Doc>[] = [
    { key: 'at', header: 'Data e hora', sort: (l) => l.at, render: (l) => fmtDateTime(l.at), width: 190 },
    { key: 'user', header: 'Usuário', sort: (l) => l.userName, render: (l) => <strong>{l.userName}</strong> },
    {
      key: 'action',
      header: 'Ação',
      sort: (l) => l.action,
      render: (l) => {
        const a = ACTIONS[l.action] ?? { label: l.action, color: '#7d838c' }
        return <Chip size="small" label={a.label} sx={{ bgcolor: `${a.color}1f`, color: a.color }} />
      },
    },
    { key: 'collection', header: 'Módulo', hideBelow: 'md', sort: (l) => l.collection, render: (l) => l.collection },
    {
      key: 'label',
      header: 'Registro',
      render: (l) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {l.label || '—'}
          </Typography>
          {l.changes?.length ? (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              Campos: {l.changes.join(', ')}
            </Typography>
          ) : null}
        </Box>
      ),
    },
    { key: 'ip', header: 'IP', hideBelow: 'lg', render: (l) => l.ip ?? '' },
  ]

  if (logs.loading) return <LoadingState />
  return (
    <Box>
      <PageHeader title="Logs de acesso" subtitle="Trilha de auditoria: quem fez o quê e quando — logins, criações, alterações e exclusões." />
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ p: 2, borderBottom: `1px solid ${colors.border}`, flexWrap: 'wrap' }}>
          <SearchField value={query} onChange={setQuery} placeholder="Buscar usuário, registro, IP…" />
          <TextField select label="Ação" value={action} onChange={(e) => setAction(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 200 } }}>
            <MenuItem value="">Todas</MenuItem>
            {Object.entries(ACTIONS).map(([k, v]) => (
              <MenuItem key={k} value={k}>
                {v.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Módulo" value={collection} onChange={(e) => setCollection(e.target.value)} sx={{ width: { xs: 'calc(50% - 6px)', sm: 200 } }}>
            <MenuItem value="">Todos</MenuItem>
            {collections.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {rows.length === 0 ? <EmptyState icon={<HistoryIcon />} title="Nenhum registro" /> : <DataTable rows={rows} columns={columns} rowKey={(l) => l.id} initialSort={{ key: 'at', dir: 'desc' }} pageSize={25} dense />}
      </Paper>
    </Box>
  )
}
