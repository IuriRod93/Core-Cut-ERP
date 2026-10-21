import { useEffect, useRef, useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material'

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> }

/** Leitor nativo do navegador (Chrome/Android); sem ele, o jsQR é carregado sob demanda. */
async function createReader(): Promise<(video: HTMLVideoElement, canvas: HTMLCanvasElement) => Promise<string | null>> {
  const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector
  if (Native) {
    try {
      const detector = new Native({ formats: ['qr_code', 'code_128', 'ean_13'] })
      return async (video) => (await detector.detect(video))[0]?.rawValue ?? null
    } catch {
      /* formatos não suportados: usa o jsQR */
    }
  }
  const jsQR = (await import('jsqr')).default
  return async (video, canvas) => {
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null
    const scale = Math.min(1, 640 / Math.max(w, h))
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

/**
 * Lê o QR da etiqueta pela câmera. O campo de texto também recebe leitores de código USB/Bluetooth
 * (eles "digitam" o código e apertam Enter) e a digitação manual do código da ordem.
 */
export function QrScanDialog({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  // a tela de origem re-renderiza a cada segundo (cronômetros): a câmera não pode reiniciar junto
  const resultRef = useRef(onResult)
  resultRef.current = onResult

  useEffect(() => {
    if (!open) return
    setTyped('')
    setCameraError(null)
    let stream: MediaStream | null = null
    let timer = 0
    let stopped = false
    let last = { text: '', at: 0 }
    const run = async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCameraError('Este aparelho não libera a câmera para o navegador. Use o campo abaixo.')
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      } catch {
        return setCameraError('Não foi possível abrir a câmera. Confira a permissão ou use o campo abaixo.')
      }
      if (stopped || !video.current) return stream.getTracks().forEach((t) => t.stop())
      video.current.srcObject = stream
      await video.current.play().catch(() => undefined)
      const read = await createReader()
      const tick = async () => {
        if (stopped || !video.current || !canvas.current) return
        const text = await read(video.current, canvas.current).catch(() => null)
        if (stopped) return
        // segue lendo (várias etiquetas em sequência); a mesma etiqueta parada na frente da câmera não repete
        if (text && (text !== last.text || Date.now() - last.at > 4000)) {
          last = { text, at: Date.now() }
          if (navigator.vibrate) navigator.vibrate(80)
          resultRef.current(text)
          timer = window.setTimeout(tick, 1200)
          return
        }
        timer = window.setTimeout(tick, 250)
      }
      void tick()
    }
    void run()
    return () => {
      stopped = true
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [open])

  // limpa o campo: o leitor de código (ou a pessoa) já pode mandar a próxima etiqueta
  const submit = () => {
    const text = typed.trim()
    if (!text) return
    setTyped('')
    onResult(text)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Ler etiqueta</DialogTitle>
      <DialogContent>
        {cameraError ? (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {cameraError}
          </Typography>
        ) : (
          <Box sx={{ position: 'relative', borderRadius: 2, overflow: 'hidden', bgcolor: '#000', aspectRatio: '1', mb: 2 }}>
            <Box component="video" ref={video} muted playsInline sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <Box sx={{ position: 'absolute', inset: '18%', border: '3px solid rgba(255,255,255,.85)', borderRadius: 2, pointerEvents: 'none' }} />
          </Box>
        )}
        <canvas ref={canvas} hidden />
        <TextField
          fullWidth
          autoFocus={Boolean(cameraError)}
          label="Código da ordem ou da etiqueta"
          placeholder="Ex.: OP-2026-0012"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          helperText="Aponte a câmera para o QR, ou use o leitor de código / digite."
        />
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={submit} disabled={!typed.trim()}>
          Buscar
        </Button>
      </DialogActions>
    </Dialog>
  )
}
