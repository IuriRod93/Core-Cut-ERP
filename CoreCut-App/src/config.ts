import Constants from 'expo-constants'

/** Endereço do servidor do Core Cut. Pode ser trocado em app.json (extra.apiUrl) para testes. */
export const BASE_URL: string = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl?.replace(/\/+$/, '') ?? 'https://www.cutcore.com.br'

export const VERSION_URL = `${BASE_URL}/downloads/app-version.json`
export const DOWNLOAD_PAGE = `${BASE_URL}/app`

export const SIGNUP_URL = `${BASE_URL}/cadastro`
export const FORGOT_URL = `${BASE_URL}/esqueci-senha`
export const HOME_PATH = '/painel'

/** Identifica o aplicativo para o site (some "instalar app" e "baixar extensão"). */
export const APP_UA = 'CoreCutApp/1.0'

/** Depois de quanto tempo em segundo plano o aplicativo pede o rosto de novo. */
export const RELOCK_AFTER_MS = 5 * 60_000
