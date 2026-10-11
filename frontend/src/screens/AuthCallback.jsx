import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { safeNext, useAuth } from '../auth.jsx'

// Where magic links and Google sign-in land. supabase-js reads the session
// from the URL on load; we wait for it, then continue.
export default function AuthCallback() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const { user, profile, needsWelcome } = useAuth()

  // Errors come back in the query string or the hash (e.g. an expired link).
  const hash = new URLSearchParams(location.hash.slice(1))
  const urlError = params.get('error_description') || hash.get('error_description')
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (user && profile) navigate(needsWelcome ? `/welcome?next=${encodeURIComponent(next)}` : next, { replace: true })
  }, [user, profile, needsWelcome, next, navigate])

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 10000)
    return () => clearTimeout(t)
  }, [])

  if (urlError || timedOut) {
    return (
      <div className="pad center-col auth-status">
        <h2 className="h3">That sign-in link didn’t work</h2>
        <p className="muted small">
          {urlError ? urlError.replace(/\+/g, ' ') : 'It may have expired or already been used.'} Links work once and expire after an hour.
        </p>
        <Link to={`/sign-in?next=${encodeURIComponent(next)}`} className="btn mt">Try again</Link>
      </div>
    )
  }

  return (
    <div className="pad center-col auth-status">
      <div className="spinner" />
      <p className="muted small">Signing you in…</p>
    </div>
  )
}
