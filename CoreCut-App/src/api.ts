import * as Device from 'expo-device'
import * as Application from 'expo-application'
import { BASE_URL } from './config'

/** Identifica o aplicativo e o aparelho para o registro de acessos do Painel Admin. */
// Cabeçalhos HTTP só aceitam ASCII: acentos e símbolos (como "·") fazem o Android recusar a requisição.
const ascii = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '-')
    .slice(0, 80)
const CLIENT = ascii(`corecut-app/${Application.nativeApplicationVersion ?? '1.0'} (${[Device.modelName ?? 'Android', Device.osVersion ? `Android ${Device.osVersion}` : ''].filter(Boolean).join(' - ')})`)

export class ApiError extends Error {
  status: number
  /** motivo técnico (aparece em letras pequenas na tela de entrada, para facilitar o suporte) */
  detail?: string
  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

export interface SessionPayload {
  token: string
  user: { id: string; name: string; email: string; role: string }
  modules?: string[]
  company?: { name?: string; access?: { allowed: boolean; message?: string } } | null
  face?: boolean
}

export interface LoginStart {
  faceRequired: true
  enrolled: boolean
  ticket: string
  name: string
  consentVersion: string
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown, token?: string | null): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  let response: Response
  try {
    response = await fetch(`${BASE_URL}/api${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        'X-Client': CLIENT,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (error) {
    throw new ApiError(0, 'Sem conexão com o servidor. Confira a internet e tente de novo.', `${BASE_URL} - ${String((error as Error)?.message ?? error).slice(0, 120)}`)
  } finally {
    clearTimeout(timer)
  }
  let data: unknown = null
  try {
    data = await response.json()
  } catch {
    /* corpo vazio */
  }
  if (!response.ok) {
    const serverMessage = (data as { error?: string } | null)?.error
    // a rota do aplicativo ainda não existe no servidor (versão antiga): 401 "Sessão expirada" sem ter entrado
    if (path === '/mobile/login' && response.status === 401 && /Sessão expirada/i.test(serverMessage ?? '')) {
      throw new ApiError(response.status, 'O servidor do Core Cut ainda não foi atualizado para o aplicativo. Avise o administrador para publicar a nova versão.')
    }
    if (path.startsWith('/mobile/') && response.status === 404) {
      throw new ApiError(response.status, 'O servidor do Core Cut ainda não foi atualizado para o aplicativo.')
    }
    throw new ApiError(response.status, serverMessage ?? `Não foi possível concluir (erro ${response.status}). Tente novamente.`)
  }
  return data as T
}

/** Confere se o aparelho alcança o servidor (usado no botão "Testar conexão" da tela de entrada). */
export async function pingServer(): Promise<{ ok: boolean; text: string }> {
  const started = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    const response = await fetch(`${BASE_URL}/api/health`, { signal: controller.signal, headers: { 'X-Client': CLIENT } })
    clearTimeout(timer)
    const data = (await response.json().catch(() => null)) as { status?: string; database?: string } | null
    if (!response.ok || data?.status !== 'ok') return { ok: false, text: `O servidor respondeu com erro ${response.status}.` }
    return { ok: true, text: `Conectado ao servidor do Core Cut (${BASE_URL.replace(/^https?:\/\//, '')}) em ${Date.now() - started} ms.` }
  } catch (error) {
    return { ok: false, text: `Não alcançou ${BASE_URL}: ${String((error as Error)?.message ?? error).slice(0, 100)}` }
  }
}

export const api = {
  /** Usuário e senha. Quando estão corretos, o servidor devolve o tíquete para a etapa do rosto. */
  login: (login: string, password: string, device: { name: string; platform: string; version: string }) =>
    request<LoginStart>('POST', '/mobile/login', { login, password, device }),
  enroll: (ticket: string, image: string, extra: { consent: boolean }) =>
    request<SessionPayload>('POST', '/mobile/face/enroll', { ticket, image, ...extra }),
  verify: (ticket: string, image: string) => request<SessionPayload>('POST', '/mobile/face/verify', { ticket, image }),
  recheck: (token: string, image: string) => request<{ ok: true }>('POST', '/mobile/face/recheck', { image }, token),
  faceStatus: (token: string) => request<{ enrolled: boolean }>('GET', '/mobile/face/status', undefined, token),
  me: (token: string) => request<Pick<SessionPayload, 'user' | 'company' | 'modules'>>('GET', '/auth/me', undefined, token),
  logout: (token: string) => request<{ ok: true }>('POST', '/auth/logout', {}, token).catch(() => null),
}
