import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { safeNext, useAuth } from '../auth.jsx'

const USERNAME_RE = /^[a-z0-9._]{3,30}$/

// One-time step after a new account is created: pick a name and username.
export default function Welcome() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { user, profile, refreshProfile, loading } = useAuth()
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!loading && !user) navigate(`/sign-in?next=${encodeURIComponent(next)}`, { replace: true })
  }, [loading, user, next, navigate])

  useEffect(() => {
    if (profile) {
      setName((n) => n || profile.display_name || '')
      setUsername((u) => u || profile.username || '')
    }
  }, [profile])

  const cleanUsername = username.trim().toLowerCase()
  const usernameOk = USERNAME_RE.test(cleanUsername)

  const save = async (e) => {
    e.preventDefault()
    if (!name.trim() || !usernameOk) return
    setBusy(true)
    setError('')
    const { error: err } = await supabase
      .from('profiles')
      .update({ display_name: name.trim(), username: cleanUsername })
      .eq('id', user.id)
    setBusy(false)
    if (err) {
      setError(err.code === '23505' ? 'That username is taken. Try another.' : err.message)
      return
    }
    await refreshProfile()
    navigate(next, { replace: true })
  }

  return (
    <div className="pad welcome">
      <div className="wordmark">photomatch</div>
      <h1 className="signin-title mt">Welcome! What should we call you?</h1>
      <p className="muted small">Vendors see your name when you message or book them.</p>

      <form onSubmit={save} className="mt">
        <label className="field">
          <span>Your name</span>
          <input className="input" autoComplete="name" value={name} maxLength={80}
            onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" autoFocus />
        </label>
        <label className="field mt-sm">
          <span>Username</span>
          <div className="input-prefix">
            <span>@</span>
            <input value={username} maxLength={30} autoCapitalize="none" autoCorrect="off"
              aria-invalid={username && !usernameOk ? true : undefined}
              aria-describedby={[username && !usernameOk && 'welcome-username-hint', error && 'welcome-error'].filter(Boolean).join(' ') || undefined}
              onChange={(e) => setUsername(e.target.value.toLowerCase())} />
          </div>
          {username && !usernameOk && (
            <small className="field-hint" id="welcome-username-hint">3–30 characters: lowercase letters, numbers, dots and underscores.</small>
          )}
        </label>
        {error && <div className="form-error mt-sm" role="alert" id="welcome-error">{error}</div>}
        <button className="btn block mt" disabled={busy || !name.trim() || !usernameOk}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
