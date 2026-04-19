const STORAGE_SESSION = 'cmail-auth-session'
const STORAGE_PKCE = 'cmail-auth-pkce'

type AuthSettings = {
  region: string
  domain: string
  clientId: string
  redirectUri: string
  logoutUri: string
  userPoolId: string
}

type JwtClaims = Record<string, unknown>

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
  const userPoolId = readEnv('VITE_COGNITO_USER_POOL_ID')
  return { region, domain, clientId, redirectUri, logoutUri, userPoolId }
}

function ensureSettings(settings: AuthSettings): string | null {
  if (!settings.region) return 'VITE_COGNITO_REGION is missing.'
  if (!settings.domain) return 'VITE_COGNITO_DOMAIN is missing.'
  if (!settings.clientId) return 'VITE_COGNITO_CLIENT_ID is missing.'
  if (!settings.redirectUri) return 'VITE_COGNITO_REDIRECT_URI is missing.'
  if (!settings.logoutUri) return 'VITE_COGNITO_LOGOUT_URI is missing.'
  if (!settings.userPoolId) return 'VITE_COGNITO_USER_POOL_ID is missing.'
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

/** Native app client sign-in (SRP). User stays on your domain — no Hosted UI redirect. */
export async function signInWithPassword(username: string, password: string): Promise<AuthSession> {
  const { AuthenticationDetails, CognitoUser, CognitoUserPool } = await import(
    'amazon-cognito-identity-js'
  )

  const settings = loadSettings()
  const validation = ensureSettings(settings)
  if (validation) throw new Error(validation)

  const trimmed = username.trim()
  if (!trimmed || !password) throw new Error('Enter email and password.')

  const poolData = {
    UserPoolId: settings.userPoolId,
    ClientId: settings.clientId,
  }
  const userPool = new CognitoUserPool(poolData)
  const cognitoUser = new CognitoUser({
    Username: trimmed,
    Pool: userPool,
  })
  const authDetails = new AuthenticationDetails({
    Username: trimmed,
    Password: password,
  })

  return new Promise((resolve, reject) => {
    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        resolve({
          accessToken: session.getAccessToken().getJwtToken(),
          idToken: session.getIdToken().getJwtToken(),
          refreshToken: session.getRefreshToken()?.getToken(),
          expiresAt: session.getIdToken().getExpiration() * 1000,
        })
      },
      onFailure: (err) => {
        const msg =
          typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: string }).message)
            : 'Sign-in failed.'
        reject(new Error(msg))
      },
      newPasswordRequired: () => {
        reject(new Error('You must set a new password before signing in.'))
      },
      mfaRequired: () => {
        reject(new Error('MFA is enabled for this account but is not supported in this app yet.'))
      },
      totpRequired: () => {
        reject(new Error('MFA is enabled for this account but is not supported in this app yet.'))
      },
    })
  })
}

/** Legacy Hosted UI redirect (long Cognito URL). Prefer {@link signInWithPassword}. */
export async function loginWithCognitoHostedUi() {
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

function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    return JSON.parse(atob(payload)) as JwtClaims
  } catch {
    return null
  }
}

function sessionUsername(session: AuthSession): string | null {
  const claims = decodeJwtClaims(session.idToken)
  if (!claims) return null
  const tryStr = (k: string) => {
    const v = claims[k]
    return typeof v === 'string' && v.trim() ? v.trim() : null
  }
  return tryStr('cognito:username') ?? tryStr('email') ?? tryStr('preferred_username')
}

export function getDisplayNameFromSession(session: AuthSession | null): string {
  if (!session) return ''
  const claims = decodeJwtClaims(session.idToken)
  if (!claims) return ''
  const v = claims.name
  return typeof v === 'string' ? v : ''
}

async function getCognitoUserForSession(session: AuthSession) {
  const { CognitoUser, CognitoUserAttribute, CognitoUserPool, CognitoIdToken, CognitoAccessToken, CognitoRefreshToken, CognitoUserSession } =
    await import('amazon-cognito-identity-js')

  const settings = loadSettings()
  const validation = ensureSettings(settings)
  if (validation) throw new Error(validation)

  const username = sessionUsername(session)
  if (!username) throw new Error('Could not resolve current user from session.')

  const userPool = new CognitoUserPool({
    UserPoolId: settings.userPoolId,
    ClientId: settings.clientId,
  })

  const user = new CognitoUser({
    Username: username,
    Pool: userPool,
  })

  const userSession = new CognitoUserSession({
    IdToken: new CognitoIdToken({ IdToken: session.idToken }),
    AccessToken: new CognitoAccessToken({ AccessToken: session.accessToken }),
    RefreshToken: new CognitoRefreshToken({ RefreshToken: session.refreshToken ?? '' }),
  })
  user.setSignInUserSession(userSession)

  return { user, CognitoUserAttribute }
}

export async function changePasswordWithSession(
  session: AuthSession,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const { user } = await getCognitoUserForSession(session)
  const cur = currentPassword.trim()
  const next = newPassword.trim()
  if (!cur || !next) throw new Error('Current and new password are required.')
  await new Promise<void>((resolve, reject) => {
    user.changePassword(cur, next, (err, result) => {
      if (err) {
        reject(new Error(String(err.message || 'Password change failed.')))
        return
      }
      if (result !== 'SUCCESS') {
        reject(new Error('Password change failed.'))
        return
      }
      resolve()
    })
  })
}

export async function updateDisplayNameWithSession(
  session: AuthSession,
  displayName: string,
): Promise<AuthSession> {
  const { user, CognitoUserAttribute } = await getCognitoUserForSession(session)
  const name = displayName.trim()
  if (!name) throw new Error('Display name is required.')
  await new Promise<void>((resolve, reject) => {
    user.updateAttributes(
      [new CognitoUserAttribute({ Name: 'name', Value: name })],
      (err) => {
        if (err) {
          reject(new Error(String(err.message || 'Could not update display name.')))
          return
        }
        resolve()
      },
    )
  })
  // Return original session tokens; JWT must remain signed by Cognito.
  return session
}

export function clearSession() {
  localStorage.removeItem(STORAGE_SESSION)
}

export function isSessionValid(session: AuthSession): boolean {
  return Date.now() < session.expiresAt - 30_000
}

/** Ends the app session locally. Does not redirect to Cognito Hosted UI. */
export function signOutLocal() {
  clearSession()
}

/** Full logout via Cognito Hosted UI (redirects away; use when you used Hosted UI sign-in). */
export function logoutFromCognitoHostedUi() {
  const settings = loadSettings()
  const validation = ensureSettings(settings)
  if (validation) return

  const logoutUrl = new URL(`${settings.domain}/logout`)
  logoutUrl.searchParams.set('client_id', settings.clientId)
  logoutUrl.searchParams.set('logout_uri', settings.logoutUri)
  window.location.assign(logoutUrl.toString())
}
