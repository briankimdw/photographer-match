import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { onTablistKeyDown } from '../components/tabs.js'
import {
  Bookmark, Briefcase, Check, ChevronRight, CreditCard, Heart, Images, Info, Layers, MapPin, Package, Pencil, Plus, PlusSquare,
  Settings, ShieldCheck, Sparkles, Star, Store,
} from 'lucide-react'
import VerticalIcon from '../components/verticals/VerticalIcon.jsx'
import { nounFor, nounTitle, verticalMeta } from '../verticals/index.js'
import Sheet from '../components/Sheet.jsx'
import ProfileLink, { PersonAvatar } from '../components/ProfileLink.jsx'
import { IdVerified } from '../components/Badges.jsx'
import { ViewableAvatar } from '../components/AvatarViewer.jsx'
import { StatusPill } from '../components/Booking.jsx'
import { EmptyState, ErrorState, Loading } from '../components/States.jsx'
import Dashboard, { BOOKED } from './Dashboard.jsx'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import { supabase } from '../lib/supabase.js'
import useQuery from '../lib/useQuery.js'
import { avatarUrl } from '../lib/format.js'
import { fromKey, today, toKey } from '../lib/dates.js'
import { getProvider, listProviders, withMatches } from '../api/catalog.js'
import { listMyBookings, listProviderBookings } from '../api/bookings.js'
import { listCollections } from '../api/social.js'
import { getTasteProfile } from '../api/discover.js'
import EventsShelf from '../components/events/EventsShelf.jsx'

// Bookings that still need something from someone.
const ACTIVE = ['requested', 'countered', 'accepted', 'confirmed', 'in_progress', 'delivered', 'disputed']

const rating = (n) => (n == null ? null : Number(n).toFixed(1))

export default function Me() {
  const { mode, myProvider, refreshProvider } = useStore()
  const { user, loading } = useAuth()
  const uid = user?.id ?? null
  const providerId = myProvider?.id ?? null

  // Someone may have just set up a listing on /upload: pick it up.
  useEffect(() => {
    if (uid) refreshProvider()
  }, [uid, refreshProvider])

  const myBookings = useQuery(uid ? listMyBookings : null, [uid])
  const providerBookings = useQuery(uid && providerId ? () => listProviderBookings(providerId) : null, [uid, providerId])
  const providerDetail = useQuery(providerId ? () => getProvider(providerId) : null, [providerId])

  return (
    <div className="me">
      <header className="home-header">
        <h1 className="title-lg">Profile</h1>
        {user && (
          <div className="row">
            <Link to="/upload" className="icon-btn" aria-label="Post photos">
              <PlusSquare size={22} aria-hidden="true" />
            </Link>
            <Link to="/settings" className="icon-btn" aria-label="Settings">
              <Settings size={22} />
            </Link>
          </div>
        )}
      </header>
      {loading ? (
        <Loading />
      ) : !user ? (
        <SignedOut />
      ) : (
        <>
          <ProfileHero provider={providerDetail.data} />
          <RoleSwitch myBookings={myBookings.data} providerBookings={providerBookings.data} />
          {mode === 'provider' ? (
            <ProviderView detail={providerDetail} bookings={providerBookings} />
          ) : (
            <ClientView bookings={myBookings} />
          )}
        </>
      )}
    </div>
  )
}

function SignedOut() {
  // A few real portfolio covers from different photographers.
  const { data: providers } = useQuery(listProviders, [])
  const art = (providers || []).map((p) => p.cover).filter(Boolean).slice(0, 3)
  return (
    <div className="pad">
      <div className="signed-out">
        {art.length === 3 && (
          <div className="signed-out-art">
            {art.map((src) => <img key={src} src={src} alt="" />)}
          </div>
        )}
        <h2 className="h3">Your bookings, favorites and messages, in one place</h2>
        <p className="muted small">Sign in to request bookings, message vendors and keep your shortlist across devices.</p>
        <Link to="/sign-in?next=/me" className="btn accent block mt">Sign in or create an account</Link>
      </div>
    </div>
  )
}

