import { logoPng } from '../domain/pdf'
import type { CompanySettings } from '../types'

/**
 * Logo da empresa em preto e branco para documentos fiscais (DANFE sai monocromático).
 * Usa o logotipo enviado em Configurações → Empresa; sem ele, a marca do sistema.
 * Fundo transparente vira branco e as cores viram tons de cinza com contraste reforçado.
 */
export async function logoBlackWhite(company?: Pick<CompanySettings, 'logoFileId'> | null, heightPx = 160): Promise<{ data: string; ratio: number } | null> {
  try {
    const logo = await logoPng(heightPx, company)
    const img = new Image()
    img.src = logo.data
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || Math.round(heightPx * logo.ratio)
    canvas.height = img.naturalHeight || heightPx
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return null
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(img, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    const d = pixels.data
    for (let i = 0; i < d.length; i += 4) {
      const luminance = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
      // contraste: abaixo de 40 vira preto, acima de 215 vira branco, o resto fica em cinza
      const value = Math.max(0, Math.min(255, ((luminance - 40) / (215 - 40)) * 255))
      d[i] = d[i + 1] = d[i + 2] = value
      d[i + 3] = 255
    }
    context.putImageData(pixels, 0, 0)
    return { data: canvas.toDataURL('image/png'), ratio: canvas.width / canvas.height }
  } catch {
    return null
  }
}
