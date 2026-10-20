const TOKEN_KEY = 'arcoplan.token'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY)
    } catch {
      return null
    }
  },
  set(token: string | null) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token)
      else localStorage.removeItem(TOKEN_KEY)
    } catch {
      /* armazenamento indisponível */
    }
  },
}

type Listener = () => void
const unauthorizedListeners = new Set<Listener>()
export const onUnauthorized = (fn: Listener) => {
  unauthorizedListeners.add(fn)
  return () => unauthorizedListeners.delete(fn)
}

async function request<T>(method: string, path: string, body?: unknown, init?: { raw?: BodyInit; headers?: Record<string, string> }): Promise<T> {
  const token = tokenStore.get()
  const headers: Record<string, string> = { ...(init?.headers ?? {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: BodyInit | undefined = init?.raw
  if (body !== undefined && payload === undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let response: Response
  // falha de rede: uma segunda tentativa só para leituras e para o login (nada é gravado antes da resposta)
  const retryable = method === 'GET' || path.startsWith('/auth/login')
  for (let attempt = 0; ; attempt += 1) {
    try {
      response = await fetch(`/api${path}`, { method, headers, body: payload })
      break
    } catch {
      if (retryable && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 700))
        continue
      }
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false
      throw new ApiError(
        0,
        offline
          ? 'Sem internet neste aparelho. Conecte-se e tente novamente.'
          : `Não foi possível falar com o servidor (${window.location.host}). Atualize a página com Ctrl+F5 e tente de novo; se continuar, abra https://www.cutcore.com.br diretamente.`,
      )
    }
  }
  const text = await response.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }
  if (!response.ok) {
    const message =
      typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : `Erro ${response.status}`
    if (response.status === 401 && !path.startsWith('/auth/login')) unauthorizedListeners.forEach((fn) => fn())
    throw new ApiError(response.status, message)
  }
  return data as T
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, body ?? {}, headers ? { headers } : undefined),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T,>(path: string, headers?: Record<string, string>) => request<T>('DELETE', path, undefined, headers ? { headers } : undefined),
  upload: <T,>(path: string, file: File) =>
    request<T>('POST', path, undefined, { raw: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } }),
}

export const fileUrl = (id: string, opts: { inline?: boolean } = {}) =>
  `/api/files/${id}/download?token=${encodeURIComponent(tokenStore.get() ?? '')}${opts.inline ? '&inline=1' : ''}`
