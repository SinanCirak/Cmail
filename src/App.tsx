import { useEffect, useMemo, useState } from 'react'
import { MailDashboard } from './dashboard/MailDashboard'
import { LoginPage } from './auth/LoginPage'
import {
  clearSession,
  exchangeCodeForTokens,
  getSession,
  getSettingsError,
  hasAuthSettings,
  isSessionValid,
  loginWithCognito,
  logoutFromCognito,
  saveSession,
  type AuthSession,
} from './auth/cognito'

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
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
      if (existing && isSessionValid(existing)) {
        setSession(existing)
      } else {
        clearSession()
      }
      setAuthLoading(false)
    }
    void bootstrapAuth()
  }, [isConfigured])

  if (!isConfigured) {
    return (
      <LoginPage
        title="Cmail"
        subtitle="Set VITE_COGNITO_* variables to enable secure login."
        error={settingsError}
      />
    )
  }

  if (authLoading) {
    return <LoginPage title="Cmail" subtitle="Signing you in..." />
  }

  if (!session) {
    return (
      <LoginPage
        title="Cmail"
        subtitle="Secure access with Amazon Cognito."
        error={authError}
        onSignIn={() => {
          setAuthError(null)
          void loginWithCognito()
        }}
      />
    )
  }

  return (
    <MailDashboard
      onLogout={() => {
        clearSession()
        setSession(null)
        logoutFromCognito()
      }}
    />
  )
}
