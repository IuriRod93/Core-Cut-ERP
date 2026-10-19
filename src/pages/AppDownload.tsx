import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link as RouterLink, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, CircularProgress, Link, Typography } from '@mui/material'
import qrcode from 'qrcode-generator'
import { Stack } from '../components/Stack'
import { Logo } from '../brand/Logo'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { colors } from '../theme'

interface AppInfo {
  eligible: boolean
  reason: 'plano' | 'pagamento' | 'empresa' | null
  message?: string
  planName: string | null
  available: boolean
  version: { versionName: string; versionCode: number; sizeBytes: number; sha256: string; builtAt: string } | null
}

const sizeLabel = (bytes: number) => `${Math.round(bytes / 1_048_576)} MB`

/** QR code em SVG (sem imagem externa): aponta para esta página, que já inicia o download depois do login. */
function Qr({ value, size = 220 }: { value: string; size?: number }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(value)
    qr.make()
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
  }, [value])
  return <Box role="img" aria-label="QR code para baixar o aplicativo" sx={{ width: size, height: size, '& svg': { width: '100%', height: '100%', display: 'block' } }} dangerouslySetInnerHTML={{ __html: svg }} />
}

/**
 * Download do aplicativo Android. É um direito dos planos Profissional e Industrial: exige login, confere o plano
 * no servidor e só então gera um link temporário para o arquivo (que não fica na pasta pública).
 */
export function AppDownloadPage() {
  const { user, loading: authLoading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  const pageUrl = `${window.location.origin}/app?baixar=1`

  useEffect(() => {
    document.title = 'Baixar o aplicativo Core Cut'
  }, [])

  useEffect(() => {
    if (!user) return
    api
      .get<AppInfo>('/mobile/app-info')
      .then(setInfo)
      .catch((e) => setError(e instanceof Error ? e.message : 'Não foi possível consultar o aplicativo.'))
  }, [user])

  const download = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const link = await api.post<{ url: string }>('/mobile/download-link', {})
      window.location.href = link.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível iniciar o download.')
    } finally {
      setBusy(false)
    }
  }, [])

  // QR lido no celular Android: depois do login, o download começa sozinho
  const [auto, setAuto] = useState(false)
  useEffect(() => {
    if (auto || params.get('baixar') !== '1' || !isAndroid || !info?.eligible || !info.available) return
    setAuto(true)
    void download()
  }, [auto, params, isAndroid, info, download])

  if (authLoading) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }
  // quem ainda não entrou vai para o login e volta para cá
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(`/app${location.search}`)}`} replace />

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: colors.bg, py: { xs: 3, sm: 6 }, px: 2 }}>
      <Box sx={{ maxWidth: 760, mx: 'auto' }}>
        <Box sx={{ mb: 3 }}>
          <Link component={RouterLink} to="/painel" underline="none" aria-label="Voltar ao sistema">
            <Logo height={26} />
          </Link>
        </Box>

        <Box sx={{ bgcolor: '#fff', border: `1px solid ${colors.border}`, borderRadius: 3, p: { xs: 2.5, sm: 4 } }}>
          <Typography variant="overline" color="primary">
            Aplicativo Android
          </Typography>
          <Typography variant="h3" sx={{ mb: 1 }}>
            Core Cut ERP no seu celular
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            O mesmo sistema da empresa, com os mesmos dados e permissões, e a confirmação por rosto ao entrar.
          </Typography>

          {!info && !error ? (
            <Stack alignItems="center" sx={{ py: 3 }}>
              <CircularProgress size={28} />
            </Stack>
          ) : null}

          {info && !info.eligible ? (
            <Alert
              severity="info"
              action={
                info.reason === 'plano' || info.reason === 'pagamento' ? (
                  <Button color="inherit" size="small" onClick={() => navigate('/configuracoes?aba=assinatura')}>
                    {info.reason === 'plano' ? 'Ver planos' : 'Assinatura'}
                  </Button>
                ) : undefined
              }
            >
              {info.message ?? 'O aplicativo não está disponível para a sua empresa.'}
              {info.reason === 'plano' ? ` Seu plano atual: ${info.planName ?? '—'}.` : ''}
            </Alert>
          ) : null}

          {info?.eligible ? (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} alignItems={{ sm: 'center' }}>
                <Box sx={{ p: 1.5, border: `1px solid ${colors.border}`, borderRadius: 2, alignSelf: { xs: 'center', sm: 'flex-start' } }}>
                  <Qr value={pageUrl} />
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}>
                    Aponte a câmera do celular
                  </Typography>
                </Box>

                <Box sx={{ flex: 1 }}>
                  {info.available ? (
                    <>
                      <Button variant="contained" size="large" fullWidth onClick={() => void download()} disabled={busy}>
                        {busy ? 'Preparando…' : `Baixar o aplicativo${info.version ? ` (${sizeLabel(info.version.sizeBytes)})` : ''}`}
                      </Button>
                      {info.version ? (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                          Versão {info.version.versionName} · Android 7 ou mais novo · plano {info.planName}
                        </Typography>
                      ) : null}
                    </>
                  ) : (
                    <Alert severity="warning">O arquivo do aplicativo ainda não foi publicado neste servidor. Peça ao administrador para publicar a versão.</Alert>
                  )}
                  {!isAndroid ? (
                    <Alert severity="info" sx={{ mt: 2 }}>
                      Para instalar, leia o QR code com o celular Android (ele pede o login e baixa o aplicativo) ou abra esta página nele.
                    </Alert>
                  ) : null}
                </Box>
              </Stack>

              <Typography variant="h5" sx={{ mt: 4, mb: 1 }}>
                Como instalar
              </Typography>
              <Box component="ol" sx={{ m: 0, pl: 3, '& li': { mb: 1 } }}>
                <li>Toque em <b>Baixar o aplicativo</b> (ou leia o QR code).</li>
                <li>Abra o arquivo baixado. Se o Android perguntar, permita <b>instalar apps desta fonte</b> para o navegador.</li>
                <li>Toque em <b>Instalar</b> e depois em <b>Abrir</b>.</li>
                <li>Entre com o mesmo usuário e senha do sistema.</li>
                <li>No primeiro acesso, cadastre o rosto. Nos próximos, o aplicativo confirma que é você.</li>
              </Box>

              {info.version?.sha256 ? (
                <Box sx={{ mt: 3 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Impressão digital do arquivo (SHA-256), para conferir a integridade:
                  </Typography>
                  <Typography variant="caption" sx={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
                    {info.version.sha256}
                  </Typography>
                </Box>
              ) : null}
            </>
          ) : null}

          {error ? (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          ) : null}
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
          <Link component={RouterLink} to="/painel">
            Voltar ao sistema
          </Link>
        </Typography>
      </Box>
    </Box>
  )
}
