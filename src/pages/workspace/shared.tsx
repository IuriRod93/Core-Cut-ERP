import { useRef, useState, type ReactNode } from 'react'
import {
  Badge,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  MenuList,
  Popover,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'
import { Stack } from '../../components/Stack'
import { AvatarStack, Dot, SearchField, UserAvatar } from '../../components/ui'
import { CalendarMonthIcon, CheckCircleIcon, FilterListIcon, FlagIcon, RadioButtonUncheckedIcon, ArrowDropDownIcon } from '../../components/icons'
import { colors } from '../../theme'
import { addDaysISO, daysUntil, fmtDate, todayISO } from '../../lib/format'
import { TASK_PRIORITIES, optColor } from '../../domain/constants'
import { isOverdue } from '../../domain/tasks'
import { useWorkspace } from './useWorkspace'
import type { Task, TaskStatusDef } from '../../types'

// ----------------------------------------------------------------- status
export function StatusPill({ task, statuses, onChange, compact }: { task: Pick<Task, 'status'>; statuses: TaskStatusDef[]; onChange?: (id: string) => void; compact?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const status = statuses.find((s) => s.id === task.status) ?? statuses[0]
  const color = status?.color ?? colors.textMuted
  return (
    <>
      <Chip
        size="small"
        label={status?.label ?? task.status}
        onClick={onChange ? (e) => { e.stopPropagation(); setAnchor(e.currentTarget) } : undefined}
        icon={<Dot color={color} size={8} />}
        sx={{
          bgcolor: alpha(color, 0.12),
          color,
          border: `1px solid ${alpha(color, 0.28)}`,
          fontWeight: 700,
          '& .MuiChip-icon': { ml: 0.75, mr: -0.25 },
          ...(compact ? { height: 22 } : {}),
        }}
      />
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        {statuses.map((s) => (
          <MenuItem
            key={s.id}
            selected={s.id === task.status}
            onClick={() => {
              setAnchor(null)
              onChange?.(s.id)
            }}
          >
            <Dot color={s.color} />
            <Box component="span" sx={{ ml: 1 }}>{s.label}</Box>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** Círculo de conclusão rápido (estilo ClickUp). */
export function DoneToggle({ done, color, onToggle, size = 20 }: { done: boolean; color?: string; onToggle: () => void; size?: number }) {
  return (
    <IconButton
      size="small"
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      sx={{ p: 0.25, color: done ? colors.success : color ?? colors.textMuted }}
      aria-label={done ? 'Reabrir tarefa' : 'Concluir tarefa'}
    >
      {done ? <CheckCircleIcon sx={{ fontSize: size }} /> : <RadioButtonUncheckedIcon sx={{ fontSize: size }} />}
    </IconButton>
  )
}

// --------------------------------------------------------------- priority
export function PriorityFlag({ priority, onChange, showLabel }: { priority?: string | null; onChange?: (p: string) => void; showLabel?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const value = priority ?? 'normal'
  const color = value === 'normal' ? colors.textMuted : optColor(TASK_PRIORITIES, value)
  const label = TASK_PRIORITIES.find((p) => p.value === value)?.label
  return (
    <>
      <Tooltip title={`Prioridade: ${label}`}>
        <Box
          component="span"
          onClick={onChange ? (e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); setAnchor(e.currentTarget) } : undefined}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: onChange ? 'pointer' : 'default', color, fontSize: 12, fontWeight: 600 }}
        >
          <FlagIcon sx={{ fontSize: 18 }} />
          {showLabel ? label : null}
        </Box>
      </Tooltip>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)} onClick={(e) => e.stopPropagation()}>
        {TASK_PRIORITIES.map((p) => (
          <MenuItem
            key={p.value}
            selected={p.value === value}
            onClick={() => {
              setAnchor(null)
              onChange?.(p.value)
            }}
          >
            <FlagIcon sx={{ fontSize: 18, color: p.value === 'normal' ? colors.textMuted : p.color, mr: 1 }} />
            {p.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

// ------------------------------------------------------------------ dates
export function DueChip({ task, onChange, field = 'dueDate' }: { task: Pick<Task, 'dueDate' | 'startDate' | 'completedAt'>; onChange?: (date: string | null) => void; field?: 'dueDate' | 'startDate' }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const value = task[field]
  const overdue = field === 'dueDate' && isOverdue(task)
  const today = field === 'dueDate' && value && daysUntil(value) === 0 && !task.completedAt
  const color = overdue ? colors.error : today ? colors.warning : colors.textSecondary
  return (
    <>
      <Box
        component="span"
        onClick={onChange ? (e: React.MouseEvent<HTMLElement>) => { e.stopPropagation(); setAnchor(e.currentTarget) } : undefined}
        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color, fontSize: 12.5, fontWeight: overdue || today ? 700 : 500, cursor: onChange ? 'pointer' : 'default', whiteSpace: 'nowrap', '&:hover': onChange ? { color: colors.brand } : undefined }}
      >
        {value ? null : <CalendarMonthIcon sx={{ fontSize: 17, opacity: 0.6 }} />}
        {value ? (today ? 'Hoje' : fmtDate(value, 'dd MMM')) : onChange ? <Box component="span" sx={{ opacity: 0.55 }}>{field === 'dueDate' ? 'Entrega' : 'Início'}</Box> : '—'}
      </Box>
      <Popover open={Boolean(anchor)} onClose={() => setAnchor(null)} anchorEl={anchor} onClick={(e) => e.stopPropagation()} slotProps={{ paper: { sx: { p: 1.5, width: 230 } } }}>
        <TextField type="date" value={value ?? ''} onChange={(e) => { onChange?.(e.target.value || null) }} />
        <Stack direction="row" spacing={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
          {[
            { label: 'Hoje', date: todayISO() },
            { label: 'Amanhã', date: addDaysISO(todayISO(), 1) },
            { label: '+1 semana', date: addDaysISO(todayISO(), 7) },
          ].map((q) => (
            <Button key={q.label} size="small" variant="outlined" color="inherit" onClick={() => { onChange?.(q.date); setAnchor(null) }}>
              {q.label}
            </Button>
          ))}
          {value ? (
            <Button size="small" onClick={() => { onChange?.(null); setAnchor(null) }}>
              Limpar
            </Button>
          ) : null}
        </Stack>
      </Popover>
    </>
  )
}

// -------------------------------------------------------------- assignees
const MAX_ASSIGNEE_NAMES = 20

/**
 * Responsáveis de uma tarefa. Aceita pessoas da equipe (com login) e nomes digitados na hora
 * (colaboradores sem acesso ao sistema), sem esperar o servidor: cada clique grava de forma otimista.
 *  · variant "avatars": só os avatares (listas, quadro, tabela) — clique abre o seletor;
 *  · variant "field": nomes em chips e botão "Adicionar responsável" (gaveta da tarefa).
 */
export function AssigneePicker({ task, size = 24, variant = 'avatars', readOnly }: { task: Pick<Task, 'id' | 'assigneeIds' | 'assigneeNames'>; size?: number; variant?: 'avatars' | 'field'; readOnly?: boolean }) {
  const ws = useWorkspace()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [term, setTerm] = useState('')
  // espelho do valor mais recente: cliques rápidos em sequência se compõem em vez de sobrescrever
  const idsRef = useRef<string[]>(task.assigneeIds ?? [])
  const namesRef = useRef<string[]>(task.assigneeNames ?? [])
  idsRef.current = task.assigneeIds ?? []
  namesRef.current = task.assigneeNames ?? []

  const ids = task.assigneeIds ?? []
  const names = task.assigneeNames ?? []
  const people = [...ws.users.filter((u) => ids.includes(u.id)), ...names.map((name) => ({ id: `n:${name}`, name }))]
  const editable = !readOnly
  const open = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()
    setAnchor(e.currentTarget)
  }
  const close = () => {
    setAnchor(null)
    setTerm('')
  }

  const commit = (nextIds: string[], nextNames: string[]) => {
    const patch: Partial<Task> = {}
    if (nextIds !== idsRef.current) {
      idsRef.current = nextIds
      patch.assigneeIds = nextIds
    }
    if (nextNames !== namesRef.current) {
      namesRef.current = nextNames
      patch.assigneeNames = nextNames
    }
    // não aguarda: a lista já foi atualizada de forma otimista e erros aparecem pelo próprio armazenamento
    if (Object.keys(patch).length) void ws.updateTask(task.id, patch)
  }
  const toggleUser = (id: string) => commit(idsRef.current.includes(id) ? idsRef.current.filter((v) => v !== id) : [...idsRef.current, id], namesRef.current)
  const removeName = (name: string) => commit(idsRef.current, namesRef.current.filter((n) => n !== name))
  const addName = (raw: string) => {
    const name = raw.replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!name) return
    const existingUser = ws.users.find((u) => u.name.toLowerCase() === name.toLowerCase())
    if (existingUser) {
      if (!idsRef.current.includes(existingUser.id)) commit([...idsRef.current, existingUser.id], namesRef.current)
    } else if (!namesRef.current.some((n) => n.toLowerCase() === name.toLowerCase()) && namesRef.current.length < MAX_ASSIGNEE_NAMES) {
      commit(idsRef.current, [...namesRef.current, name])
    }
    setTerm('')
  }

  const query = term.trim().toLowerCase()
  const visibleUsers = query ? ws.users.filter((u) => `${u.name} ${u.email ?? ''}`.toLowerCase().includes(query)) : ws.users
  const visibleNames = query ? names.filter((n) => n.toLowerCase().includes(query)) : names
  const exact = query && (ws.users.some((u) => u.name.toLowerCase() === query) || names.some((n) => n.toLowerCase() === query))

  const trigger =
    variant === 'field' ? (
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.75 }}>
        {people.map((p) => (
          <Chip
            key={p.id}
            size="small"
            avatar={<UserAvatar user={p} size={20} />}
            label={p.name}
            onDelete={editable ? () => (p.id.startsWith('n:') ? removeName(p.name) : toggleUser(p.id)) : undefined}
            sx={{ maxWidth: 200 }}
          />
        ))}
        {editable ? (
          <Chip size="small" variant="outlined" color="primary" clickable label={people.length ? '+ Adicionar' : '+ Adicionar responsável'} onClick={open} />
        ) : !people.length ? (
          <Typography variant="body2" color="text.secondary">Sem responsável</Typography>
        ) : null}
      </Stack>
    ) : (
      <Box component="span" onClick={editable ? open : undefined} sx={{ display: 'inline-flex', cursor: editable ? 'pointer' : 'default' }}>
        {people.length ? (
          <AvatarStack users={people} size={size} max={3} />
        ) : (
          <Box sx={{ width: size, height: size, borderRadius: '50%', border: `1.5px dashed ${colors.borderStrong}`, color: colors.textMuted, display: 'grid', placeItems: 'center', fontSize: size * 0.6, lineHeight: 1 }}>+</Box>
        )}
      </Box>
    )

  return (
    <>
      {trigger}
      <Popover open={Boolean(anchor)} onClose={close} anchorEl={anchor} onClick={(e) => e.stopPropagation()} slotProps={{ paper: { sx: { width: 300, maxHeight: 420 } } }}>
        <Box sx={{ p: 1.5, pb: 1 }}>
          <Typography variant="overline" sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.6 }}>
            Responsáveis
          </Typography>
          <TextField
            size="small"
            fullWidth
            autoFocus
            value={term}
            placeholder="Buscar ou digitar um nome…"
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (visibleUsers.length === 1 && !exact && query) toggleUser(visibleUsers[0].id)
                else addName(term)
              }
            }}
          />
        </Box>
        {/* MenuItem só funciona dentro de Menu/MenuList: fora dele o MUI lança erro e derruba a tela */}
        <MenuList dense disablePadding sx={{ maxHeight: 280, overflow: 'auto' }}>
          {visibleUsers.map((u) => (
            <MenuItem key={u.id} dense onClick={() => toggleUser(u.id)}>
              <Checkbox size="small" checked={ids.includes(u.id)} sx={{ p: 0.5, mr: 1 }} />
              <UserAvatar user={u} size={22} />
              <Typography variant="body2" sx={{ ml: 1 }} noWrap>
                {u.name}
              </Typography>
            </MenuItem>
          ))}
          {visibleNames.map((n) => (
            <MenuItem key={`n:${n}`} dense onClick={() => removeName(n)}>
              <Checkbox size="small" checked sx={{ p: 0.5, mr: 1 }} />
              <UserAvatar user={{ id: `n:${n}`, name: n }} size={22} />
              <Typography variant="body2" sx={{ ml: 1 }} noWrap>
                {n}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', pl: 1 }}>
                sem login
              </Typography>
            </MenuItem>
          ))}
          {query && !exact ? (
            <MenuItem dense onClick={() => addName(term)} disabled={names.length >= MAX_ASSIGNEE_NAMES}>
              <Typography variant="body2" sx={{ fontWeight: 600, color: colors.brand }} noWrap>
                + Adicionar “{term.trim()}”
              </Typography>
            </MenuItem>
          ) : null}
        </MenuList>
        {!ws.users.length && !names.length && !query ? (
          <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1.5 }}>
            Nenhum usuário da equipe disponível. Digite o nome de quem vai executar a tarefa e pressione Enter.
          </Typography>
        ) : null}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 1, borderTop: `1px solid ${colors.border}` }}>
          Digite um nome para adicionar alguém que não usa o sistema.
        </Typography>
      </Popover>
    </>
  )
}