function ProfileHero({ provider }) {
  const { mode, identityStatus, myProvider, toast } = useStore()
  const { user, profile, refreshProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ display_name: '', city: '', bio: '' })
  const [saving, setSaving] = useState(false)
  const isProvider = mode === 'provider'

  const openEdit = () => {
    setDraft({ display_name: profile?.display_name || '', city: profile?.city || '', bio: profile?.bio || '' })
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: draft.display_name.trim(), city: draft.city.trim() || null, bio: draft.bio.trim() || null })
      .eq('id', user.id)
    setSaving(false)
    if (error) {
      toast('Couldn’t save: ' + error.message)
      return
    }
    await refreshProfile()
    setEditing(false)
    toast('Profile updated')
  }

  if (!profile) return null
  const name = profile.display_name || profile.username
  const clientRating = rating(profile.client_rating_avg)
  const clientReviews = profile.client_rating_count ?? 0

  return (
    <section className="me-hero">
      <div className="row gap-xs top">
        <ViewableAvatar src={avatarUrl(profile.avatar_path, name)} name={name} username={profile.username} />
        <div className="grow">
          <h2>{name}</h2>
          <div className="muted small inline-icon">
            <Link to={`/u/${profile.username || profile.id}`} className="tap-text" aria-label="View your public profile">@{profile.username}</Link>
            {profile.city && <> · <MapPin size={12} /> {profile.city}</>}
          </div>
          <div className="row gap-xs wrap mt-xs">
            {identityStatus === 'verified' && <IdVerified label explain name={name} />}
          </div>
        </div>
        <button className="pill-btn" onClick={openEdit}>
          <Pencil size={13} /> Edit
        </button>
      </div>

      {profile.bio && <p className="small mt-sm">{profile.bio}</p>}

      {/* Both ratings are always visible; the one for the current role is highlighted. */}
      <div className="rating-pair">
        <div className={`rating-cell ${!isProvider ? 'on' : ''}`}>
          <b><Star size={14} className="star-on" fill="currentColor" /> {clientRating ?? 'New'}</b>
          <span>as a client · {clientReviews} review{clientReviews === 1 ? '' : 's'}</span>
        </div>
        {myProvider ? (
          <Link to={`/u/${myProvider.id}?tab=reviews`} className={`rating-cell tappable ${isProvider ? 'on' : ''}`} aria-label={`See the reviews on your ${nounFor(myProvider.vertical)} profile`}>
            <b><Star size={14} className="star-on" fill="currentColor" /> {rating(provider?.rating) ?? 'New'} <ChevronRight size={14} className="muted rating-cell-go" /></b>
            <span>as a {nounFor(myProvider.vertical)} · {provider?.reviewCount ?? 0} review{provider?.reviewCount === 1 ? '' : 's'}</span>
          </Link>
        ) : (
          <div className={`rating-cell ${isProvider ? 'on' : ''}`}>
            <b><Store size={14} /> —</b>
            <span>not taking bookings yet</span>
          </div>
        )}
      </div>

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit profile">
        <label className="field"><span>Name</span><input className="input" maxLength={80} value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></label>
        <label className="field mt-sm"><span>City</span><input className="input" maxLength={80} value={draft.city} onChange={(e) => setDraft({ ...draft, city: e.target.value })} /></label>
        <label className="field mt-sm"><span>Bio</span><textarea className="input" rows={3} maxLength={500} value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} /></label>
        <button className="btn block mt" disabled={saving || !draft.display_name.trim()} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </Sheet>
    </section>
  )
}

// One switch for both sides of the account. Each side shows what's waiting for you there.
function RoleSwitch({ myBookings, providerBookings }) {
  const { mode, setMode, myProvider, myProviders } = useStore()
  const activeBookings = (myBookings || []).filter((b) => ACTIVE.includes(b.status)).length
  const pending = (providerBookings || []).filter((r) => r.status === 'requested').length
  const isProvider = mode === 'provider'

  return (
    <div className="role-switch-wrap">
      <div className="role-switch" role="tablist" aria-label="Profile mode" onKeyDown={onTablistKeyDown}>
        <span className="role-thumb" aria-hidden="true" style={{ transform: isProvider ? 'translateX(100%)' : 'none' }} />
        <button role="tab" aria-selected={!isProvider} tabIndex={!isProvider ? 0 : -1} className={`role ${!isProvider ? 'on' : ''}`} onClick={() => setMode('client')}>
          <Briefcase size={18} />
          <div>
            <b>Hiring</b>
            <small>{myBookings ? `${activeBookings} active booking${activeBookings === 1 ? '' : 's'}` : 'Your bookings'}</small>
          </div>
        </button>
        <button role="tab" aria-selected={isProvider} tabIndex={isProvider ? 0 : -1} className={`role ${isProvider ? 'on' : ''}`} onClick={() => setMode('provider')}>
          {myProvider ? <VerticalIcon vertical={myProvider.vertical} size={18} /> : <Store size={18} />}
          <div>
            <b>{myProviders.length > 1 ? 'My business' : myProvider ? nounTitle(myProvider.vertical) : 'Vendor'}</b>
            <small>{!myProvider ? 'Start taking bookings' : pending ? `${pending} new request${pending === 1 ? '' : 's'}` : 'Your business'}</small>
          </div>
          {pending > 0 && !isProvider && <span className="role-dot" aria-hidden="true">{pending}</span>}
        </button>
      </div>
    </div>
  )
}

