import { useMemo, useState, type ReactNode } from 'react'
import {
  Avatar,
  AvatarGroup,
  Box,
  Button,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  InputAdornment,
  LinearProgress,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from './Stack'
import { CloseIcon, SearchIcon } from './icons'
import { colors, brandFont } from '../theme'
import { initials } from '../lib/format'
import { fileUrl } from '../lib/api'
import type { Opt } from '../domain/constants'
import type { User } from '../types'

// --------------------------------------------------------------- PageHeader
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
  children?: ReactNode
}) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'flex-end' }}>
        <Box sx={{ minWidth: 0 }}>
          {eyebrow ? (
            <Typography variant="overline" color="primary" sx={{ display: 'block' }}>
              {eyebrow}
            </Typography>
          ) : null}
          <Typography variant="h3" component="h1" sx={{ lineHeight: 1.2 }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 760 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {actions ? (
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: 'wrap' }}>
            {actions}
          </Stack>
        ) : null}
      </Stack>
      {children}
    </Box>
  )
}

// -------------------------------------------------------------------- Panel
export function Panel({
  title,
  subtitle,
  actions,
  children,
  padded = true,
  sx,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  padded?: boolean
  sx?: object
}) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, bgcolor: 'background.paper', overflow: 'hidden', ...sx }}>
      {title || actions ? (
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 2.5, py: 1.5, borderBottom: `1px solid ${colors.border}` }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {actions ? <Stack direction="row" spacing={0.5} alignItems="center">{actions}</Stack> : null}
        </Stack>
      ) : null}
      <Box sx={{ p: padded ? 2.5 : 0 }}>{children}</Box>
    </Paper>
  )
}

// ----------------------------------------------------------------- StatCard
type Tone = 'default' | 'brand' | 'success' | 'warning' | 'error' | 'info'
const toneColor: Record<Tone, string> = {
  default: colors.text,
  brand: colors.brand,
  success: colors.success,
  warning: colors.warning,
  error: colors.error,
  info: colors.info,
}

/**
 * Cartão de indicador. O valor se ajusta à largura do próprio cartão (em celulares de duas colunas "R$ 121.081,37"
 * cabe sem passar da borda) e o ícone fica ao lado do rótulo, nunca em cima do número.
 */
export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: Tone
  onClick?: () => void
}) {
  const color = toneColor[tone]
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : null
  // largura útil = largura do cartão (container) - padding; cada caractere ocupa ~0,6 em
  const fitted = text
    ? `clamp(0.9rem, calc((100cqw - 32px) / ${Math.max(text.length * 0.6, 4).toFixed(2)}), 1.6rem)`
    : '1.6rem'
  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        borderRadius: 3,
        height: '100%',
        containerType: 'inline-size',
        minWidth: 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color .15s, box-shadow .15s',
        '&:hover': onClick ? { borderColor: colors.brand, boxShadow: '0 4px 14px rgba(112,6,24,0.08)' } : undefined,
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ mb: 0.75 }}>
        <Typography
          variant="overline"
          color="text.secondary"
          sx={{ display: 'block', minWidth: 0, flex: 1, lineHeight: 1.35, whiteSpace: 'normal', overflowWrap: 'anywhere', fontSize: { xs: '0.66rem', sm: '0.72rem' } }}
        >
          {label}
        </Typography>
        {icon ? (
          <Box
            sx={{
              width: { xs: 30, sm: 36 },
              height: { xs: 30, sm: 36 },
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: tone === 'default' ? colors.brandTint : alpha(color, 0.1),
              color: tone === 'default' ? colors.brand : color,
              flexShrink: 0,
              '& svg': { fontSize: { xs: 17, sm: 20 } },
            }}
          >
            {icon}
          </Box>
        ) : null}
      </Stack>
      <Typography
        sx={{
          fontSize: fitted,
          fontWeight: 600,
          lineHeight: 1.25,
          color,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '-0.01em',
          whiteSpace: text ? 'nowrap' : 'normal',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>
          {hint}
        </Typography>
      ) : null}
    </Paper>
  )
}

