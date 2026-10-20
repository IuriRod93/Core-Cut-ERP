import { Fragment, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  AppBar,
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Toolbar,
  Tooltip,
  Typography,
  alpha,
  useMediaQuery,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { useTheme } from '@mui/material/styles'
import {
  AddIcon,
  EditIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LogoutIcon,
  MenuIcon,
  NotificationsNoneIcon,
  SearchIcon,
  StopIcon,
  TimerIcon,
  WarningAmberIcon,
  ErrorOutlineIcon,
  InfoIcon,
  KeyIcon,
  AdminPanelSettingsIcon,
} from '../components/icons'
import { Logo } from '../brand/Logo'
import { BrowserExtensionDownloadButton, PwaInstallButton } from '../components/PwaInstallButton'
import { useAuth } from '../auth/AuthContext'
import { colors } from '../theme'
import { NAV } from './nav'
import { GlobalSearch } from './GlobalSearch'
import { LocationConsent } from '../components/LocationConsent'
import { ProfileDialog } from '../components/ProfileDialog'
import { UserAvatar } from '../components/ui'
import { useAlerts } from '../domain/alerts'
import { useNotifications } from '../domain/notifications'
import { useTimer } from '../domain/timer'
import { startLiveUpdates, useCollection } from '../lib/store'
import { fmtClock, fmtRelative } from '../lib/format'
import { ROLES } from '../../shared/access.mjs'

const WIDTH = 252
const WIDTH_COLLAPSED = 68

function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { can, user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const platformAdmin = Boolean(user && !user.companyId && user.role === 'admin')
  const items = [
    ...NAV.filter((n) => can(n.module)),
    ...(platformAdmin ? [{ section: 'Plataforma', label: 'Painel Admin', path: '/admin', module: 'dashboard' as const, icon: <AdminPanelSettingsIcon /> }] : []),
  ]
  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ height: 64, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', px: collapsed ? 0 : 2.5, borderBottom: `1px solid ${colors.border}`, cursor: 'pointer' }} onClick={() => navigate('/painel')}>
        {collapsed ? <Logo variant="mono" height={26} /> : <Logo height={17} />}
      </Box>
      <Box component="nav" sx={{ flex: 1, overflowY: 'auto', px: collapsed ? 1 : 1.5, py: 1.5 }}>
        {items.map((item, i) => {
          const newSection = i === 0 || items[i - 1].section !== item.section
          const active = isActive(item.path)
          const button = (
            <Box
              role="link"
              tabIndex={0}
              onClick={() => {
                navigate(item.path)
                onNavigate?.()
              }}
              onKeyDown={(e) => e.key === 'Enter' && navigate(item.path)}
              sx={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                height: 38,
                px: collapsed ? 0 : 1.25,
                justifyContent: collapsed ? 'center' : 'flex-start',
                borderRadius: 2,
                cursor: 'pointer',
                color: active ? colors.brand : colors.textSecondary,
                bgcolor: active ? colors.brandTint : 'transparent',
                fontWeight: active ? 650 : 500,
                fontSize: '0.8125rem',
                outline: 'none',
                transition: 'background-color .12s, color .12s',
                '&:hover': { bgcolor: active ? colors.brandTint2 : alpha(colors.text, 0.045), color: active ? colors.brand : colors.text },
                '&:focus-visible': { boxShadow: `0 0 0 2px ${alpha(colors.brand, 0.35)}` },
                '&::before': active
                  ? { content: '""', position: 'absolute', left: collapsed ? 2 : -12, top: 9, bottom: 9, width: 3, borderRadius: 3, bgcolor: colors.brand }
                  : undefined,
                '& svg': { fontSize: 20 },
              }}
            >
              {item.icon}
              {collapsed ? null : <span>{item.label}</span>}
            </Box>
          )
          return (
            <Fragment key={item.path}>
              {newSection && !collapsed ? (
                <Typography variant="overline" sx={{ display: 'block', px: 1.25, pt: i === 0 ? 0 : 2, pb: 0.5, color: colors.textMuted }}>
                  {item.section}
                </Typography>
              ) : newSection && i > 0 ? (
                <Divider sx={{ my: 1 }} />
              ) : null}
              <Box sx={{ mb: 0.25 }}>
                {collapsed ? (
                  <Tooltip title={item.label} placement="right">
                    {button}
                  </Tooltip>
                ) : (
                  button
                )}
              </Box>
            </Fragment>
          )
        })}
      </Box>
    </Box>
  )
}

function TimerPill() {
  const { running, elapsed, stop } = useTimer()
  const navigate = useNavigate()
  const tasks = useCollection('tasks')
  if (!running) return null
  const task = tasks.byId.get(running.taskId ?? '')
  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ border: `1px solid ${alpha(colors.brand, 0.3)}`, bgcolor: colors.brandTint, borderRadius: 999, pl: 1.25, pr: 0.5, py: 0.25, maxWidth: 320 }}
    >
      <TimerIcon sx={{ fontSize: 18, color: colors.brand }} />
      <Typography
        variant="body2"
        noWrap
        sx={{ fontWeight: 600, maxWidth: 140, cursor: 'pointer' }}
        onClick={() => task && navigate(`/projetos/${task.projectId}?tarefa=${task.id}`)}
      >
        {task?.title ?? 'Tarefa'}
      </Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', color: colors.brand, fontWeight: 700 }}>
        {fmtClock(elapsed)}
      </Typography>
      <IconButton size="small" onClick={() => stop()} sx={{ bgcolor: colors.brand, color: '#fff', '&:hover': { bgcolor: colors.brandDark } }} aria-label="Parar cronômetro">
        <StopIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Stack>
  )
}

