import { type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { Box, Button, Chip, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { useAuth } from '../auth/AuthContext'
import { colors } from '../theme'

const links = [
  { to: '/admin', label: 'Painel', end: true },
  { to: '/admin/teste-pagamento', label: 'Teste de pagamento', end: false },
]

/** Moldura própria do Painel Admin: não carrega o menu do ERP. */
export function PlatformShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: colors.bg, display: 'flex', flexDirection: 'column' }}>
      <Box component="header" sx={{ bgcolor: '#13232b', color: '#fff', px: { xs: 2, md: 3 }, height: 60, display: 'flex', alignItems: 'center', gap: 2, position: 'sticky', top: 0, zIndex: 20 }}>
        <Box onClick={() => navigate('/admin')} sx={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Logo height={22} color="#fff" />
          <Chip size="small" label="Painel Admin" sx={{ bgcolor: 'rgba(127,211,230,0.18)', color: '#7fd3e6', fontWeight: 700 }} />
        </Box>
        <Stack direction="row" spacing={0.5} sx={{ ml: { xs: 0, md: 3 }, flex: 1, overflowX: 'auto' }}>
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} end={link.end} style={{ textDecoration: 'none' }}>
              {({ isActive }) => (
                <Box sx={{ px: 1.5, py: 0.75, borderRadius: 2, fontSize: '0.875rem', fontWeight: 600, whiteSpace: 'nowrap', color: isActive ? '#fff' : '#9fb4bd', bgcolor: isActive ? 'rgba(255,255,255,0.12)' : 'transparent', '&:hover': { color: '#fff' } }}>
                  {link.label}
                </Box>
              )}
            </NavLink>
          ))}
        </Stack>
        <Typography variant="body2" sx={{ color: '#9fb4bd', display: { xs: 'none', md: 'block' } }}>{user?.email}</Typography>
        <Button size="small" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.35)' }} variant="outlined" onClick={() => navigate('/painel')}>
          Abrir o ERP
        </Button>
        <Button
          size="small"
          sx={{ color: '#fff' }}
          onClick={async () => {
            await logout()
            navigate('/login')
          }}
        >
          Sair
        </Button>
      </Box>
      <Box component="main" sx={{ flex: 1, p: { xs: 2, md: 3 }, width: '100%', maxWidth: 1480, mx: 'auto' }}>
        {children}
      </Box>
    </Box>
  )
}
