import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { useAuth } from '../auth/AuthContext'
import { brandFont } from '../theme'
import { FactoryIcon, ContentCutIcon, Inventory2Icon, TaskAltIcon, VisibilityIcon, LockIcon } from '../components/icons'

const highlights = [
  { icon: <TaskAltIcon />, title: 'Projetos organizados', text: 'Listas, quadro, calendário, cronograma e carga de trabalho.' },
  { icon: <FactoryIcon />, title: 'Produção em escala', text: 'Ordens, roteiros por setor e apontamento no chão de fábrica.' },
  { icon: <ContentCutIcon />, title: 'Plano de corte otimizado', text: 'Aproveitamento de chapas, fitas de borda e custos em reais.' },
  { icon: <Inventory2Icon />, title: 'Catálogo Leo Madeiras', text: 'Chapas, ferragens e fitas com preços em R$ direto no estoque.' },
]

const slides = [
  { src: '/site/amostras-mdf-parede.jpg', title: 'Materiais com preço em reais', text: 'Catálogo Leo Madeiras com +5.500 itens direto no estoque e no orçamento.' },
  { src: '/site/cozinha-branca.jpg', title: 'Da proposta à instalação', text: 'Orçamento, contrato, projeto, produção e entrega no mesmo sistema.' },
  { src: '/site/amostras-mdf.jpg', title: 'Plano de corte que a serra executa', text: 'Cortes de ponta a ponta, etiquetas com QR Code e G-code por chapa.' },
  { src: '/site/fabrica-linha-producao.jpg', title: 'Produção sob controle', text: 'Ordens por setor, apontamento no chão de fábrica e estoque reservado.' },
]

/** Slides em fade na lateral do login (parados para quem prefere menos movimento). */
function useSlideshow(count: number, intervalMs = 6500) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || count < 2) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), intervalMs)
    return () => window.clearInterval(timer)
  }, [count, intervalMs, index])
  return [index, setIndex] as const
}

export function LoginPage() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // volta para a página que a pessoa tentou abrir (ex.: /admin) depois de entrar; só caminhos internos
  const requested = (location.state as { from?: unknown } | null)?.from
  const noticeRaw = (location.state as { notice?: unknown } | null)?.notice
  const notice = typeof noticeRaw === 'string' ? noticeRaw : ''
  const nextParam = new URLSearchParams(location.search).get('next')
  const internal = (value: unknown): value is string => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !['/login', '/cadastro', '/'].includes(value.split('?')[0])
  const destination = internal(nextParam) ? nextParam : internal(requested) ? requested : '/painel'
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [slide, setSlide] = useSlideshow(slides.length)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={user.passwordMustChange ? '/alterar-senha' : destination} replace state={{ from: destination }} />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const u = await login(identifier.trim(), password)
      navigate(u.passwordMustChange ? '/alterar-senha' : destination, { replace: true, state: { from: destination } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1.05fr 1fr' }, bgcolor: '#fff' }}>
      <Box
        sx={{
          display: { xs: 'none', lg: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 7,
          position: 'relative',
          overflow: 'hidden',
          bgcolor: '#13232b',
          color: '#fff',
        }}
      >
        {/* fotos em fade; o degradê garante a leitura do texto */}
        {slides.map((item, i) => (
          <Box
            key={item.src}
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${item.src})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              opacity: i === slide ? 1 : 0,
              transform: i === slide ? 'scale(1.04)' : 'scale(1)',
              transition: 'opacity 1.2s ease, transform 7s ease-out',
            }}
          />
        ))}
        <Box aria-hidden sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(10,22,28,0.78) 0%, rgba(10,22,28,0.55) 38%, rgba(10,22,28,0.9) 100%)' }} />

        <Box sx={{ position: 'relative' }}>
          <Logo height={26} color="#fff" />
        </Box>
        <Box sx={{ position: 'relative', maxWidth: 520 }}>
          <Typography variant="overline" sx={{ color: '#7fd3e6', letterSpacing: '0.16em' }}>
            Marcenaria industrial
          </Typography>
          <Typography sx={{ fontFamily: brandFont, fontSize: '2.6rem', lineHeight: 1.15, fontWeight: 500, mt: 1, mb: 4 }}>
            Da proposta à instalação, tudo em um só lugar.
          </Typography>
          <Stack spacing={2.5}>
            {highlights.map((h) => (
              <Stack key={h.title} direction="row" spacing={2}>
                <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.22)', color: '#7fd3e6', display: 'grid', placeItems: 'center', flexShrink: 0, backdropFilter: 'blur(6px)' }}>
                  {h.icon}
                </Box>
                <Box>
                  <Typography variant="subtitle1" sx={{ color: '#fff' }}>
                    {h.title}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.78)' }}>
                    {h.text}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Stack>
        </Box>
        <Box sx={{ position: 'relative' }}>
          <Typography variant="subtitle2" sx={{ color: '#fff' }} aria-live="polite">
            {slides[slide].title}
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)', display: 'block', mb: 1.5 }}>
            {slides[slide].text}
          </Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            {slides.map((item, i) => (
              <Box
                key={item.src}
                component="button"
                type="button"
                aria-label={`Mostrar: ${item.title}`}
                onClick={() => setSlide(i)}
                sx={{ width: i === slide ? 28 : 10, height: 10, borderRadius: 5, border: 0, p: 0, cursor: 'pointer', bgcolor: i === slide ? '#7fd3e6' : 'rgba(255,255,255,0.4)', transition: 'width 0.3s ease, background 0.3s ease' }}
              />
            ))}
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', ml: 'auto' }}>
              Core Cut ERP · Gestão para marcenaria industrial
            </Typography>
          </Stack>
        </Box>
      </Box>

      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 3, sm: 6 } }}>
        <Box component="form" onSubmit={submit} sx={{ width: '100%', maxWidth: 400 }}>
          <Box sx={{ display: { xs: 'block', lg: 'none' }, mb: 5 }}>
            <Logo height={22} />
          </Box>
          <Typography variant="h3" sx={{ mb: 0.5 }}>
            Acessar o ERP
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3.5 }}>
            Entre com seu usuário e senha para continuar.
          </Typography>
          {notice && !error ? (
            <Alert severity="success" sx={{ mb: 2 }}>
              {notice}
            </Alert>
          ) : null}
          {error ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}
          <Stack spacing={2}>
            <TextField
              label="Usuário ou e-mail"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoFocus
              autoComplete="username"
              required
              size="medium"
            />
            <TextField
              label="Senha"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              size="medium"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShow((s) => !s)} edge="end" aria-label="Mostrar senha">
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy} startIcon={<LockIcon />}>
              {busy ? 'Entrando…' : 'Entrar'}
            </Button>
            <Button type="button" variant="text" size="small" onClick={() => navigate('/esqueci-senha')} sx={{ alignSelf: 'center' }}>
              Esqueci minha senha
            </Button>
            <Button type="button" variant="outlined" size="large" onClick={() => navigate('/cadastro')}>
              Cadastro de empresas
            </Button>
          </Stack>
        </Box>
      </Box>
    </Box>
  )
}
