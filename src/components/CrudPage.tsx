import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Box,
  Button,
  Grid,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  MenuItem as Item,
  Paper,
  TextField,
} from '@mui/material'
import { Stack } from './Stack'
import { AddIcon, DeleteIcon, DownloadIcon, EditIcon, MoreVertIcon } from './icons'
import { DataTable, EmptyState, LoadingState, PageHeader, SearchField, StatCard, type Column } from './ui'
import { FormDialog, type FieldDef, type Values } from './forms'
import { useConfirm, useToast } from './feedback'
import { useAuth } from '../auth/AuthContext'
import { useCollection, useCollections } from '../lib/store'
import { downloadBlob, matches, toCsv } from '../lib/format'
import type { Opt } from '../domain/constants'
import type { CollectionMap, CollectionName, ModuleKey } from '../types'

type Row = Record<string, any> & { id: string } // eslint-disable-line @typescript-eslint/no-explicit-any

export interface CrudContext {
  maps: Record<string, Map<string, any>> // eslint-disable-line @typescript-eslint/no-explicit-any
  data: Record<string, any[]> // eslint-disable-line @typescript-eslint/no-explicit-any
  userId: string
}

export interface CrudFilter {
  name: string
  label: string
  options: Opt[]
  get: (row: Row) => string | undefined | null
}

export interface CrudAction {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

export interface CrudConfig {
  collection: CollectionName
  module: ModuleKey
  title: string
  subtitle?: string
  singular: string
  icon: ReactNode
  lookups?: CollectionName[]
  columns: (ctx: CrudContext) => Column<Row>[]
  fields: FieldDef[] | ((ctx: CrudContext, values: Values) => FieldDef[])
  defaults?: (ctx: CrudContext) => Values
  searchText?: (row: Row, ctx: CrudContext) => unknown[]
  filters?: CrudFilter[]
  stats?: (rows: Row[], ctx: CrudContext) => { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'brand' | 'success' | 'warning' | 'error' | 'info' }[]
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  beforeSave?: (values: Values, mode: 'create' | 'edit', ctx: CrudContext) => Values
  rowActions?: (row: Row, ctx: CrudContext) => CrudAction[]
  headerActions?: (ctx: CrudContext) => ReactNode
  canDelete?: boolean
  dialogWidth?: 'xs' | 'sm' | 'md' | 'lg'
  renderExtra?: (ctx: { row: Row | null; values: Values; set: (n: string, v: unknown) => void; crud: CrudContext }) => ReactNode
  rowSx?: (row: Row) => object | undefined
  emptyHint?: string
  createLabel?: string
}

export function CrudPage({ config }: { config: CrudConfig }) {
  const { collection, singular } = config
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const store = useCollection(collection)
  const lookupNames = useMemo(() => [...new Set(config.lookups ?? [])], [config.lookups])
  const lookups = useCollections(lookupNames)

  const ctx = useMemo<CrudContext>(
    () => ({ maps: lookups.maps as CrudContext['maps'], data: lookups.data as CrudContext['data'], userId: user?.id ?? '' }),
    [lookups.maps, lookups.data, user?.id],
  )

  const [query, setQuery] = useState('')
  const [filterValues, setFilterValues] = useState<Record<string, string>>({})
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; row: Row | null } | null>(null)

  const rows = store.items as unknown as Row[]
  const visible = useMemo(
    () =>
      rows.filter((row) => {
        for (const f of config.filters ?? []) {
          const want = filterValues[f.name]
          if (want && f.get(row) !== want) return false
        }
        if (!query.trim()) return true
        const hay = config.searchText ? config.searchText(row, ctx) : Object.values(row).filter((v) => typeof v === 'string' || typeof v === 'number')
        return matches(hay as unknown[], query)
      }),
    [rows, query, filterValues, config, ctx],
  )

  // abre diálogo via ?new=1 ou ?id=...
  const idParam = params.get('id')
  const wantsNew = params.get('new') === '1'
  const [handled, setHandled] = useState<string | null>(null)
  const signature = `${idParam ?? ''}|${wantsNew}`
  if (handled !== signature && !store.loading) {
    if (wantsNew) setDialog({ mode: 'create', row: null })
    else if (idParam) {
      const found = rows.find((r) => r.id === idParam)
      if (found) setDialog({ mode: 'edit', row: found })
    }
    setHandled(signature)
  }

  const closeDialog = () => {
    setDialog(null)
    if (idParam || wantsNew) {
      params.delete('id')
      params.delete('new')
      setParams(params, { replace: true })
    }
  }

  const fields = typeof config.fields === 'function' ? config.fields(ctx, dialog?.row ?? {}) : config.fields

