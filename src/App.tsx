import { useEffect, useMemo, useState } from 'react'
import { MailDashboard } from './dashboard/MailDashboard'
import { LoginPage } from './auth/LoginPage'
import {
  exchangeCodeForTokens,
  getSession,
  getSettingsError,
  hasAuthSettings,
  getValidSession,
  SESSION_CHANGED,
  SessionExpiredError,
  saveSession,
  signInWithPassword,
  signOutLocal,
  type AuthSession,
} from './auth/cognito'

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loginBusy, setLoginBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  const settingsError = useMemo(() => getSettingsError(), [])
  const isConfigured = useMemo(() => hasAuthSettings(), [])

  useEffect(() => {
    async function bootstrapAuth() {
      if (!isConfigured) {
        setAuthLoading(false)
        return
      }
      const url = new URL(window.location.href)
      const code = url.searchParams.get('code')
      const callbackError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      if (callbackError) {
        setAuthError(callbackError)
        setAuthLoading(false)
        return
      }
      if (code) {
        try {
          const next = await exchangeCodeForTokens(code)
          saveSession(next)
          setSession(next)
          url.searchParams.delete('code')
          url.searchParams.delete('state')
          url.searchParams.delete('scope')
          window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
        } catch (e) {
          setAuthError(e instanceof Error ? e.message : 'Failed to complete sign in.')
        } finally {
          setAuthLoading(false)
        }
        return
      }
      const existing = getSession()
      if (existing) {
        try { setSession(await getValidSession()) } catch (error) {
          // Temporary connectivity failures must not discard a valid refresh token.
          if (!(error instanceof SessionExpiredError)) setSession(existing)
        }
      }
      setAuthLoading(false)
    }
    void bootstrapAuth()
  }, [isConfigured])

  useEffect(() => {
    const sync = () => setSession(getSession())
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'cmail-auth-session' || event.key === null) sync()
    }
    window.addEventListener(SESSION_CHANGED, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SESSION_CHANGED, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  useEffect(() => {
    if (!session) return
    const renew = () => {
      if (!document.hidden) void getValidSession().catch(() => { /* Retry on next tick/focus or API request. */ })
    }
    const timer = window.setInterval(renew, 30_000)
    window.addEventListener('focus', renew)
    document.addEventListener('visibilitychange', renew)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', renew)
      document.removeEventListener('visibilitychange', renew)
    }
  }, [session])

  if (!isConfigured) {
    return (
      <LoginPage
        title="Cmail"
        subtitle="Set VITE_COGNITO_* variables (including VITE_COGNITO_USER_POOL_ID) to enable login."
        error={settingsError}
      />
    )
  }

  if (authLoading) {
    return <LoginPage title="Cmail" subtitle="Signing you in..." loading />
  }

  if (!session) {
    return (
      <LoginPage
        title="Cmail"
        subtitle="Sign in with your account."
        error={authError}
        loading={loginBusy}
        credentialsForm
        onCredentialsSubmit={async (email, password) => {
          setAuthError(null)
          setLoginBusy(true)
          try {
            const next = await signInWithPassword(email, password)
            saveSession(next)
            setSession(next)
          } catch (e) {
            setAuthError(e instanceof Error ? e.message : 'Sign-in failed.')
          } finally {
            setLoginBusy(false)
          }
        }}
      />
    )
  }

  return (
    <MailDashboard
      authSessionExpiresAt={session.expiresAt}
      onLogout={() => {
        signOutLocal()
        setSession(null)
      }}
    />
  )
}
