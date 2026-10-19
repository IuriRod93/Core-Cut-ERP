import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { DownloadIcon } from './icons'
import { Logo } from '../brand/Logo'
import { useToast } from './feedback'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

interface InstallContextValue {
  event: InstallPromptEvent | null
  install: () => Promise<'accepted' | 'dismissed' | null>
}

const InstallContext = createContext<InstallContextValue | null>(null)
const INSTALL_ONBOARDING_KEY = 'core-cut-erp.install-onboarding-dismissed'

/** Dentro do aplicativo Android (WebView do Core Cut): não faz sentido oferecer instalar app nem baixar extensão. */
export const isNativeApp = () => typeof navigator !== 'undefined' && /CoreCutApp/i.test(navigator.userAgent)

function isStandalone() {
  const legacyStandalone = (navigator as Navigator & { standalone?: boolean }).standalone
  return window.matchMedia('(display-mode: standalone)').matches || Boolean(legacyStandalone)
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [event, setEvent] = useState<InstallPromptEvent | null>(null)
  const toast = useToast()

  useEffect(() => {
    if (isStandalone() || isNativeApp()) return

    const onBeforeInstall = (nativeEvent: Event) => {
      nativeEvent.preventDefault()
      setEvent(nativeEvent as InstallPromptEvent)
    }
    const onInstalled = () => setEvent(null)

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async (): Promise<'accepted' | 'dismissed' | null> => {
    const promptEvent = event
    if (!promptEvent) return null
    try {
      await promptEvent.prompt()
      const { outcome } = await promptEvent.userChoice
      setEvent(null)
      return outcome
    } catch (error) {
      setEvent(null)
      toast.error(error instanceof Error ? error.message : 'Não foi possível iniciar a instalação.')
      return null
    }
  }

  return <InstallContext.Provider value={{ event, install }}>{children}</InstallContext.Provider>
}

export function PwaInstallButton() {
  const context = useContext(InstallContext)
  if (!context?.event || isNativeApp()) return null

  return (
    <Button aria-label="Instalar Core Cut ERP" variant="outlined" size="small" startIcon={<DownloadIcon />} onClick={() => void context.install()} sx={{ whiteSpace: 'nowrap' }}>
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        Instalar app
      </Box>
    </Button>
  )
}

export function BrowserExtensionDownloadButton({ fullWidth = false }: { fullWidth?: boolean }) {
  const toast = useToast()
  if (isNativeApp()) return null

  const download = () => toast.success('Baixando o pacote da extensão Chrome/Edge.')

  return (
    <Button
      component="a"
      href="/downloads/core-cut-erp-extension.zip"
      download="core-cut-erp-extension.zip"
      aria-label="Baixar extensão Core Cut ERP para Chrome e Edge"
      variant="contained"
      size={fullWidth ? 'medium' : 'small'}
      fullWidth={fullWidth}
      startIcon={<DownloadIcon />}
      onClick={download}
      sx={{ whiteSpace: 'nowrap', textDecoration: 'none' }}
    >
      Baixar extensão
    </Button>
  )
}

/** Páginas públicas onde o convite de instalação não deve interromper o visitante. */
const PUBLIC_PATHS = ['/', '/app', '/cadastro', '/esqueci-senha', '/redefinir-senha', '/assinatura', '/termos', '/privacidade', '/admin', '/admin/teste-pagamento']

export function PwaFirstVisitDialog() {
  const context = useContext(InstallContext)
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (isStandalone()) {
      localStorage.setItem(INSTALL_ONBOARDING_KEY, 'dismissed')
      return
    }
    setOpen(localStorage.getItem(INSTALL_ONBOARDING_KEY) !== 'dismissed')

    const onInstalled = () => {
      localStorage.setItem(INSTALL_ONBOARDING_KEY, 'dismissed')
      setOpen(false)
    }
    window.addEventListener('appinstalled', onInstalled)
    return () => window.removeEventListener('appinstalled', onInstalled)
  }, [])

  const close = () => {
    localStorage.setItem(INSTALL_ONBOARDING_KEY, 'dismissed')
    setOpen(false)
  }

  const install = async () => {
    if (!context?.event) return
    const outcome = await context.install()
    if (outcome) close()
  }

  return (
    <Dialog open={open && !isNativeApp() && !PUBLIC_PATHS.includes(pathname) && !pathname.startsWith('/acompanhar/')} onClose={close} aria-labelledby="pwa-install-title" maxWidth="xs" fullWidth>
      <DialogTitle id="pwa-install-title">
        <Logo height={34} />
        <Typography component="span" variant="h6" sx={{ display: 'block', mt: 1 }}>
          Baixe a extensão Core Cut ERP
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Adicione um botão ao Chrome ou Edge para abrir o sistema. Baixe o pacote e siga as instruções incluídas para instalar. O endereço do servidor poderá ser configurado na extensão quando estiver disponível.
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Por segurança, a extensão é adicionada manualmente pelo modo de desenvolvedor. A publicação nas lojas oficiais é uma etapa separada.
        </Typography>
        <Box sx={{ mt: 2 }}>
          <BrowserExtensionDownloadButton fullWidth />
        </Box>
        {context?.event ? (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Ou instale o Core Cut ERP como aplicativo web (PWA), sem extensão:
            </Typography>
            <Button variant="outlined" fullWidth startIcon={<DownloadIcon />} onClick={() => void install()}>
              Instalar como aplicativo
            </Button>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={close} color="inherit">
          Continuar no navegador
        </Button>
      </DialogActions>
    </Dialog>
  )
}
