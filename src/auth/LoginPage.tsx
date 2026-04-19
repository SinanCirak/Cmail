import { useState, type FormEvent } from 'react'
import './LoginPage.css'

type Props = {
  title: string
  subtitle: string
  error?: string | null
  loading?: boolean
  /** Email + password sign-in on your domain (no Cognito Hosted UI redirect). */
  credentialsForm?: boolean
  onCredentialsSubmit?: (email: string, password: string) => void | Promise<void>
}

export function LoginPage({
  title,
  subtitle,
  error,
  loading,
  credentialsForm,
  onCredentialsSubmit,
}: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!onCredentialsSubmit || loading) return
    await onCredentialsSubmit(email, password)
  }

  const showForm = Boolean(credentialsForm && onCredentialsSubmit)

  return (
    <main className="cm-login">
      <div className="cm-login__bg" aria-hidden="true" />
      <section className="cm-login__card" aria-label="Login">
        <div className="cm-login__brand">
          <span className="cm-login__mark">C</span>
          <h1>{title}</h1>
        </div>
        <p className="cm-login__subtitle">{subtitle}</p>
        {error ? <div className="cm-login__error">{error}</div> : null}

        {showForm ? (
          <form className="cm-login__form" onSubmit={(e) => void handleSubmit(e)}>
            <label className="cm-login__label" htmlFor="cm-email">
              Email
            </label>
            <input
              id="cm-email"
              name="username"
              className="cm-login__input"
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="you@company.com"
              value={email}
              onChange={(ev) => setEmail(ev.target.value)}
              disabled={loading}
              required
            />
            <label className="cm-login__label" htmlFor="cm-password">
              Password
            </label>
            <input
              id="cm-password"
              name="password"
              className="cm-login__input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(ev) => setPassword(ev.target.value)}
              disabled={loading}
              required
            />
            <button type="submit" className="cm-login__btn" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : null}

        {showForm ? (
          <p className="cm-login__hint">
            Cognito verifies your credentials; the address bar stays on this site.
          </p>
        ) : null}
      </section>
    </main>
  )
}
