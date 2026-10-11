import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../auth.jsx'
import { useStore } from '../store.jsx'

const MIN_PASSWORD = 8

// Choose a new password. Reached two ways:
//  - from a "reset your password" email (the link signs you in for this one step)
//  - from Settings > Set or change password, while signed in
export default function ResetPassword() {
  const navigate = useNavigate()
  const { user, loading } = useAuth()
  const { toast } = useStore()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [waited, setWaited] = useState(false)

  // A reset link needs a moment to sign you in; only then decide it was invalid.
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 4000)
    return () => clearTimeout(t)
  }, [])

  const save = async (e) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`)
    if (password !== confirm) return setError('The passwords don’t match.')
    setBusy(true)
    setError('')
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    toast('Password saved. You can now log in with it.')
    navigate('/me', { replace: true })
  }

  if (!user) {
    return (
      <div>
        <TopBar title="New password" />
        <div className="pad center-col auth-status">
          {loading || !waited ? (
            <div className="spinner" />
          ) : (
            <>
              <h2 className="h3">That reset link didn’t work</h2>
              <p className="muted small">It may have expired or already been used. Request a new one from the log-in screen.</p>
              <Link to="/sign-in" className="btn mt">Back to log in</Link>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <TopBar title="New password" />
      <form className="pad" onSubmit={save} noValidate>
        <p className="muted small">Choose a password for <b className="ink">{user.email}</b>. You’ll use it to log in from now on.</p>
        <div className="field mt">
          <label htmlFor="reset-password">New password</label>
          <div className="input-prefix">
            <input id="reset-password" type={show ? 'text' : 'password'} autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`}
              aria-describedby={['reset-hint', error && 'reset-error'].filter(Boolean).join(' ')}
              value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
            <button type="button" className="icon-btn" onClick={() => setShow((v) => !v)} aria-label="Show password" aria-pressed={show}>
              {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
            </button>
          </div>
          <span id="reset-hint" className="sr-only">At least {MIN_PASSWORD} characters</span>
        </div>
        <label className="field mt-sm">
          <span>Confirm password</span>
          <input className="input" type={show ? 'text' : 'password'} autoComplete="new-password"
            aria-describedby={error ? 'reset-error' : undefined}
            value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <div className="form-error mt-sm" role="alert" id="reset-error">{error}</div>}
        <button className="btn block mt" disabled={busy || !password || !confirm}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </div>
  )
}