// --------------------------------------------------------------- Status/Tag
export function StatusChip({ options, value, size = 'small' }: { options: Opt[]; value?: string | null; size?: 'small' | 'medium' }) {
  const opt = options.find((o) => o.value === value)
  const color = opt?.color ?? colors.textMuted
  return (
    <Chip
      size={size}
      label={opt?.label ?? value ?? '—'}
      sx={{ bgcolor: alpha(color, 0.12), color, border: `1px solid ${alpha(color, 0.25)}`, '& .MuiChip-label': { px: 1 } }}
    />
  )
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <Box component="span" sx={{ width: size, height: size, borderRadius: '50%', bgcolor: color, display: 'inline-block', flexShrink: 0 }} />
}

export function Tag({ label, color = colors.textSecondary, onDelete }: { label: string; color?: string; onDelete?: () => void }) {
  return (
    <Chip
      size="small"
      label={label}
      onDelete={onDelete}
      sx={{ bgcolor: alpha(color, 0.1), color, borderRadius: 1.5, fontWeight: 600, height: 22 }}
    />
  )
}

// ------------------------------------------------------------------ Avatars
const AVATAR_COLORS = ['#700618', '#a67b52', '#2f6f9f', '#2f8f8a', '#b7791f', '#6b5fa8', '#c06a2b', '#3f7a4f']
const hashColor = (seed: string) => AVATAR_COLORS[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]

type AvatarUser = Pick<User, 'id' | 'name'> & Partial<Pick<User, 'color' | 'photoFileId'>>

export function UserAvatar({ user, size = 28, ring }: { user?: AvatarUser | null; size?: number; ring?: boolean }) {
  if (!user) {
    return <Avatar sx={{ width: size, height: size, bgcolor: colors.border, color: colors.textMuted, fontSize: size * 0.4 }}>?</Avatar>
  }
  return (
    <Tooltip title={user.name}>
      <Avatar
        src={user.photoFileId ? fileUrl(user.photoFileId, { inline: true }) : undefined}
        alt={user.name}
        sx={{ width: size, height: size, bgcolor: user.color || hashColor(user.id), fontSize: size * 0.4, boxShadow: ring ? `0 0 0 2px #fff, 0 0 0 3.5px ${colors.brand}` : undefined }}
      >
        {initials(user.name)}
      </Avatar>
    </Tooltip>
  )
}

export function AvatarStack({ users, max = 4, size = 26 }: { users: (AvatarUser | undefined)[]; max?: number; size?: number }) {
  const valid = users.filter(Boolean) as AvatarUser[]
  if (!valid.length) return <UserAvatar user={null} size={size} />
  return (
    <AvatarGroup max={max} sx={{ '& .MuiAvatar-root': { width: size, height: size, fontSize: size * 0.4, border: '2px solid #fff' } }}>
      {valid.map((u) => (
        <Tooltip key={u.id} title={u.name}>
          <Avatar src={u.photoFileId ? fileUrl(u.photoFileId, { inline: true }) : undefined} alt={u.name} sx={{ bgcolor: u.color || hashColor(u.id) }}>
            {initials(u.name)}
          </Avatar>
        </Tooltip>
      ))}
    </AvatarGroup>
  )
}

// -------------------------------------------------------------- EmptyState
export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <Stack alignItems="center" spacing={1} sx={{ py: 6, px: 3, textAlign: 'center' }}>
      {icon ? (
        <Box sx={{ width: 52, height: 52, borderRadius: 3, display: 'grid', placeItems: 'center', bgcolor: colors.brandTint, color: colors.brand, '& svg': { fontSize: 26 } }}>
          {icon}
        </Box>
      ) : null}
      <Typography variant="subtitle1">{title}</Typography>
      {description ? (
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
          {description}
        </Typography>
      ) : null}
      {action ? <Box sx={{ pt: 1 }}>{action}</Box> : null}
    </Stack>
  )
}

