import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { CssBaseline, ThemeProvider } from '@mui/material'
import '@fontsource-variable/inter'
import '@fontsource/jost/400.css'
import '@fontsource/jost/500.css'
import '@fontsource/jost/600.css'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import { FeedbackProvider } from './components/feedback'
import { PwaFirstVisitDialog, PwaInstallProvider } from './components/PwaInstallButton'
import { theme } from './theme'
import { registerSW } from 'virtual:pwa-register'
import { installGlobalErrorReporting } from './lib/errorReport'

// O domínio sem "www" só redireciona para o endereço oficial; uma página aberta nele (aba antiga, atalho, PWA
// instalado) não consegue chamar a API por causa do redirecionamento. Vai direto para o endereço oficial.
if (window.location.hostname === 'cutcore.com.br') {
  window.location.replace(`https://www.cutcore.com.br${window.location.pathname}${window.location.search}${window.location.hash}`)
}

registerSW({ immediate: true })
installGlobalErrorReporting()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <FeedbackProvider>
        <PwaInstallProvider>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
            <PwaFirstVisitDialog />
          </BrowserRouter>
        </PwaInstallProvider>
      </FeedbackProvider>
    </ThemeProvider>
  </StrictMode>,
)
