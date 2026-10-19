import { tokenStore } from './api'

const seen = new Set<string>()
let sent = 0
const MAX_REPORTS_PER_PAGE_LOAD = 8

/**
 * Avisa o servidor que uma tela quebrou no navegador do usuário. Os relatos aparecem em
 * Painel Admin → Monitoramento → "Erros do navegador". Nunca lança: falhar ao relatar não pode piorar o erro.
 */
export function reportClientError(error: unknown, where = 'tela') {
  try {
    if (sent >= MAX_REPORTS_PER_PAGE_LOAD) return
    const token = tokenStore.get()
    if (!token) return
    const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error) ?? 'erro desconhecido'
    const key = `${window.location.pathname}|${message}`
    if (seen.has(key)) return
    seen.add(key)
    sent += 1
    const stack = error instanceof Error ? (error.stack ?? '') : ''
    void fetch('/api/auth/client-error', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message: message.slice(0, 300), stack: stack.slice(0, 900), page: window.location.pathname, where }),
    }).catch(() => undefined)
  } catch {
    /* sem relato */
  }
}

/** Captura exceções de script e promessas rejeitadas fora do React. */
export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    // ruído do navegador (ResizeObserver) não é erro do sistema
    if (/ResizeObserver loop/i.test(event.message ?? '')) return
    reportClientError(event.error ?? event.message, 'script')
  })
  window.addEventListener('unhandledrejection', (event) => reportClientError(event.reason, 'promessa'))
}