export function TagChips({ tags, max = 3 }: { tags?: string[]; max?: number }) {
  if (!tags?.length) return null
  return (
    <Stack direction="row" spacing={0.5}>
      {tags.slice(0, max).map((t) => (
        <Chip key={t} size="small" label={t} sx={{ height: 20, bgcolor: alpha(colors.oak, 0.14), color: '#7c5a38', fontWeight: 600 }} />
      ))}
      {tags.length > max ? <Chip size="small" label={`+${tags.length - max}`} sx={{ height: 20 }} /> : null}
    </Stack>
  )
}

// ----------------------------------------------------------- filter toolbar
export function FilterBar({ extra }: { extra?: ReactNode }) {
  const { filters, setFilters, resetFilters, activeFilterCount, users, tasks, statuses } = useWorkspace()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const allTags = [...new Set(tasks.flatMap((t) => t.tags ?? []))].sort()

  const toggle = (key: 'assignees' | 'priorities' | 'statuses' | 'tags', value: string) =>
    setFilters({ [key]: filters[key].includes(value) ? filters[key].filter((v) => v !== value) : [...filters[key], value] } as never)

  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
      <SearchField value={filters.search} onChange={(v) => setFilters({ search: v })} placeholder="Buscar tarefas…" width={240} />
      <Badge badgeContent={activeFilterCount} color="primary">
        <Button variant="outlined" color="inherit" startIcon={<FilterListIcon />} endIcon={<ArrowDropDownIcon />} onClick={(e) => setAnchor(e.currentTarget)}>
          Filtros
        </Button>
      </Badge>
      <Button
        variant={filters.mine ? 'contained' : 'outlined'}
        color={filters.mine ? 'primary' : 'inherit'}
        onClick={() => setFilters({ mine: !filters.mine })}
      >
        Minhas tarefas
      </Button>
      <Button variant="text" color="inherit" onClick={() => setFilters({ showDone: !filters.showDone })} sx={{ color: 'text.secondary' }}>
        {filters.showDone ? 'Ocultar concluídas' : 'Mostrar concluídas'}
      </Button>
      {activeFilterCount ? (
        <Button size="small" onClick={resetFilters}>
          Limpar filtros
        </Button>
      ) : null}
      <Box sx={{ flex: 1 }} />
      {extra}
      <Popover open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: 340, p: 2, maxHeight: '70vh' } } }}>
        <FilterGroup title="Responsável">
          {users.map((u) => (
            <FilterChip key={u.id} label={u.name} active={filters.assignees.includes(u.id)} onClick={() => toggle('assignees', u.id)} />
          ))}
        </FilterGroup>
        <FilterGroup title="Status">
          {statuses.map((s) => (
            <FilterChip key={s.id} label={s.label} color={s.color} active={filters.statuses.includes(s.id)} onClick={() => toggle('statuses', s.id)} />
          ))}
        </FilterGroup>
        <FilterGroup title="Prioridade">
          {TASK_PRIORITIES.map((p) => (
            <FilterChip key={p.value} label={p.label} color={p.color} active={filters.priorities.includes(p.value)} onClick={() => toggle('priorities', p.value)} />
          ))}
        </FilterGroup>
        <FilterGroup title="Entrega">
          {[
            { v: 'all', l: 'Qualquer' },
            { v: 'overdue', l: 'Atrasadas' },
            { v: 'today', l: 'Hoje' },
            { v: 'week', l: 'Próx. 7 dias' },
            { v: 'none', l: 'Sem data' },
          ].map((o) => (
            <FilterChip key={o.v} label={o.l} active={filters.due === o.v} onClick={() => setFilters({ due: o.v as typeof filters.due })} />
          ))}
        </FilterGroup>
        {allTags.length ? (
          <FilterGroup title="Etiquetas">
            {allTags.map((t) => (
              <FilterChip key={t} label={t} active={filters.tags.includes(t)} onClick={() => toggle('tags', t)} />
            ))}
          </FilterGroup>
        ) : null}
      </Popover>
    </Stack>
  )
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        {title}
      </Typography>
      <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
        {children}
      </Stack>
      <Divider sx={{ mt: 1.5 }} />
    </Box>
  )
}

function FilterChip({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <Chip
      size="small"
      label={label}
      onClick={onClick}
      sx={{
        bgcolor: active ? alpha(color ?? colors.brand, 0.14) : '#fff',
        border: `1px solid ${active ? (color ?? colors.brand) : colors.borderStrong}`,
        color: active ? (color ?? colors.brand) : colors.text,
        fontWeight: active ? 700 : 500,
      }}
    />
  )
}