export function LoadingState({ label = 'Carregando…' }: { label?: string }) {
  return (
    <Stack alignItems="center" justifyContent="center" spacing={1.5} sx={{ py: 8 }}>
      <CircularProgress size={28} sx={{ color: colors.brand }} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  )
}

// -------------------------------------------------------------- SearchField
export function SearchField({
  value,
  onChange,
  placeholder = 'Buscar…',
  width = 280,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number | string
  autoFocus?: boolean
}) {
  return (
    <TextField
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoFocus={autoFocus}
      sx={{ width, maxWidth: '100%' }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" sx={{ color: colors.textMuted }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => onChange('')} aria-label="Limpar busca">
                <CloseIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  )
}

// ---------------------------------------------------------------- DataTable
export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  sort?: (row: T) => string | number | null | undefined
  width?: number | string
  align?: 'left' | 'right' | 'center'
  hideBelow?: 'sm' | 'md' | 'lg'
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  initialSort,
  pageSize = 15,
  empty,
  dense,
  selectedId,
  rowSx,
  paginate = true,
}: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  initialSort?: { key: string; dir: 'asc' | 'desc' }
  pageSize?: number
  empty?: ReactNode
  dense?: boolean
  selectedId?: string | null
  rowSx?: (row: T) => object | undefined
  paginate?: boolean
}) {
  const [sort, setSort] = useState(initialSort ?? null)
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(pageSize)

  const sorted = useMemo(() => {
    if (!sort) return rows
    const col = columns.find((c) => c.key === sort.key)
    if (!col?.sort) return rows
    const get = col.sort
    const dir = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = get(a)
      const vb = get(b)
      if (va === vb) return 0
      if (va === null || va === undefined || va === '') return 1
      if (vb === null || vb === undefined || vb === '') return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * dir
    })
  }, [rows, sort, columns])

  const maxPage = Math.max(Math.ceil(sorted.length / size) - 1, 0)
  const current = Math.min(page, maxPage)
  const visible = paginate ? sorted.slice(current * size, current * size + size) : sorted
  const hide = (c: Column<T>) => (c.hideBelow ? { display: { xs: 'none', [c.hideBelow]: 'table-cell' } } : {})

  if (!rows.length && empty) return <>{empty}</>

  return (
    <Box>
      <TableContainer>
        <Table size={dense ? 'small' : 'medium'}>
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.key} align={c.align} sx={{ width: c.width, ...hide(c) }} sortDirection={sort?.key === c.key ? sort.dir : false}>
                  {c.sort ? (
                    <TableSortLabel
                      active={sort?.key === c.key}
                      direction={sort?.key === c.key ? sort.dir : 'asc'}
                      onClick={() => setSort(sort?.key === c.key && sort.dir === 'asc' ? { key: c.key, dir: 'desc' } : { key: c.key, dir: 'asc' })}
                    >
                      {c.header}
                    </TableSortLabel>
                  ) : (
                    c.header
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((row) => {
              const key = rowKey(row)
              return (
                <TableRow
                  key={key}
                  hover={Boolean(onRowClick)}
                  selected={selectedId === key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  sx={{ cursor: onRowClick ? 'pointer' : 'default', '&:last-child td': { borderBottom: 0 }, ...(rowSx?.(row) ?? {}) }}
                >
                  {columns.map((c) => (
                    <TableCell key={c.key} align={c.align} sx={hide(c)}>
                      {c.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {paginate && sorted.length > 10 ? (
        <TablePagination
          component="div"
          count={sorted.length}
          page={current}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={size}
          onRowsPerPageChange={(e) => {
            setSize(Number(e.target.value))
            setPage(0)
          }}
          rowsPerPageOptions={[10, 15, 25, 50, 100]}
          labelRowsPerPage="Linhas por página"
          labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
          sx={{ borderTop: `1px solid ${colors.border}`, '& .MuiTablePagination-toolbar': { minHeight: 48 } }}
        />
      ) : null}
    </Box>
  )
}

// --------------------------------------------------------------- SideDrawer
export function SideDrawer({
  open,
  onClose,
  title,
  subtitle,
  width = 560,
  actions,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  width?: number
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: width }, maxWidth: '100%', display: 'flex', flexDirection: 'column' } } }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" sx={{ px: 2.5, py: 2, borderBottom: `1px solid ${colors.border}` }} spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontFamily: brandFont }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {actions}
          <IconButton onClick={onClose} aria-label="Fechar">
            <CloseIcon />
          </IconButton>
        </Stack>
      </Stack>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>{children}</Box>
      {footer ? <Box sx={{ borderTop: `1px solid ${colors.border}`, p: 2, bgcolor: colors.subtle }}>{footer}</Box> : null}
    </Drawer>
  )
}

// ----------------------------------------------------------- InlineMenu chip
export function InlineSelect({
  options,
  value,
  onChange,
  children,
  allowClear,
}: {
  options: Opt[]
  value?: string | null
  onChange: (value: string) => void
  children: ReactNode
  allowClear?: boolean
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Box
        component="span"
        onClick={(e: React.MouseEvent<HTMLElement>) => {
          e.stopPropagation()
          setAnchor(e.currentTarget)
        }}
        sx={{ cursor: 'pointer', display: 'inline-flex' }}
      >
        {children}
      </Box>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        {options.map((o) => (
          <MenuItem
            key={o.value}
            selected={o.value === value}
            onClick={() => {
              setAnchor(null)
              onChange(o.value)
            }}
          >
            <Dot color={o.color ?? colors.textMuted} />
            <Box component="span" sx={{ ml: 1 }}>
              {o.label}
            </Box>
          </MenuItem>
        ))}
        {allowClear && value ? (
          <MenuItem
            onClick={() => {
              setAnchor(null)
              onChange('')
            }}
            sx={{ color: 'text.secondary' }}
          >
            Limpar
          </MenuItem>
        ) : null}
      </Menu>
    </>
  )
}

// ----------------------------------------------------------- ProgressLine
export function ProgressLine({ value, label, color = colors.brand, height = 6 }: { value: number; label?: ReactNode; color?: string; height?: number }) {
  const v = Math.min(Math.max(value, 0), 100)
  return (
    <Box sx={{ minWidth: 90 }}>
      {label !== undefined ? (
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption">{label}</Typography>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {Math.round(v)}%
          </Typography>
        </Stack>
      ) : null}
      <LinearProgress variant="determinate" value={v} sx={{ height, '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 6 } }} />
    </Box>
  )
}

// ---------------------------------------------------------------- KeyValue
export function KeyValue({ items, columns = 2 }: { items: { label: string; value: ReactNode }[]; columns?: number }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: `repeat(${columns}, minmax(0, 1fr))` }, gap: 2 }}>
      {items.map((it) => (
        <Box key={it.label} sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" sx={{ display: 'block' }}>
            {it.label}
          </Typography>
          <Typography variant="body1" component="div" sx={{ wordBreak: 'break-word' }}>
            {it.value || '—'}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}

export function ToolbarRow({ children }: { children: ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" useFlexGap sx={{ mb: 2, flexWrap: 'wrap' }}>
      {children}
    </Stack>
  )
}

export function SubmitBar({ onCancel, onSubmit, loading, label = 'Salvar' }: { onCancel: () => void; onSubmit: () => void; loading?: boolean; label?: string }) {
  return (
    <Stack direction="row" spacing={1} justifyContent="flex-end">
      <Button onClick={onCancel} color="inherit">
        Cancelar
      </Button>
      <Button onClick={onSubmit} variant="contained" disabled={loading}>
        {loading ? 'Salvando…' : label}
      </Button>
    </Stack>
  )
}
