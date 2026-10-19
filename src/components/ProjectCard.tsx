import { Box, Chip, Paper, Tooltip, Typography, alpha } from '@mui/material'
import { Stack } from './Stack'
import { AvatarStack, UserAvatar } from './ui'
import { AttachFileIcon, BusinessIcon, CalendarMonthIcon, CheckCircleIcon, CommentIcon, FactoryIcon, FlagIcon, PaidIcon } from './icons'
import { ENVIRONMENTS, PROJECT_PRIORITIES, optLabel } from '../domain/constants'
import { brl, daysUntil, fmtDate } from '../lib/format'
import { colors } from '../theme'
import type { Project, User } from '../types'

export interface ProjectCardData {
  project: Project
  clientName?: string
  manager?: User
  team: User[]
  stageColor: string
  progress: number
  openTasks: number
  doneTasks: number
  overdueTasks: number
  totalTasks: number
  comments: number
  attachments: number
  production?: { code: string; current: string; done: number; total: number } | null
}

const PRIORITY_COLOR: Record<string, string> = { baixa: '#9aa0a8', media: '#2f6f9f', alta: '#b7791f', urgente: '#c23b3b' }

/** Cartão de projeto no estilo ClickUp, com os dados que importam na marcenaria. */
export function ProjectCard({ data, dragging, onClick }: { data: ProjectCardData; dragging?: boolean; onClick: () => void }) {
  const { project: p } = data
  const days = p.dueDate ? daysUntil(p.dueDate) : null
  const finished = ['entregue', 'garantia'].includes(p.stageId)
  const dueTone = finished ? colors.textSecondary : days === null ? colors.textSecondary : days < 0 ? colors.error : days <= 7 ? colors.warning : colors.textSecondary
  const dueLabel = days === null ? 'Sem prazo' : finished ? fmtDate(p.dueDate, 'dd MMM') : days < 0 ? `${-days} d de atraso` : days === 0 ? 'Entrega hoje' : `${fmtDate(p.dueDate, 'dd MMM')} · ${days} d`
  const env = ENVIRONMENTS.find((e) => e.value === p.environment)
  const inStage = Math.max(0, -(daysUntil(p.stageChangedAt ?? p.createdAt) ?? 0))
  const priorityColor = PRIORITY_COLOR[p.priority] ?? colors.textMuted
  const team = [data.manager, ...data.team.filter((u) => u.id !== data.manager?.id)].filter(Boolean) as User[]

  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        position: 'relative',
        p: 1.75,
        pl: 2.25,
        borderRadius: 3,
        cursor: 'pointer',
        bgcolor: '#fff',
        overflow: 'hidden',
        transition: 'box-shadow .15s, border-color .15s, transform .15s',
        boxShadow: dragging ? '0 14px 32px rgba(30,26,25,0.2)' : '0 1px 2px rgba(30,26,25,0.04)',
        '&:hover': { borderColor: colors.brand, boxShadow: '0 6px 18px rgba(112,6,24,0.10)' },
        '&::before': { content: '""', position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, bgcolor: data.stageColor },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mb: 0.5 }}>
        <Typography variant="caption" sx={{ color: colors.textMuted, fontWeight: 600, letterSpacing: '0.02em' }}>
          {p.code}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {env ? (
          <Chip size="small" label={env.label} sx={{ height: 20, fontSize: 10.5, bgcolor: alpha(env.color ?? '#999', 0.12), color: env.color, border: `1px solid ${alpha(env.color ?? '#999', 0.25)}` }} />
        ) : null}
        <Tooltip title={`Prioridade ${optLabel(PROJECT_PRIORITIES, p.priority).toLowerCase()}`}>
          <FlagIcon sx={{ fontSize: 18, color: priorityColor }} />
        </Tooltip>
      </Stack>

      <Typography variant="subtitle2" sx={{ lineHeight: 1.3, mb: 0.75, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {p.name}
      </Typography>

      {data.clientName ? (
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: colors.textSecondary, mb: 1.25 }}>
          <BusinessIcon sx={{ fontSize: 15 }} />
          <Typography variant="caption" noWrap>
            {data.clientName}
          </Typography>
        </Stack>
      ) : null}

      {p.tags?.length ? (
        <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
          {p.tags.slice(0, 3).map((t) => (
            <Chip key={t} size="small" label={t} sx={{ height: 20, fontSize: 10.5, bgcolor: alpha(colors.oak, 0.14), color: '#7c5a38' }} />
          ))}
        </Stack>
      ) : null}

      <Box sx={{ mb: 1.25 }}>
        <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.4 }}>
          <Typography variant="caption" color="text.secondary">
            {data.totalTasks ? `${data.doneTasks}/${data.totalTasks} tarefas` : 'Sem tarefas'}
            {data.overdueTasks ? <span style={{ color: colors.error, fontWeight: 700 }}> · {data.overdueTasks} atrasada{data.overdueTasks > 1 ? 's' : ''}</span> : null}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            {data.progress}%
          </Typography>
        </Stack>
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: colors.border }}>
          <Box sx={{ height: 6, borderRadius: 3, width: `${data.progress}%`, bgcolor: data.progress >= 100 ? colors.success : colors.brand, transition: 'width .3s' }} />
        </Box>
      </Box>

      {data.production ? (
        <Box sx={{ mb: 1.25, px: 1, py: 0.75, borderRadius: 2, bgcolor: colors.brandTint, border: `1px solid ${colors.brandTint2}` }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <FactoryIcon sx={{ fontSize: 16, color: colors.brand }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: colors.brand }} noWrap>
              {data.production.code}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>
              {data.production.current}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {data.production.done}/{data.production.total}
            </Typography>
          </Stack>
        </Box>
      ) : null}

      <Stack direction="row" spacing={0.75} sx={{ mb: 1.25, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          icon={<CalendarMonthIcon />}
          label={dueLabel}
          sx={{ height: 24, bgcolor: alpha(dueTone, 0.1), color: dueTone, fontWeight: 700, '& .MuiChip-icon': { color: dueTone, fontSize: 15, ml: 0.75 } }}
        />
        {p.contractValue ? (
          <Chip size="small" icon={<PaidIcon />} label={brl(p.contractValue)} sx={{ height: 24, bgcolor: colors.subtle, border: `1px solid ${colors.border}`, '& .MuiChip-icon': { fontSize: 15, ml: 0.75 } }} />
        ) : null}
      </Stack>

      <Box sx={{ borderTop: `1px solid ${colors.border}`, pt: 1.1 }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          {data.manager ? (
            <Tooltip title={`Responsável: ${data.manager.name}`}>
              <Box sx={{ display: 'inline-flex' }}>
                <UserAvatar user={data.manager} size={28} ring />
              </Box>
            </Tooltip>
          ) : null}
          {team.length > 1 ? <AvatarStack users={team.slice(1)} size={24} max={3} /> : null}
          <Box sx={{ flex: 1 }} />
          {data.comments ? (
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: colors.textSecondary }}>
              <CommentIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{data.comments}</Typography>
            </Stack>
          ) : null}
          {data.attachments ? (
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: colors.textSecondary }}>
              <AttachFileIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{data.attachments}</Typography>
            </Stack>
          ) : null}
          {data.openTasks && !data.production ? (
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ color: colors.textSecondary }}>
              <CheckCircleIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{data.openTasks}</Typography>
            </Stack>
          ) : null}
        </Stack>
        <Typography variant="caption" sx={{ display: 'block', mt: 0.75, color: colors.textMuted }}>
          {inStage === 0 ? 'Entrou nesta etapa hoje' : `${inStage} dia${inStage > 1 ? 's' : ''} nesta etapa`}
          {data.manager ? ` · ${data.manager.name.split(' ')[0]}` : ''}
        </Typography>
      </Box>
    </Paper>
  )
}

