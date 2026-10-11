import { useState } from 'react'
import { ShieldCheck, BadgeCheck, Camera } from 'lucide-react'
import Sheet from './Sheet.jsx'
import { callName } from '../lib/format.js'

// Badges are plain labels by default. Pass `explain` (only where the badge is not inside
// another link) to make a tap open a short "what this means" sheet.

export const IdVerified = ({ label = false, explain = false, name }) => {
  const content = (
    <>
      <ShieldCheck size={13} aria-hidden="true" />
      {label ? 'ID verified' : <span className="sr-only">ID verified</span>}
    </>
  )
  if (!explain) return <span className="badge badge-id" title="Identity verified">{content}</span>
  return <ExplainBadge kind="id" className="badge badge-id" name={name}>{content}</ExplainBadge>
}

export const ProBadge = ({ explain = false, name }) => {
  const content = <><BadgeCheck size={13} aria-hidden="true" /> PRO</>
  if (!explain) return <span className="badge badge-pro" title="Verified Pro">{content}</span>
  return <ExplainBadge kind="pro" className="badge badge-pro" name={name}>{content}</ExplainBadge>
}

export const VerifiedClient = () => (
  <span className="badge badge-id">
    <ShieldCheck size={13} aria-hidden="true" /> Verified client
  </span>
)

export const RealPhoto = ({ overlay }) => (
  <span className={`badge badge-real ${overlay ? 'overlay' : ''}`} title="Verified with RAW file">
    <Camera size={12} aria-hidden="true" /> Real Photo
  </span>
)

const EXPLAIN = {
  id: {
    title: 'ID verified',
    label: 'Identity verified. What does this mean?',
    icon: ShieldCheck,
    lead: (who) => `${who} has confirmed their identity with a government ID, so the person you book is who they say they are.`,
    points: [
      'Vendors verify their identity before they can accept paid bookings.',
      'We only keep whether the check passed, never the ID images.',
      'It’s about who they are, not how good the photos are. Look at the portfolio and reviews for that.',
    ],
  },
  pro: {
    title: 'Verified Pro',
    label: 'Verified Pro. What does this mean?',
    icon: BadgeCheck,
    lead: (who) => `${who} is a Verified Pro: a membership for vendors running their business on photomatch.`,
    points: [
      'Pro is separate from ID verification.',
      'It isn’t a rating. Ratings only come from clients after completed bookings.',
      'In search, you can filter to show only Verified Pro vendors.',
    ],
  },
}

function ExplainBadge({ kind, className, name, children }) {
  const [open, setOpen] = useState(false)
  const info = EXPLAIN[kind]
  const Icon = info.icon
  const who = name ? callName(name) : 'This vendor'
  return (
    <>
      <button
        type="button"
        className={`${className} badge-btn`}
        aria-label={info.label}
        aria-haspopup="dialog"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
      >
        {children}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={info.title}>
        <div className={`explain explain-${kind}`}>
          <span className="explain-icon" aria-hidden="true"><Icon size={26} /></span>
          <p>{info.lead(who)}</p>
          <ul>
            {info.points.map((p) => <li key={p} className="small muted">{p}</li>)}
          </ul>
          <button className="btn block mt" onClick={() => setOpen(false)}>Got it</button>
        </div>
      </Sheet>
    </>
  )
}
