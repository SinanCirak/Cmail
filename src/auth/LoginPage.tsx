import './LoginPage.css'

type Props = {
  title: string
  subtitle: string
  error?: string | null
  onSignIn?: () => void
}

export function LoginPage({ title, subtitle, error, onSignIn }: Props) {
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
        {onSignIn ? (
          <button type="button" className="cm-login__btn" onClick={onSignIn}>
            Sign in with Cognito
          </button>
        ) : null}
        <p className="cm-login__hint">Protected by Amazon Cognito OAuth 2.0 + PKCE.</p>
      </section>
    </main>
  )
}
