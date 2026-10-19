import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Snackbar } from '@mui/material'

type Severity = 'success' | 'error' | 'info' | 'warning'

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
  warning: (message: string) => void
}

interface ConfirmOptions {
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

const ToastContext = createContext<ToastApi | null>(null)
const ConfirmContext = createContext<ConfirmFn | null>(null)

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; severity: Severity; key: number } | null>(null)
  const [confirmState, setConfirmState] = useState<(ConfirmOptions & { open: boolean }) | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const show = useCallback((severity: Severity) => (message: string) => setToast({ message, severity, key: Date.now() }), [])
  const toastApi = useMemo<ToastApi>(
    () => ({ success: show('success'), error: show('error'), info: show('info'), warning: show('warning') }),
    [show],
  )

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve
        setConfirmState({ ...options, open: true })
      }),
    [],
  )

  const close = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setConfirmState((s) => (s ? { ...s, open: false } : s))
  }

  return (
    <ToastContext.Provider value={toastApi}>
      <ConfirmContext.Provider value={confirm}>
        {children}
        <Snackbar
          key={toast?.key}
          open={Boolean(toast)}
          autoHideDuration={4500}
          onClose={(_, reason) => reason !== 'clickaway' && setToast(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        >
          {toast ? (
            <Alert severity={toast.severity} variant="filled" onClose={() => setToast(null)} sx={{ minWidth: 280 }}>
              {toast.message}
            </Alert>
          ) : undefined}
        </Snackbar>
        <Dialog open={Boolean(confirmState?.open)} onClose={() => close(false)} maxWidth="xs" fullWidth>
          <DialogTitle>{confirmState?.title}</DialogTitle>
          {confirmState?.message ? (
            <DialogContent>
              <DialogContentText component="div">{confirmState.message}</DialogContentText>
            </DialogContent>
          ) : null}
          <DialogActions>
            <Button onClick={() => close(false)} color="inherit">
              {confirmState?.cancelLabel ?? 'Cancelar'}
            </Button>
            <Button onClick={() => close(true)} variant="contained" color={confirmState?.danger ? 'error' : 'primary'} autoFocus>
              {confirmState?.confirmLabel ?? 'Confirmar'}
            </Button>
          </DialogActions>
        </Dialog>
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  )
}

export const useToast = () => {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast fora do FeedbackProvider')
  return ctx
}

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm fora do FeedbackProvider')
  return ctx
}
