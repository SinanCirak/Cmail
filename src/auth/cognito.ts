const STORAGE_SESSION = 'cmail-auth-session'
const STORAGE_PKCE = 'cmail-auth-pkce'

type AuthSettings = {
  region: string
  domain: string
  clientId: string
  redirectUri: string
  logoutUri: string
}

export type AuthSession = {
  accessToken: string
  idToken: string
  refreshToken?: string
  expiresAt: number
}

function readEnv(name: string): string {
  const value = import.meta.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function loadSettings(): AuthSettings {
  const region = readEnv('VITE_COGNITO_REGION')
  const domain = readEnv('VITE_COGNITO_DOMAIN')
  const clientId = readEnv('VITE_COGNITO_CLIENT_ID')
  const redirectUri = readEnv('VITE_COGNITO_REDIRECT_URI')
  const logoutUri = readEnv('VITE_COGNITO_LOGOUT_URI')
  return { region, domain, clientId, redirectUri, logoutUri }
}

function ensureSettings(settings: AuthSettings): string | null {
  if (!settings.region) return 'VITE_COGNITO_REGION is missing.'
  if (!settings.domain) return 'VITE_COGNITO_DOMAIN is missing.'
  if (!settings.clientId) return 'VITE_COGNITO_CLIENT_ID is missing.'
  if (!settings.redirectUri) return 'VITE_COGNITO_REDIRECT_URI is missing.'
  if (!settings.logoutUri) return 'VITE_COGNITO_LOGOUT_URI is missing.'
  return null
}

function randomString(length = 64): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const arr = new Uint8Array(length)
  crypto.getRandomValues(arr)
  return Array.from(arr, (x) => chars[x % chars.length]).join('')
}

function base64UrlEncode(bytes: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...bytes))
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function createPkcePair() {
  const verifier = randomString(96)
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const challenge = base64UrlEncode(new Uint8Array(digest))
  return { verifier, challenge }
}

function savePkceVerifier(verifier: string) {
  sessionStorage.setItem(STORAGE_PKCE, verifier)
}

function loadPkceVerifier(): string {
  const verifier = sessionStorage.getItem(STORAGE_PKCE)
  if (!verifier) throw new Error('Sign-in state not found. Please try again.')
  sessionStorage.removeItem(STORAGE_PKCE)
  return verifier
}

export function hasAuthSettings(): boolean {
  return ensureSettings(loadSettings()) == null
}

export function getSettingsError(): string | null {
  return ensureSettings(loadSettings())
}

export async function loginWithCognito() {
  const settings = loadSettings()
  const validation = ensureSettings(settings)
  if (validation) throw new Error(validation)

  const { verifier, challenge } = await createPkcePair()
  savePkceVerifier(verifier)

  const authUrl = new URL(`${settings.domain}/oauth2/authorize`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', settings.clientId)
  authUrl.searchParams.set('redirect_uri', settings.redirectUri)
  authUrl.searchParams.set('scope', 'openid email profile')
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('code_challenge', challenge)

  window.location.assign(authUrl.toString())
}

export async function exchangeCodeForTokens(code: string): Promise<AuthSession> {
  const settings = loadSettings()
  const validation = ensureSettings(settings)
  if (validation) throw new Error(validation)

  const verifier = loadPkceVerifier()
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: settings.clientId,
    code,
    redirect_uri: settings.redirectUri,
    code_verifier: verifier,
  })

  const res = await fetch(`${settings.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Token exchange failed: ${text || res.status}`)
  }

  const payload = (await res.json()) as {
    access_token: string
    id_token: string
    refresh_token?: string
    expires_in: number
  }

  return {
    accessToken: payload.access_token,
    idToken: payload.id_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + payload.expires_in * 1000,
  }
}

export function saveSession(session: AuthSession) {
  localStorage.setItem(STORAGE_SESSION, JSON.stringify(session))
}

/**
 * Use for API Gateway + Lambda: Cognito **access** tokens often omit `email`; **ID** tokens include it.
 */
export function getBearerTokenForApi(session: AuthSession): string {
  return session.idToken
}

export function getSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_SESSION)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthSession
    if (!parsed.accessToken || !parsed.idToken || !parsed.expiresAt) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSession() {
  localStorage.removeItem(STORAGE_SESSION)
}

export function isSessionValid(session: AuthSession): boolean {
  return Date.now() < session.expiresAt - 30_000
}

export function logoutFromCognito() {
  const settings = loadSettings()
  const validation = ensureSettings(settings)
  if (validation) return

  const logoutUrl = new URL(`${settings.domain}/logout`)
  logoutUrl.searchParams.set('client_id', settings.clientId)
  logoutUrl.searchParams.set('logout_uri', settings.logoutUri)
  window.location.assign(logoutUrl.toString())
}