export function AppShell() {
  const theme = useTheme()
  const mobile = useMediaQuery(theme.breakpoints.down('md'))
  const { user, company, logout, can } = useAuth()
  const navigate = useNavigate()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('arcoplan.sidebar') === 'collapsed'
    } catch {
      return false
    }
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [userAnchor, setUserAnchor] = useState<HTMLElement | null>(null)
  const [newAnchor, setNewAnchor] = useState<HTMLElement | null>(null)
  const [bellAnchor, setBellAnchor] = useState<HTMLElement | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const alerts = useAlerts()
  const notifs = useNotifications()

  // telas atualizam na hora quando outra pessoa (ou o chão de fábrica) grava algo
  useEffect(() => startLiveUpdates(), [user?.id])

  useEffect(() => {
    try {
      localStorage.setItem('arcoplan.sidebar', collapsed ? 'collapsed' : 'expanded')
    } catch {
      /* ignora */
    }
  }, [collapsed])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const quickCreate = useMemo(
    () =>
      [
        { label: 'Novo projeto', path: '/projetos?novo=1', module: 'projects' as const },
        { label: 'Novo lead', path: '/leads?new=1', module: 'leads' as const },
        { label: 'Novo orçamento', path: '/orcamentos?new=1', module: 'budgets' as const },
        { label: 'Nova ordem de produção', path: '/producao?new=1', module: 'production' as const },
        { label: 'Novo pedido de compra', path: '/compras?new=1', module: 'purchases' as const },
        { label: 'Novo cliente', path: '/clientes?new=1', module: 'clients' as const },
      ].filter((i) => can(i.module)),
    [can],
  )

  const sidebarWidth = collapsed ? WIDTH_COLLAPSED : WIDTH

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {mobile ? (
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} slotProps={{ paper: { sx: { width: WIDTH } } }}>
          <SidebarContent collapsed={false} onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      ) : (
        <Box
          component="aside"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            transition: 'width .2s ease',
            borderRight: `1px solid ${colors.border}`,
            bgcolor: '#fff',
            position: 'sticky',
            top: 0,
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <SidebarContent collapsed={collapsed} />
          </Box>
          <Box sx={{ borderTop: `1px solid ${colors.border}`, p: 1, display: 'flex', justifyContent: collapsed ? 'center' : 'flex-end' }}>
            <Tooltip title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
              <IconButton size="small" onClick={() => setCollapsed((c) => !c)} aria-label="Alternar menu">
                {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" elevation={0} sx={{ bgcolor: alpha('#ffffff', 0.92), backdropFilter: 'blur(10px)', borderBottom: `1px solid ${colors.border}`, color: 'text.primary' }}>
          <Toolbar sx={{ gap: 1.5, minHeight: 64, px: { xs: 1.5, md: 3 } }}>
            {mobile ? (
              <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="Abrir menu">
                <MenuIcon />
              </IconButton>
            ) : null}
            <Box
              onClick={() => setSearchOpen(true)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setSearchOpen(true)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                height: 38,
                width: { xs: 'auto', sm: 340 },
                maxWidth: '100%',
                border: `1px solid ${colors.border}`,
                bgcolor: colors.subtle,
                borderRadius: 2,
                color: colors.textMuted,
                cursor: 'pointer',
                '&:hover': { borderColor: colors.borderStrong },
              }}
            >
              <SearchIcon fontSize="small" />
              <Typography variant="body2" sx={{ flex: 1, display: { xs: 'none', sm: 'block' } }}>
                Buscar em todo o sistema…
              </Typography>
              <Typography variant="caption" sx={{ border: `1px solid ${colors.border}`, borderRadius: 1, px: 0.75, display: { xs: 'none', sm: 'block' } }}>
                Ctrl K
              </Typography>
            </Box>
            <Box sx={{ flex: 1 }} />
            <BrowserExtensionDownloadButton />
            <PwaInstallButton />
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <TimerPill />
            </Box>
            {quickCreate.length ? (
              <>
                <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={(e) => setNewAnchor(e.currentTarget)} sx={{ minHeight: 36 }}>
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>Novo</Box>
                </Button>
                <Menu anchorEl={newAnchor} open={Boolean(newAnchor)} onClose={() => setNewAnchor(null)}>
                  {quickCreate.map((q) => (
                    <MenuItem
                      key={q.path}
                      onClick={() => {
                        setNewAnchor(null)
                        navigate(q.path)
                      }}
                    >
                      {q.label}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            ) : null}
            <Tooltip title="Alertas">
              <IconButton onClick={(e) => setBellAnchor(e.currentTarget)} aria-label="Alertas">
                <Badge badgeContent={alerts.length + notifs.unread} color="primary" max={9}>
                  <NotificationsNoneIcon />
                </Badge>
              </IconButton>
            </Tooltip>
            <Popover
              open={Boolean(bellAnchor)}
              anchorEl={bellAnchor}
              onClose={() => setBellAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{ paper: { sx: { width: 380, maxWidth: '92vw', mt: 1, borderRadius: 3, border: `1px solid ${colors.border}` } } }}
            >
              <Box sx={{ px: 2, py: 1.5, borderBottom: `1px solid ${colors.border}`, display: 'flex', alignItems: 'center' }}>
                <Typography variant="subtitle1" sx={{ flex: 1 }}>
                  Notificações
                </Typography>
                {notifs.unread ? (
                  <Typography variant="caption" onClick={() => void notifs.markRead('all')} sx={{ color: colors.brand, cursor: 'pointer', fontWeight: 600 }}>
                    Marcar todas como lidas
                  </Typography>
                ) : null}
              </Box>
              {notifs.items.slice(0, 8).map((n) => (
                <Box
                  key={n.id}
                  onClick={() => {
                    void notifs.markRead([n.id])
                    setBellAnchor(null)
                    navigate(n.path)
                  }}
                  sx={{ display: 'flex', gap: 1.5, px: 2, py: 1.1, cursor: 'pointer', borderBottom: `1px solid ${colors.border}`, bgcolor: n.readAt ? 'transparent' : colors.brandTint, '&:hover': { bgcolor: colors.subtle } }}
                >
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', mt: 0.9, flexShrink: 0, bgcolor: n.readAt ? 'transparent' : colors.brand }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2">{n.title}</Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                      {n.body}
                    </Typography>
                    <Typography variant="caption" color="text.disabled">
                      {fmtRelative(n.createdAt)}
                    </Typography>
                  </Box>
                </Box>
              ))}
              {alerts.length ? (
                <Box sx={{ px: 2, py: 1, bgcolor: colors.subtle, borderBottom: `1px solid ${colors.border}` }}>
                  <Typography variant="overline" color="text.secondary">
                    Alertas operacionais
                  </Typography>
                </Box>
              ) : null}
              {alerts.length === 0 && notifs.items.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                  Tudo em dia. Nenhum alerta no momento.
                </Typography>
              ) : (
                alerts.map((a) => (
                  <Box
                    key={a.id}
                    onClick={() => {
                      setBellAnchor(null)
                      navigate(a.path)
                    }}
                    sx={{ display: 'flex', gap: 1.5, px: 2, py: 1.25, cursor: 'pointer', borderBottom: `1px solid ${colors.border}`, '&:hover': { bgcolor: colors.subtle } }}
                  >
                    <Box sx={{ color: a.severity === 'error' ? colors.error : a.severity === 'warning' ? colors.warning : colors.info, pt: 0.25 }}>
                      {a.severity === 'error' ? <ErrorOutlineIcon fontSize="small" /> : a.severity === 'warning' ? <WarningAmberIcon fontSize="small" /> : <InfoIcon fontSize="small" />}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2">{a.title}</Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {a.detail}
                      </Typography>
                    </Box>
                  </Box>
                ))
              )}
            </Popover>

            <Tooltip title={user?.name ?? ''}>
              <IconButton onClick={(e) => setUserAnchor(e.currentTarget)} sx={{ p: 0.5 }}>
                <UserAvatar user={user} size={34} />
              </IconButton>
            </Tooltip>
            <Menu anchorEl={userAnchor} open={Boolean(userAnchor)} onClose={() => setUserAnchor(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
              <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
                <Typography variant="subtitle2">{user?.name}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  {user?.email}
                </Typography>
                <Typography variant="caption" color="primary" sx={{ fontWeight: 600 }}>
                  {user ? ROLES[user.role] : ''}
                </Typography>
              </Box>
              <Divider />
              <MenuItem
                onClick={() => {
                  setUserAnchor(null)
                  setProfileOpen(true)
                }}
              >
                <ListItemIcon>
                  <EditIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Meu perfil e foto</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setUserAnchor(null)
                  navigate('/alterar-senha')
                }}
              >
                <ListItemIcon>
                  <KeyIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Alterar senha</ListItemText>
              </MenuItem>
              <MenuItem
                onClick={async () => {
                  setUserAnchor(null)
                  await logout()
                  navigate('/login')
                }}
              >
                <ListItemIcon>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>Sair</ListItemText>
              </MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>

        <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, minWidth: 0, maxWidth: 1680, width: '100%', mx: 'auto' }}>
          {company?.access.warning ? (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={user?.role === 'admin' ? <Button color="inherit" size="small" onClick={() => navigate('/configuracoes?aba=assinatura')}>Regularizar</Button> : undefined}
            >
              {company.access.warning}
            </Alert>
          ) : null}
          <Outlet />
        </Box>
      </Box>
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      {profileOpen ? <ProfileDialog onClose={() => setProfileOpen(false)} /> : null}
      <LocationConsent />
    </Box>
  )
}
