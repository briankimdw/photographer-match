import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Mail, X } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { safeNext, useAuth } from '../auth.jsx'
import Segmented from '../components/Segmented.jsx'
import useQuery from '../lib/useQuery.js'
import { listProviders } from '../api/catalog.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MIN_PASSWORD = 8
const RESEND_SECONDS = 30

// Turn Supabase auth errors into something a person can act on.
const friendly = (error) => {
  const msg = (error?.message || '').toLowerCase()
  if (error?.status === 429 || msg.includes('rate limit') || msg.includes('only request this after')) {
    return 'Too many attempts. Wait a minute, then try again.'
  }
  if (msg.includes('invalid login credentials')) return 'Wrong email or password.'
  if (msg.includes('email not confirmed')) return 'Confirm your email first: check your inbox for the link we sent.'
  if (msg.includes('not authorized') || msg.includes('not allowed')) {
    return 'Sign-in emails can only go to approved addresses until email sending is set up. Ask the team to add you.'
  }
  if (msg.includes('password should be') || msg.includes('weak password')) {
    return `Choose a stronger password (at least ${MIN_PASSWORD} characters).`
  }
  if (msg.includes('expired') || msg.includes('invalid') || msg.includes('token')) {
    return 'That code didn’t work. Check it, or send a new one.'
  }
  return error?.message || 'Something went wrong. Please try again.'
}

