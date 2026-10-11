import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Send, Star } from 'lucide-react'
import ShareSheet from '../share/ShareSheet.jsx'
import { AddToEventButton } from '../events/EventParts.jsx'
import { IdVerified, ProBadge } from '../Badges.jsx'
import ProfileLink, { PersonAvatar } from '../ProfileLink.jsx'
import { CoverFallback } from '../verticals/VerticalIcon.jsx'
import { fromKey } from '../../lib/dates.js'
import { priceFrom, subtitleOf } from '../../api/home.js'
import './home.css'

// Shared building blocks for Home, /services/:vertical and /occasions/:slug.

export function SectionHead({ title, sub, to, cta = 'See all' }) {
  return (
    <div className="section-head">
      <div className="grow">
        <h2>{title}</h2>
        {sub && <div className="muted tiny">{sub}</div>}
      </div>
      {to && (
        <Link to={to} className="small muted inline-icon see-all" aria-label={`${cta}: ${title}`}>
          {cta} <ChevronRight size={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  )
}

// "★ 4.9 (12)", or "New" before the first review. Tapping the rating opens the reviews.
export function RatingInline({ p, count = false }) {
  if (p.rating == null) return <span className="new-tag">New</span>
  return (
    <ProfileLink id={p.id} to={`/u/${p.id}?tab=reviews`} className="tap-text" label={`Rated ${p.rating.toFixed(1)}. See reviews`}>
      <Star size={11} className="star-on" fill="currentColor" /> <b>{p.rating.toFixed(1)}</b>
      {count && <span className="muted"> ({p.reviewCount})</span>}
    </ProfileLink>
  )
}

const dayName = (key) => fromKey(key).toLocaleDateString('en-US', { weekday: 'short' })

// Airbnb-style card: a big photo, then who, rating and price.
//   showVertical: name the vertical in the subtitle (for shelves that mix verticals)
export function ProviderCard({ p, showVertical = false, wide = false }) {
  const price = priceFrom(p)
  const badge =
    p.tasteMatch != null ? `${p.tasteMatch}% match` : p.freeDates?.length ? `Free ${p.freeDates.map(dayName).join(' & ')}` : null
  const [sharing, setSharing] = useState(false)
  return (
    <>
    {/* The card is a wrapper: the link covers photo + text, and the share / add-to-event buttons
        are its siblings laid over the photo (a <button> inside an <a> is invalid markup). */}
    <div className={`hd-card ${wide ? 'wide' : ''}`}>
    <Link to={`/u/${p.id}`} className="hd-card-link" aria-label={`${p.name}${price ? `, ${price}` : ''}`}>
      <div className="hd-card-img">
        {p.cover ? <img src={p.cover} alt="" loading="lazy" draggable={false} /> : <CoverFallback vertical={p.vertical} />}
        {badge && <span className={`hd-badge ${p.tasteMatch != null ? 'accent' : ''}`}>{badge}</span>}
        <span className="hd-card-avatar">
          <PersonAvatar id={p.id} src={p.avatar} name={p.name} username={p.username} />
        </span>
      </div>
      <div className="hd-card-body">
        <div className="row gap-xs">
          <div className="person-name small grow ellipsis">
            {p.name} {p.idVerified && <IdVerified />} {p.pro && <ProBadge />}
          </div>
          <span className="tiny">
            <RatingInline p={p} />
          </span>
        </div>
        <div className="muted tiny ellipsis">{[subtitleOf(p, { withVertical: showVertical }), p.city?.split(',')[0]].filter(Boolean).join(' · ')}</div>
        {price && <div className="tiny mt-xs"><b>{price}</b></div>}
      </div>
    </Link>
    <div className="hd-card-actions">
      <button
        type="button"
        className="card-share-btn"
        aria-label={`Share ${p.name}`}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setSharing(true)
        }}
      >
        <Send size={15} />
      </button>
      <AddToEventButton provider={p} variant="card" />
    </div>
    </div>
    {sharing && (
      <ShareSheet
        item={{ kind: 'provider', id: p.id, title: p.name, subtitle: [subtitleOf(p, { withVertical: true }), p.city?.split(',')[0]].filter(Boolean).join(' · '), image: p.cover || p.avatar }}
        onClose={() => setSharing(false)}
      />
    )}
    </>
  )
}

// Compact list row (photo, name, services, rating, price).
export function ProviderRow({ p, showVertical = false }) {
  const photo = p.covers?.[1] || p.cover
  const price = priceFrom(p)
  return (
    <Link to={`/u/${p.id}`} className="provider-row">
      {photo ? <img className="provider-row-img" src={photo} alt="" loading="lazy" /> : <CoverFallback vertical={p.vertical} className="provider-row-img" />}
      <div className="grow">
        <div className="person-name small">
          {p.name} {p.idVerified && <IdVerified />} {p.pro && <ProBadge />}
        </div>
        <div className="muted tiny ellipsis">{subtitleOf(p, { withVertical: showVertical })}</div>
        <div className="tiny row gap-xs mt-xs">
          <RatingInline p={p} count />
          {price && <span className="muted ellipsis">· {price}</span>}
        </div>
      </div>
      {p.tasteMatch != null && (
        <div className="match"><b>{p.tasteMatch}%</b><span>match</span></div>
      )}
    </Link>
  )
}

// Grey placeholders shaped like the content, shown while loading.
export function CardsSkeleton({ count = 3 }) {
  return (
    <div className="h-scroll" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="hd-card">
          <div className="hd-card-img hd-skel" />
          <div className="hd-card-body">
            <div className="hd-skel line w70" />
            <div className="hd-skel line w45" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function RowsSkeleton({ count = 3 }) {
  return (
    <div className="pad-x" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="provider-row">
          <div className="provider-row-img hd-skel" />
          <div className="grow">
            <div className="hd-skel line w45" />
            <div className="hd-skel line w70" />
          </div>
        </div>
      ))}
    </div>
  )
}