function StatTile({ value, label, to, onClick, highlight }) {
  const content = (
    <>
      <b>{value}</b>
      <span>{label}</span>
    </>
  )
  const cls = `stat-tile ${highlight ? 'highlight' : ''}`
  if (to) return <Link to={to} className={cls}>{content}</Link>
  if (onClick) return <button className={cls} onClick={onClick}>{content}</button>
  return <div className={cls}>{content}</div>
}

function ClientView({ bookings }) {
  const { shortlist, following } = useStore()
  const { user } = useAuth()
  const { data: providers } = useQuery(() => listProviders().then(withMatches), [user?.id])
  const collections = useQuery(listCollections, [user?.id])
  const taste = useQuery(getTasteProfile, [user?.id])
  const [openCollection, setOpenCollection] = useState(null)

  const all = bookings.data || []
  const active = all.filter((b) => ACTIVE.includes(b.status))
  // Soonest upcoming confirmed shoot, else the soonest active booking.
  const upcoming = [...active].sort((a, b) => a.start - b.start)
  const next = upcoming.find((b) => b.status === 'confirmed' && b.day >= today()) || upcoming.find((b) => b.day >= today()) || upcoming[0]

  const byId = new Map((providers || []).map((p) => [p.id, p]))
  const shortlisted = [...shortlist].map((id) => byId.get(id)).filter(Boolean)
  const followed = [...following].map((id) => byId.get(id)).filter(Boolean)

  return (
    <div className="mode-body">
      <div className="stat-tiles">
        <StatTile value={bookings.loading ? '…' : active.length} label="Active bookings" to="/bookings" />
        <StatTile value={shortlist.size} label="Shortlisted" to="/discover" />
        <StatTile value={collections.data ? collections.data.length : '…'} label="Collections" />
      </div>

      {bookings.error && <div className="pad-x"><ErrorState error={bookings.error} onRetry={bookings.reload} /></div>}
      {next && (
        <>
          <h2 className="section-title h4 pad-x">Next up</h2>
          <div className="pad-x">
            <NextBooking b={next} />
          </div>
        </>
      )}

      <EventsShelf showEmpty title="Events" />

      <h2 className="section-title h4 pad-x">Shortlisted</h2>
      {shortlisted.length ? (
        <PeopleRow people={shortlisted} />
      ) : (
        <div className="pad-x">
          <Link to="/discover" className="empty-card">
            <Layers size={20} />
            <div className="grow">
              <b className="small">{providers || !shortlist.size ? 'No one shortlisted yet' : 'Loading…'}</b>
              <div className="muted tiny">Swipe right in Discover on work you love.</div>
            </div>
            <ChevronRight size={16} />
          </Link>
        </div>
      )}

      <h2 className="section-title h4 pad-x">Following</h2>
      {followed.length ? (
        <PeopleRow people={followed} />
      ) : (
        <div className="pad-x">
          <Link to="/search" className="empty-card">
            <Heart size={20} />
            <div className="grow">
              <b className="small">{providers || !following.size ? 'Not following anyone yet' : 'Loading…'}</b>
              <div className="muted tiny">Follow vendors to see their new work first.</div>
            </div>
            <ChevronRight size={16} />
          </Link>
        </div>
      )}

      <h2 className="section-title h4 pad-x">Your taste</h2>
      <div className="pad-x">
        <TasteCard taste={taste} />
      </div>

      <h2 className="section-title h4 pad-x">Saved collections</h2>
      {collections.loading ? (
        <Loading inline />
      ) : collections.error ? (
        <div className="pad-x"><ErrorState error={collections.error} onRetry={collections.reload} /></div>
      ) : collections.data?.length ? (
        <div className="grid2 pad-x-only">
          {collections.data.map((c) => (
            <button key={c.id} className="collection tappable left-text" onClick={() => setOpenCollection(c)} aria-label={`Open ${c.name}, ${c.count} saved`}>
              {c.cover ? (
                <img src={c.cover} alt="" loading="lazy" />
              ) : (
                <div className="collection-empty"><Bookmark size={20} /></div>
              )}
              <b className="small">{c.name}</b>
              <div className="muted tiny">{c.count} saved</div>
            </button>
          ))}
        </div>
      ) : (
        <div className="pad-x">
          <EmptyState compact icon={Bookmark} title="No collections yet" text="Tap the bookmark on any photo to save it here." />
        </div>
      )}

      <Sheet open={!!openCollection} onClose={() => setOpenCollection(null)} title={openCollection?.name}>
        {openCollection?.photos.length === 0 && <EmptyState compact icon={Bookmark} title="Nothing saved here yet" text="Tap the bookmark on any photo to save it here." />}
        <div className="collection-grid">
          {openCollection?.photos.map((ph) =>
            ph.providerId && ph.albumId ? (
              <Link key={ph.id} to={`/gallery/${ph.providerId}?post=${ph.albumId}&photo=${ph.id}`} aria-label="Open in the gallery">
                <img src={ph.src} alt="" loading="lazy" />
              </Link>
            ) : (
              <img key={ph.id} src={ph.src} alt="" loading="lazy" />
            ),
          )}
        </div>
      </Sheet>

      <div className="pad-x mt muted tiny inline-icon">
        <Info size={12} /> Vendors see your client rating when you send a request.
      </div>
    </div>
  )
}