export default function SignIn() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { user, profile, needsWelcome } = useAuth()
  // Decorative collage: recent album covers from photographers on the app.
  const { data: providers } = useQuery(() => listProviders(), [])
  const collage = coverMix(providers)

  const [mode, setMode] = useState(params.get('mode') === 'signup' ? 'signup' : 'login')
  // form | code (email link/code sent) | confirm (new account must confirm) | forgot | forgot-sent
  const [step, setStep] = useState('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [resendIn, setResendIn] = useState(0)
  const [googleEnabled, setGoogleEnabled] = useState(null) // null = checking

  // Signed in (or just finished): move on.
  useEffect(() => {
    if (user && profile) navigate(needsWelcome ? `/welcome?next=${encodeURIComponent(next)}` : next, { replace: true })
  }, [user, profile, needsWelcome, next, navigate])

  // Ask the project which sign-in methods are switched on, so we never send
  // people to a raw "provider is not enabled" error page.
  useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
      .then((r) => r.json())
      .then((s) => setGoogleEnabled(!!s?.external?.google))
      .catch(() => setGoogleEnabled(false))
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [resendIn])

  // Built on demand (only ever runs in the browser).
  const callbackUrl = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
  const cleanEmail = email.trim().toLowerCase()

  const go = (nextStep) => {
    setStep(nextStep)
    setError('')
    setNotice('')
  }

  const checkEmail = () => {
    if (!EMAIL_RE.test(cleanEmail)) {
      setError('Enter a valid email address.')
      return false
    }
    return true
  }

  const run = async (fn) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  // ---- Log in with email + password ----
  const logIn = (e) => {
    e.preventDefault()
    if (!checkEmail()) return
    run(async () => {
      const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
      if (err) setError(friendly(err))
      // On success the auth listener picks up the session and the effect above navigates.
    })
  }

  // ---- Create an account with email + password ----
  const signUp = (e) => {
    e.preventDefault()
    if (!checkEmail()) return
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters for your password.`)
      return
    }
    run(async () => {
      const { data, error: err } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: { emailRedirectTo: callbackUrl() },
      })
      if (err) {
        setError(friendly(err))
        return
      }
      // Supabase doesn't reveal whether an email is registered; an existing
      // address comes back with no identities.
      if (data.user && data.user.identities?.length === 0) {
        setMode('login')
        setNotice('You already have an account with this email. Log in instead.')
        return
      }
      if (!data.session) {
        go('confirm')
        setResendIn(RESEND_SECONDS)
      }
    })
  }

  const resendConfirmation = () =>
    run(async () => {
      const { error: err } = await supabase.auth.resend({ type: 'signup', email: cleanEmail, options: { emailRedirectTo: callbackUrl() } })
      if (err) setError(friendly(err))
      else {
        setNotice('Sent again. Check your inbox (and spam).')
        setResendIn(RESEND_SECONDS)
      }
    })

  // ---- Passwordless: email a sign-in link + code ----
  const sendLink = (e) => {
    e?.preventDefault()
    if (!checkEmail()) return
    run(async () => {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { emailRedirectTo: callbackUrl(), shouldCreateUser: true },
      })
      if (err) {
        setError(friendly(err))
        return
      }
      setCode('')
      go('code')
      setResendIn(RESEND_SECONDS)
    })
  }

  const verifyCode = (e) => {
    e.preventDefault()
    run(async () => {
      const { error: err } = await supabase.auth.verifyOtp({ email: cleanEmail, token: code.trim(), type: 'email' })
      if (err) setError(friendly(err))
    })
  }

  // ---- Forgot password ----
  const sendReset = (e) => {
    e.preventDefault()
    if (!checkEmail()) return
    run(async () => {
      const { error: err } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (err) setError(friendly(err))
      else go('forgot-sent')
    })
  }

  const google = async () => {
    setError('')
    const { error: err } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl() } })
    if (err) setError(friendly(err))
  }

  const BackLink = ({ label = 'Back' }) => (
    <button className="link-btn small muted" onClick={() => go('form')}>
      <ArrowLeft size={14} aria-hidden="true" /> {label}
    </button>
  )

  return (
    <div className="signin">
      <div className="signin-hero">
        <div className="signin-collage">
          {Array.from({ length: 6 }, (_, i) =>
            collage[i] ? <img key={i} src={collage[i]} alt="" className={`c${i}`} /> : <span key={i} className={`signin-tile c${i}`} />,
          )}
        </div>
        <button className="icon-btn signin-close" onClick={() => (location.key === 'default' ? navigate('/') : navigate(-1))} aria-label="Close">
          <X size={22} aria-hidden="true" />
        </button>
      </div>

      <div className="signin-body">
        {step === 'form' && (
          <>
            <div className="wordmark">photomatch</div>
            <h1 className="signin-title">{mode === 'login' ? 'Welcome back' : 'Find and book vendors you’ll love'}</h1>

            <button className="btn-google mt-sm" onClick={google} disabled={googleEnabled === false}>
              <GoogleLogo /> Continue with Google
            </button>
            {googleEnabled === false && (
              <div className="tiny muted center-text mt-xs">Google sign-in isn’t switched on for this project yet.</div>
            )}

            <div className="divider"><span>or</span></div>

            <Segmented
              options={[
                { value: 'login', label: 'Log in' },
                { value: 'signup', label: 'Create account' },
              ]}
              value={mode}
              label="Log in or create an account"
              onChange={(m) => { setMode(m); setError(''); setNotice('') }}
            />

            <form onSubmit={mode === 'login' ? logIn : signUp} noValidate className="mt">
              <label className="field">
                <span>Email</span>
                <input className="input" type="email" inputMode="email" autoComplete="email"
                  placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
                  aria-describedby={error ? 'signin-error' : undefined} />
              </label>
              {/* Not a wrapping <label>: it holds two buttons, which would end up in the field's name. */}
              <div className="field mt-sm">
                <span className="row between">
                  <label htmlFor="signin-password">Password</label>
                  {mode === 'login' && (
                    <button type="button" className="link-btn tiny" onClick={() => go('forgot')}>Forgot password?</button>
                  )}
                </span>
                <div className="input-prefix">
                  <input id="signin-password" type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder={mode === 'signup' ? `At least ${MIN_PASSWORD} characters` : ''}
                    aria-describedby={[mode === 'signup' && 'signin-pw-hint', error && 'signin-error'].filter(Boolean).join(' ') || undefined}
                    value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" className="icon-btn" onClick={() => setShowPassword((v) => !v)}
                    aria-label="Show password" aria-pressed={showPassword}>
                    {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                  </button>
                </div>
                {mode === 'signup' && <span id="signin-pw-hint" className="sr-only">At least {MIN_PASSWORD} characters</span>}
              </div>
              <button className="btn block mt" disabled={busy || !email.trim() || !password}>
                {busy ? 'One moment…' : mode === 'login' ? 'Log in' : 'Create account'}
              </button>
            </form>

            <button className="link-btn small mt center-self" onClick={sendLink} disabled={busy}>
              <Mail size={14} aria-hidden="true" /> Email me a sign-in link instead
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <BackLink label="Use a different email" />
            <h1 className="signin-title mt-sm">Check your email</h1>
            <p className="muted small">
              We sent a sign-in link to <b className="ink">{cleanEmail}</b>. Tap it on this device, or enter the code from the email.
            </p>
            <form onSubmit={verifyCode} className="mt">
              <input className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={10}
                placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                aria-label="Sign-in code" aria-describedby={error ? 'signin-error' : undefined} autoFocus />
              <button className="btn block mt-sm" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Sign in'}</button>
            </form>
            <button className="link-btn small mt" disabled={resendIn > 0 || busy} onClick={sendLink}>
              {resendIn > 0 ? `Resend email in ${resendIn}s` : 'Resend email'}
            </button>
          </>
        )}

        {step === 'confirm' && (
          <>
            <BackLink />
            <h1 className="signin-title mt-sm">Confirm your email</h1>
            <p className="muted small">
              We sent a confirmation link to <b className="ink">{cleanEmail}</b>. Open it to finish creating your account. After that you can log in with your email and password any time.
            </p>
            <button className="btn ghost block mt" disabled={resendIn > 0 || busy} onClick={resendConfirmation}>
              {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend confirmation email'}
            </button>
            <button className="link-btn small mt center-self" onClick={() => { setMode('login'); go('form') }}>
              Already confirmed? Log in
            </button>
          </>
        )}

        {step === 'forgot' && (
          <>
            <BackLink label="Back to log in" />
            <h1 className="signin-title mt-sm">Reset your password</h1>
            <p className="muted small">Enter your account email and we’ll send a link to choose a new password.</p>
            <form onSubmit={sendReset} noValidate className="mt">
              <input className="input" type="email" inputMode="email" autoComplete="email" placeholder="you@example.com"
                aria-label="Email" aria-describedby={error ? 'signin-error' : undefined}
                value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              <button className="btn block mt-sm" disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
            </form>
          </>
        )}

        {step === 'forgot-sent' && (
          <>
            <BackLink label="Back to log in" />
            <h1 className="signin-title mt-sm">Check your email</h1>
            <p className="muted small">
              If <b className="ink">{cleanEmail}</b> has an account, a password reset link is on its way. It works once and expires after an hour.
            </p>
          </>
        )}

        {notice && <div className="form-notice mt-sm" role="status">{notice}</div>}
        {error && <div className="form-error mt-sm" role="alert" id="signin-error">{error}</div>}

        <p className="tiny muted signin-legal">
          By continuing you agree to the <Link to="#">Terms</Link> and <Link to="#">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  )
}

// Round-robin over photographers so the collage isn't all one person's work: up to 6 cover URLs.
function coverMix(providers = []) {
  const out = []
  const lists = providers.map((p) => p.covers || [])
  for (let round = 0; out.length < 6 && lists.some((l) => l.length > round); round++) {
    for (const l of lists) if (l[round] && out.length < 6) out.push(l[round])
  }
  return out
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}
