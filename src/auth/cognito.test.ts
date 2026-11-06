import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { authenticatedFetch, clearSession, getSession, getValidSession, saveSession, SessionExpiredError, type AuthSession } from './cognito'

const expired = (): AuthSession => ({ accessToken: 'old-access', idToken: 'old-id', refreshToken: 'refresh-secret', expiresAt: Date.now() - 1000, authMethod: 'srp' })
const refreshed = () => new Response(JSON.stringify({ AuthenticationResult: { AccessToken: 'new-access', IdToken: 'new-id', ExpiresIn: 3600 } }), { status: 200 })

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
  vi.stubGlobal('window', new EventTarget())
  for (const [key, value] of Object.entries({ REGION: 'ca-central-1', DOMAIN: 'https://auth.example.test', CLIENT_ID: 'test-client', USER_POOL_ID: 'ca-central-1_test', REDIRECT_URI: 'http://localhost/', LOGOUT_URI: 'http://localhost/' })) {
    vi.stubEnv(`VITE_COGNITO_${key}`, value)
  }
  clearSession()
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('persistent Cognito sessions', () => {
  it('renews an expired access token on app startup and retains the refresh token', async () => {
    saveSession(expired())
    const request = vi.fn().mockResolvedValue(refreshed())
    vi.stubGlobal('fetch', request)
    const session = await getValidSession()
    expect(session.idToken).toBe('new-id')
    expect(session.refreshToken).toBe('refresh-secret')
    expect(getSession()?.idToken).toBe('new-id')
    expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ AuthFlow: 'REFRESH_TOKEN_AUTH', ClientId: 'test-client' })
  })
  it('shares one refresh across concurrent requests', async () => {
    saveSession(expired())
    const request = vi.fn().mockImplementation(async () => { await Promise.resolve(); return refreshed() })
    vi.stubGlobal('fetch', request)
    await Promise.all(Array.from({ length: 12 }, () => getValidSession()))
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('renews before expiry while a session is still usable', async () => {
    saveSession({ ...expired(), expiresAt: Date.now() + 15_000 })
    const request = vi.fn().mockResolvedValue(refreshed())
    vi.stubGlobal('fetch', request)
    await getValidSession()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('retries a 401 once with the new ID token', async () => {
    saveSession({ ...expired(), expiresAt: Date.now() + 3600_000 })
    const request = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes('cognito-idp')) return refreshed()
      const token = new Headers(init.headers).get('Authorization')
      return new Response('{}', { status: token === 'Bearer new-id' ? 200 : 401 })
    })
    vi.stubGlobal('fetch', request)
    expect((await authenticatedFetch('/mail/messages')).status).toBe(200)
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('does not restore login when a refresh completes after logout', async () => {
    saveSession(expired())
    let release!: (value: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve })))
    const pending = getValidSession()
    clearSession()
    release(refreshed())
    await expect(pending).rejects.toBeInstanceOf(SessionExpiredError)
    expect(getSession()).toBeNull()
  })
  it('preserves the refresh token after a temporary network failure', async () => {
    saveSession(expired())
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network offline')))
    await expect(getValidSession()).rejects.toThrow('Network offline')
    expect(getSession()?.refreshToken).toBe('refresh-secret')
  })
  it('ends a session only when Cognito rejects the refresh token', async () => {
    saveSession(expired())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ __type: 'NotAuthorizedException' }), { status: 400 })))
    await expect(getValidSession()).rejects.toBeInstanceOf(SessionExpiredError)
    expect(getSession()).toBeNull()
  })
  it('supports refresh tokens from the Hosted UI OAuth flow', async () => {
    saveSession({ ...expired(), authMethod: 'oauth' })
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'oauth-access', id_token: 'oauth-id', expires_in: 3600 })))
    vi.stubGlobal('fetch', request)
    expect((await getValidSession()).idToken).toBe('oauth-id')
    expect(request.mock.calls[0][0]).toBe('https://auth.example.test/oauth2/token')
    expect(request.mock.calls[0][1].body).toContain('grant_type=refresh_token')
  })
  it('never retries a send after a server error', async () => {
    saveSession({ ...expired(), expiresAt: Date.now() + 3600_000 })
    const request = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }))
    vi.stubGlobal('fetch', request)
    expect((await authenticatedFetch('/mail/send', { method: 'POST', body: '{}' })).status).toBe(500)
    expect(request).toHaveBeenCalledTimes(1)
  })
})
