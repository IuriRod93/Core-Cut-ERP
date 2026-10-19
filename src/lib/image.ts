/** Recorta (quadrado, centralizado) e reduz uma imagem para foto de perfil; devolve um JPEG leve. */
export async function resizeToAvatar(file: File, size = 320): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Imagem inválida.'))), 'image/jpeg', 0.86))
  return new File([blob], 'foto.jpg', { type: 'image/jpeg' })
}

/** Reduz o logotipo da empresa (máx. 900×360) mantendo proporção e transparência; devolve um PNG leve. */
export async function resizeToLogo(file: File, maxW = 900, maxH = 360): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height)
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Imagem inválida.'))), 'image/png'))
  return new File([blob], 'logotipo.png', { type: 'image/png' })
}

/** Lê o logotipo salvo no sistema e o devolve como PNG (data URL) com a proporção largura/altura, para os PDFs. */
export async function loadLogoDataUrl(url: string, heightPx = 160): Promise<{ data: string; ratio: number }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Logotipo indisponível.')
  const bitmap = await createImageBitmap(await response.blob())
  const ratio = Math.min(Math.max(bitmap.width / bitmap.height, 0.4), 4.5)
  const canvas = document.createElement('canvas')
  canvas.height = heightPx
  canvas.width = Math.round(heightPx * ratio)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return { data: canvas.toDataURL('image/png'), ratio }
}

/** Reduz uma foto para no máximo `max` px no maior lado (sem cortar) e devolve um JPEG leve. */
export async function resizeToMax(file: File, max = 1000, quality = 0.84): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Imagem inválida.'))), 'image/jpeg', quality))
  return new File([blob], 'foto.jpg', { type: 'image/jpeg' })
}