function PeopleRow({ people }) {
  return (
    <div className="h-scroll">
      {people.map((p) => (
        <Link key={p.id} to={`/u/${p.id}`} className="shortlist-chip">
          <img className="avatar" src={p.avatar} alt="" />
          <span className="tiny">{p.name.split(' ')[0]}</span>
          {p.tasteMatch != null && <span className="tiny muted">{p.tasteMatch}%</span>}
        </Link>
      ))}
    </div>
  )
}

function TasteCard({ taste }) {
  if (taste.loading) return <Loading inline />
  if (taste.error) return <ErrorState error={taste.error} onRetry={taste.reload} />
  const t = taste.data
  if (!t?.styles?.length) {
    return (
      <Link to="/discover" className="empty-card">
        <Sparkles size={20} />
        <div className="grow">
          <b className="small">{t?.swipes ? 'Still learning your taste' : 'We don’t know your taste yet'}</b>
          <div className="muted tiny">Like a few photos in Discover and we’ll match you with vendors whose style fits.</div>
        </div>
        <ChevronRight size={16} />
      </Link>
    )
  }
  return (
    <div className="info-card">
      <div className="muted tiny">Learned from {t.swipes} swipe{t.swipes === 1 ? '' : 's'} ({t.likes} liked)</div>
      <div className="mt-xs">
        {t.styles.slice(0, 5).map((s) => (
          <div key={s.tag} className="taste-row">
            <span>{s.tag}</span>
            <div className="taste-bar"><div style={{ width: `${s.weight * 100}%` }} /></div>
          </div>
        ))}
      </div>
      {t.corrections.length > 0 && <div className="muted tiny mt-xs">Hidden: {t.corrections.join(', ')}</div>}
    </div>
  )
}

function NextBooking({ b }) {
  const provider = b.provider
  return (
    <Link to={`/bookings/${b.id}`} className="booking-card">
      <PersonAvatar id={provider.id} src={provider.avatar} name={provider.name} username={provider.username} className="avatar" />
      <div className="grow">
        <b className="small">{b.packageName}</b>
        <div className="muted tiny"><ProfileLink id={provider.id}>{provider.name}</ProfileLink> · {b.date}</div>
        <div className="mt-xs"><StatusPill status={b.status} /></div>
      </div>
      <ChevronRight size={16} className="muted" />
    </Link>
  )
}

