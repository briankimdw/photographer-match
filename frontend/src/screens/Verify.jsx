import { Link } from 'react-router-dom'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import { Loading, SignInPrompt } from '../components/States.jsx'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'

// Identity verification (Stripe Identity) isn't built yet: show the real
// status from the photographer listing and say what's coming.
export default function Verify() {
  const { identityStatus, myProvider } = useStore()
  const { user, loading } = useAuth()
  const verified = identityStatus === 'verified'

  return (
    <div>
      <TopBar title="Verify identity" />
      {loading ? (
        <Loading />
      ) : !user ? (
        <SignInPrompt title="Sign in to verify your identity" />
      ) : (
        <div className="pad">
          {verified ? (
            <div className="center-col">
              <CheckCircle2 size={56} className="ok" />
              <h2 className="h3">You're verified</h2>
              <p className="muted small">An ID-verified badge appears on your profile, and you can accept paid bookings.</p>
              <Link to="/me" className="btn block mt">Back to profile</Link>
            </div>
          ) : (
            <div className="center-col">
              <ShieldCheck size={48} className="accent-text" />
              <h2 className="h3">Identity verification is coming soon</h2>
              <p className="muted small">
                {myProvider
                  ? 'Vendors need to verify their identity before accepting paid bookings. You’ll scan a government ID and take a quick selfie. This is free and separate from Verified Pro.'
                  : 'Verification is for vendors taking paid bookings. Clients don’t need it to book.'}
              </p>
              <div className="note left-text">
                Verification will be handled by Stripe Identity. We’ll only keep whether you passed, never your ID images or face data.
              </div>
              <div className="verify-status mt">
                <span className="muted small">Your status</span>
                <b className="small">{myProvider ? 'Not verified' : 'No listing yet'}</b>
              </div>
              <button className="btn accent block mt" disabled>Verify with Stripe (coming soon)</button>
              {!myProvider && <Link to="/new-listing" className="btn ghost block mt-sm">List your services</Link>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