  const remove = async (row: Row) => {
    const ok = await confirm({
      title: `Excluir ${singular}?`,
      message: 'O registro será movido para a lixeira e poderá ser restaurado por um administrador.',
      confirmLabel: 'Excluir',
      danger: true,
    })
    if (!ok) return
    try {
      await store.remove(row.id)
      toast.success(`${singular[0].toUpperCase()}${singular.slice(1)} excluído.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.')
    }
  }

  const exportCsv = () => {
    const cols = config.columns(ctx).filter((c) => c.sort && typeof c.header === 'string')
    const table = [cols.map((c) => String(c.header)), ...visible.map((r) => cols.map((c) => c.sort!(r) ?? ''))]
    downloadBlob(new Blob([toCsv(table)], { type: 'text/csv;charset=utf-8' }), `${collection}-${new Date().toISOString().slice(0, 10)}.csv`)
  }

  const baseColumns = config.columns(ctx)
  const columns: Column<Row>[] = [
    ...baseColumns,
    {
      key: '_actions',
      header: '',
      width: 56,
      align: 'right',
      render: (row) => <RowMenu row={row} actions={config.rowActions?.(row, ctx) ?? []} onEdit={() => setDialog({ mode: 'edit', row })} onDelete={config.canDelete === false ? undefined : () => remove(row)} />,
    },
  ]

  const stats = config.stats?.(rows, ctx) ?? []

  return (
    <Box>
      <PageHeader
        title={config.title}
        subtitle={config.subtitle}
        actions={
          <>
            {config.headerActions?.(ctx)}
            <Button startIcon={<DownloadIcon />} variant="outlined" color="inherit" onClick={exportCsv} disabled={!visible.length}>
              Exportar
            </Button>
            <Button startIcon={<AddIcon />} variant="contained" onClick={() => setDialog({ mode: 'create', row: null })}>
              {config.createLabel ?? `Novo ${singular}`}
            </Button>
          </>
        }
      />

      {stats.length ? (
        <Grid container spacing={2} sx={{ mb: 2.5 }}>
          {stats.map((s) => (
            <Grid key={s.label} size={{ xs: 6, md: 12 / Math.min(stats.length, 4) }}>
              <StatCard {...s} />
            </Grid>
          ))}
        </Grid>
      ) : null}

      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', flexWrap: 'wrap' }}>
          <SearchField value={query} onChange={setQuery} placeholder={`Buscar ${config.title.toLowerCase()}…`} />
          {(config.filters ?? []).map((f) => (
            <TextField
              key={f.name}
              select
              label={f.label}
              value={filterValues[f.name] ?? ''}
              onChange={(e) => setFilterValues((v) => ({ ...v, [f.name]: e.target.value }))}
              sx={{ width: { xs: 'calc(50% - 6px)', sm: 190 } }}
            >
              <Item value="">Todos</Item>
              {f.options.map((o) => (
                <Item key={o.value} value={o.value}>
                  {o.label}
                </Item>
              ))}
            </TextField>
          ))}
          <Box sx={{ flex: 1 }} />
          <Box sx={{ color: 'text.secondary', fontSize: 12 }}>
            {visible.length} {visible.length === 1 ? 'registro' : 'registros'}
          </Box>
        </Stack>
        {store.loading ? (
          <LoadingState />
        ) : (
          <DataTable
            rows={visible}
            columns={columns}
            rowKey={(r) => r.id}
            onRowClick={(row) => setDialog({ mode: 'edit', row })}
            initialSort={config.initialSort}
            rowSx={config.rowSx}
            empty={
              <EmptyState
                icon={config.icon}
                title={rows.length ? 'Nenhum resultado para os filtros aplicados' : `Nenhum ${singular} cadastrado`}
                description={rows.length ? 'Ajuste a busca ou limpe os filtros.' : (config.emptyHint ?? `Cadastre o primeiro ${singular} para começar.`)}
                action={
                  rows.length ? undefined : (
                    <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ mode: 'create', row: null })}>
                      {config.createLabel ?? `Novo ${singular}`}
                    </Button>
                  )
                }
              />
            }
          />
        )}
      </Paper>

      {dialog ? (
        <FormDialog
          open
          title={dialog.mode === 'create' ? `Novo ${singular}` : `Editar ${singular}`}
          subtitle={dialog.row?.code ? String(dialog.row.code) : undefined}
          fields={fields}
          initial={dialog.mode === 'edit' && dialog.row ? { ...dialog.row } : (config.defaults?.(ctx) ?? {})}
          maxWidth={config.dialogWidth ?? 'md'}
          onClose={closeDialog}
          extraActions={
            dialog.mode === 'edit' && dialog.row && config.canDelete !== false ? (
              <Button color="error" startIcon={<DeleteIcon />} onClick={() => dialog.row && remove(dialog.row).then(closeDialog)}>
                Excluir
              </Button>
            ) : undefined
          }
          onSave={async (values) => {
            const payload = config.beforeSave ? config.beforeSave(values, dialog.mode, ctx) : values
            const clean = Object.fromEntries(Object.entries(payload).filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k)))
            if (dialog.mode === 'create') await store.create(clean as Partial<CollectionMap[typeof collection]>)
            else if (dialog.row) await store.update(dialog.row.id, clean as Partial<CollectionMap[typeof collection]>)
            toast.success(dialog.mode === 'create' ? 'Cadastro criado.' : 'Alterações salvas.')
          }}
        >
          {config.renderExtra ? ({ values, set }) => config.renderExtra!({ row: dialog.row, values, set, crud: ctx }) : undefined}
        </FormDialog>
      ) : null}
    </Box>
  )
}

function RowMenu({ row, actions, onEdit, onDelete }: { row: Row; actions: CrudAction[]; onEdit: () => void; onDelete?: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  void row
  return (
    <>
      <IconButton
        size="small"
        aria-label="Ações"
        onClick={(e) => {
          e.stopPropagation()
          setAnchor(e.currentTarget)
        }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            onEdit()
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          Editar
        </MenuItem>
        {actions
          .filter((a) => !a.hidden)
          .map((a) => (
            <MenuItem
              key={a.label}
              onClick={() => {
                setAnchor(null)
                a.onClick()
              }}
              sx={a.danger ? { color: 'error.main' } : undefined}
            >
              {a.icon ? <ListItemIcon sx={a.danger ? { color: 'error.main' } : undefined}>{a.icon}</ListItemIcon> : null}
              {a.label}
            </MenuItem>
          ))}
        {onDelete ? (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              onDelete()
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'error.main' }}>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            Excluir
          </MenuItem>
        ) : null}
      </Menu>
    </>
  )
}