function ProviderView({ detail, bookings }) {
  const { myProvider, identityStatus } = useStore()
  const [params] = useSearchParams()
  const [tab, setTab] = useState(() => (['requests', 'calendar', 'packages', 'portfolio'].includes(params.get('tab')) ? params.get('tab') : 'requests'))
  const tabsRef = useRef()

  if (!myProvider) {
    return (
      <div className="mode-body pad-x">
        <EmptyState
          icon={Store}
          title="Take bookings for your business"
          text="Photographer, caterer, DJ, venue, florist… Set up a listing with your packages and clients can find and book you."
          action={<Link to="/new-listing" className="btn accent">List your services</Link>}
        />
      </div>
    )
  }
  const visual = verticalMeta(myProvider.vertical).visual

  const list = bookings.data || []
  const pending = list.filter((r) => r.status === 'requested').length
  const now = today()
  const monthKey = toKey(now).slice(0, 7)
  const bookedThisMonth = new Set(list.filter((b) => BOOKED.includes(b.status) && b.dateKey.startsWith(monthKey)).map((b) => b.dateKey)).size
  const monthName = fromKey(`${monthKey}-01`).toLocaleDateString('en-US', { month: 'short' })
  const provider = detail.data
  const packageCount = provider?.packages?.length ?? 0
  const albumCount = provider?.albumCount ?? 0

  const steps = [
    { done: identityStatus === 'verified', label: 'Verify your identity', sub: 'Required to accept paid bookings', Icon: ShieldCheck, to: '/verify' },
    // Payouts (Stripe Connect) aren't built yet, so this can't be completed.
    { done: false, label: 'Set up payouts', sub: 'Coming soon: bank payouts aren’t available yet', Icon: CreditCard, disabled: true },
    { done: packageCount > 0, label: 'Add a package', sub: 'Clients book a package', Icon: Package, tab: 'packages' },
    visual && { done: albumCount > 0, label: 'Add portfolio work', sub: 'Post at least one album', Icon: Images, tab: 'portfolio' },
    { done: !!provider?.location, label: 'Set your service area', sub: 'Where you’re based and how far you travel', Icon: MapPin, tab: 'calendar' },
  ].filter(Boolean)
  const doneCount = steps.filter((s) => s.done).length

  const openTab = (t) => {
    setTab(t)
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mode-body">
      <ListingSwitch />
      {detail.loading && !provider ? null : doneCount < steps.length ? (
        <div className="pad-x">
          <div className="checklist">
            <div className="row between">
              <b>Get ready to take bookings</b>
              <span className="small muted">{doneCount} of {steps.length}</span>
            </div>
            <div className="progress mt-sm"><div style={{ width: `${(doneCount / steps.length) * 100}%` }} /></div>
            {steps.map(({ done, label, sub, Icon, to, disabled, tab: t }) => {
              const inner = (
                <>
                  <span className={`check-circle ${done ? 'done' : ''}`}>{done ? <Check size={14} strokeWidth={3} /> : <Icon size={14} />}</span>
                  <div className="grow">
                    <div className="small">{label}</div>
                    {!done && <div className="muted tiny">{sub}</div>}
                  </div>
                  {!done && !disabled && <ChevronRight size={16} className="muted" />}
                </>
              )
              const cls = `check-item ${done ? 'done' : ''}`
              if (done || disabled) return <div key={label} className={cls}>{inner}</div>
              if (to) return <Link key={label} to={to} className={cls}>{inner}</Link>
              return <button key={label} className={cls} onClick={() => openTab(t)}>{inner}</button>
            })}
          </div>
        </div>
      ) : (
        <div className="pad-x">
          <div className="callout live">
            <div className="inline-icon"><ShieldCheck size={16} /> <b>You're live</b></div>
            <div className="muted small">Clients can find and book you.</div>
          </div>
        </div>
      )}

      <div className="stat-tiles">
        <StatTile value={bookings.loading ? '…' : pending} label="New requests" onClick={() => openTab('requests')} highlight={pending > 0} />
        <StatTile value={bookings.loading ? '…' : bookedThisMonth} label={`Booked in ${monthName}`} onClick={() => openTab('calendar')} />
        <StatTile value={rating(provider?.rating) ?? 'New'} label="Your rating" />
      </div>

      <div ref={tabsRef} className="tabs-anchor" />
      <Dashboard tab={tab} onTabChange={setTab} provider={provider} bookings={bookings} onProviderChanged={detail.reload} />
    </div>
  )
}

// Your listings (one per vertical): switch between them, or add another service.
function ListingSwitch() {
  const { myProvider, myProviders, selectProvider } = useStore()
  return (
    <div className="listing-switch" aria-label="Your listings">
      {myProviders.map((p) => (
        <button
          key={p.id}
          className={`chip toggle ${p.id === myProvider?.id ? 'on' : ''}`}
          aria-pressed={p.id === myProvider?.id}
          onClick={() => selectProvider(p.id)}
          title={p.display_name}
        >
          <VerticalIcon vertical={p.vertical} size={13} /> {myProviders.length > 1 ? verticalMeta(p.vertical).name : p.display_name}
        </button>
      ))}
      <Link to="/new-listing" className="chip toggle"><Plus size={13} /> Add a service</Link>
    </div>
  )
}
