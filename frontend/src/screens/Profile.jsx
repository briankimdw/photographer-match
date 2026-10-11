import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  CalendarCheck, CalendarX, Camera, CircleDot, Copy, MapPin, MessageCircle, MoreHorizontal, Send, Clock, Images, Sparkles,
  Heart, Plus, UserX, Package, Star, ChevronRight,
} from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import Segmented from '../components/Segmented.jsx'
import Stars from '../components/Stars.jsx'
import { IdVerified, ProBadge } from '../components/Badges.jsx'
import { ViewableAvatar } from '../components/AvatarViewer.jsx'
import ReviewList from '../components/Reviews.jsx'
import FollowersSheet from '../components/FollowersSheet.jsx'
import { PolicyTable, priceLabel } from '../components/Booking.jsx'
import { ModerationSheet, ShareSheet } from '../components/PostSheets.jsx'
import SendToSheet from '../components/share/ShareSheet.jsx'
import { AddToEventButton } from '../components/events/EventParts.jsx'
import { EmptyState, ErrorState, Loading } from '../components/States.jsx'
import { MapPreview } from '../components/map/LazyMap.jsx'
import AttributeList from '../components/verticals/AttributeList.jsx'
import { VerticalTag } from '../components/verticals/VerticalIcon.jsx'
import { attributeLines, verticalConfig } from '../verticals/index.js'
import { useStore } from '../store.jsx'
import { useAuth } from '../auth.jsx'
import useQuery from '../lib/useQuery.js'
import { addDays, fmtBooking, fmtChip, fmtMonth, fromKey, parseDates, toKey, today } from '../lib/dates.js'
import { freeDays, getCategories, getPerson, getProvider } from '../api/catalog.js'
import { listAlbums, listTaggedAlbums, toViewerAlbum } from '../api/portfolio.js'
import { messageError, startDirectMessage, startInquiry } from '../api/messages.js'

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

// The days the availability strip shows: the next two weeks, starting tomorrow.
export const stripDates = (count = 14) => {
  const start = today()
  return Array.from({ length: count }, (_, i) => addDays(start, i + 1))
}

// Next two weeks as day buttons, with booked days struck through.
//   free:        Set of 'YYYY-MM-DD' the photographer is free on (from freeDays), or
//   providerId:  load that Set here (one freeDays call), or
//   unavailable: legacy list of day indexes (0..13) that are busy.
//   selected:    a label ("Oct 10, 2026") or 'YYYY-MM-DD' key, or an array of either.
//   onSelect(label, key) makes days tappable. pending: dims the strip while `free` loads.
export function AvailabilityStrip({ free, providerId, unavailable, selected, onSelect, pending = false }) {
  const days = useMemo(() => stripDates(), [])
  const { data: loaded } = useQuery(providerId && !free ? () => freeDays(providerId, days) : null, [providerId, !!free])
  const freeSet = free || loaded
  const picked = Array.isArray(selected) ? selected : selected ? [selected] : []
  return (
    <div className={`avail-strip ${pending || (providerId && !freeSet) ? 'pending' : ''}`} role="group" aria-label="Availability, next 2 weeks"
      aria-busy={pending || (providerId && !freeSet) ? true : undefined} tabIndex={onSelect ? undefined : 0}>
      {days.map((d, i) => {
        const key = toKey(d)
        const label = fmtBooking(d)
        const busy = freeSet ? !freeSet.has(key) : !providerId && !!unavailable?.includes(i)
        const on = picked.includes(label) || picked.includes(key)
        return (
          <button
            key={key}
            className={`avail-day ${busy ? 'busy' : ''} ${on ? 'on' : ''}`}
            disabled={busy || !onSelect}
            aria-pressed={onSelect && !busy ? on : undefined}
            aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}, ${busy ? 'not available' : 'available'}`}
            onClick={() => onSelect?.(label, key)}
          >
            <span aria-hidden="true">{DAYS[d.getDay()]}</span>
            <b aria-hidden="true">{d.getDate()}</b>
          </button>
        )
      })}
    </div>
  )
}

// getPerson, but a username that belongs to a photographer opens their listing.
async function loadPerson(id) {
  const person = await getPerson(id)
  if (person?.kind === 'person') return (await getProvider(person.id)) || person
  return person
}

export default function Profile() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { following, toggleFollow, shortlist, toggleShortlist, toast } = useStore()
  const startTab = params.get('tab')
  const [tab, setTab] = useState(TABS.includes(startTab) ? startTab : null) // null = the first tab for this profile
  const [share, setShare] = useState(false)
  const [followers, setFollowers] = useState(false)
  const tabsRef = useRef()
  const [menu, setMenu] = useState(false)
  const [contacting, setContacting] = useState(false)

  const { data: person, loading, error, reload } = useQuery(() => loadPerson(id), [id])
  const provider = person?.kind === 'provider' ? person : null
  // Visual verticals (photography, venues, florals...) lead with their portfolio; others
  // (DJs, planners, officiants, staff) with packages and reviews.
  const visual = provider ? provider.verticalInfo?.visual !== false : true
  const tabs = !provider
    ? []
    : [
        ...(visual ? ['portfolio'] : []),
        'packages',
        ...(['photography', 'videography'].includes(provider.vertical) || provider.gear.bodies.length || provider.gear.lenses.length ? ['gear'] : []),
        'reviews',
        ...(!visual && provider.albumCount > 0 ? ['portfolio'] : []),
      ]
  const activeTab = tabs.includes(tab) ? tab : tabs[0]
  const config = verticalConfig(provider?.vertical)
  // Specialties that are also service categories link to that category's search.
  const { data: categories } = useQuery(provider?.specialties?.length ? () => getCategories() : null, [provider?.id])
  const myServices = categories?.find((v) => v.slug === provider?.vertical)?.services || []
  const categoryFor = (name) => myServices.find((c) => c.name.toLowerCase() === name.toLowerCase())?.slug

  // Switch tab and scroll down to it (the star rating opens Reviews).
  const showTab = (next) => {
    setTab(next)
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  // Opened on a tab (e.g. /u/:id?tab=reviews from a rating elsewhere): start scrolled to it.
  useEffect(() => {
    if (provider && TABS.includes(startTab) && startTab !== tabs[0]) {
      requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ block: 'start' }))
    }
  }, [!!provider]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: albums, loading: albumsLoading, error: albumsError, reload: reloadAlbums } = useQuery(
    provider && (visual || provider.albumCount > 0) ? () => listAlbums(provider.id).then((rows) => rows.filter((a) => a.photos?.length).map(toViewerAlbum)) : null,
    [provider?.id],
  )

  // Other vendors' posts that credit this one ("Catering by Golden Spoon" on a wedding album).
  // Empty (and the section hidden) until the album_credits migration exists.
  const { data: tagged } = useQuery(provider ? () => listTaggedAlbums(provider.id) : null, [provider?.id])

  // Dates carried over from a date search, plus the strip's two weeks: one availability lookup.
  const datesParam = params.get('dates') || ''
  const dates = parseDates(datesParam)
  const stripKeys = useMemo(() => stripDates().map(toKey), [])
  const { data: free } = useQuery(
    provider ? () => freeDays(provider.id, [...new Set([...stripKeys, ...dates])]) : null,
    [provider?.id, datesParam],
  )
  const freeDates = free ? dates.filter((k) => free.has(k)) : []
  const datesQuery = freeDates.length ? `dates=${freeDates.join(',')}` : ''

  if (loading) return (<div><TopBar title="" /><Loading /></div>)
  if (error) return (<div><TopBar title="" /><ErrorState error={error} onRetry={reload} /></div>)
  if (!person) {
    return (
      <div>
        <TopBar title="" />
        <EmptyState icon={UserX} title="Profile not found" text="This account doesn’t exist or is no longer available."
          action={<Link to="/" className="btn sm">Go home</Link>} />
      </div>
    )
  }

  const isMine = !!user && person.profileId === user.id
  const handle = person.username || provider?.slug
  const link = `/u/${provider ? provider.slug : person.username || person.id}`
  const firstName = person.shortName || (person.name || '').split(' ')[0]

  const contact = async () => {
    if (!user) return navigate(`/sign-in?next=${encodeURIComponent(pathname + search)}`)
    if (contacting) return
    setContacting(true)
    try {
      // Photographers get an inquiry thread (tied to their listing); anyone else a direct message.
      const conversationId = provider ? await startInquiry(provider.id) : await startDirectMessage(person.profileId)
      navigate(`/inbox/${conversationId}`)
    } catch (e) {
      console.warn(e)
      toast(messageError(e))
      setContacting(false)
    }
  }

  return (
    <div>
      <TopBar
        title={handle ? `@${handle}` : person.name}
        right={
          <>
            {provider && !isMine && (
              <button className="icon-btn" onClick={() => toggleShortlist(provider.id)} aria-label={shortlist.has(provider.id) ? 'Remove from shortlist' : 'Save to shortlist'}>
                <Heart size={20} fill={shortlist.has(provider.id) ? 'currentColor' : 'none'} />
              </button>
            )}
            <button className="icon-btn" onClick={() => setShare(true)} aria-label="Share"><Send size={20} /></button>
            {!isMine && <button className="icon-btn" onClick={() => setMenu(true)} aria-label="More"><MoreHorizontal size={20} /></button>}
          </>
        }
      />
      {provider?.cover && <img className="cover" src={provider.cover} alt="" />}
      <div className={`profile-head ${provider?.cover ? 'has-cover' : ''}`}>
        <ViewableAvatar src={person.avatar} name={person.name} username={handle} />
        <h2>
          {person.name} {provider?.idVerified && <IdVerified label explain name={person.name} />} {provider?.pro && <ProBadge explain name={person.name} />}
        </h2>
        <div className="row gap-xs wrap profile-where">
          {provider && <Link to={`/search?v=${provider.vertical}`} aria-label={`More ${provider.verticalInfo.plural}`}><VerticalTag vertical={provider.vertical} /></Link>}
          {person.city && (provider?.location ? (
            <Link to={`/search?view=map&v=${provider.vertical}&focus=${provider.id}`} className="muted small inline-icon tap-text" aria-label={`${person.city}: see ${firstName} on the map`}>
              <MapPin size={13} /> {person.city}
            </Link>
          ) : (
            <div className="muted small inline-icon">
              <MapPin size={13} /> {person.city}
            </div>
          ))}
        </div>
        {provider && (
          <div className="row gap-xs small mt-xs">
            {provider.rating != null ? (
              <button className="tap-text rating-link" onClick={() => showTab('reviews')} aria-label={`Rated ${provider.rating.toFixed(1)} from ${provider.reviewCount} review${provider.reviewCount === 1 ? '' : 's'}. Show reviews`}>
                <Stars value={provider.rating} /> <b>{provider.rating.toFixed(1)}</b>
                <span className="muted">({provider.reviewCount} review{provider.reviewCount === 1 ? '' : 's'})</span>
              </button>
            ) : (
              <span className="chip">New</span>
            )}
            <span className="muted">·</span>
            {provider.followers > 0 ? (
              <button className="tap-text muted" onClick={() => setFollowers(true)}>
                <b className="ink">{provider.followers}</b> follower{provider.followers === 1 ? '' : 's'}
              </button>
            ) : (
              <span className="muted">No followers yet</span>
            )}
          </div>
        )}
        {!provider && person.clientRating != null && (
          <div className="row gap-xs small mt-xs">
            <Stars value={person.clientRating} /> <b>{person.clientRating.toFixed(1)}</b>
            <span className="muted">as a client ({person.clientReviews} review{person.clientReviews === 1 ? '' : 's'})</span>
          </div>
        )}
        {!provider && person.createdAt && <div className="muted tiny">Joined {fmtMonth(new Date(person.createdAt))}</div>}
        {person.bio && <p className="mt-sm">{person.bio}</p>}
        {provider?.specialties?.length > 0 && (
          <div className="chips center">
            {provider.specialties.map((s) => {
              const slug = categoryFor(s)
              // Service categories filter by category; anything else (e.g. "Nightlife") is a text search.
              const to = slug ? `/search?v=${provider.vertical}&cat=${encodeURIComponent(slug)}` : `/search?v=${provider.vertical}&q=${encodeURIComponent(s)}`
              return <Link key={s} to={to} className="chip chip-link">{s}</Link>
            })}
          </div>
        )}
        {provider && !isMine && (
          <>
            <div className="row gap-xs mt full">
              <button className={`btn grow ${following.has(provider.id) ? 'ghost' : ''}`} onClick={() => toggleFollow(provider.id)}>
                {following.has(provider.id) ? 'Following' : 'Follow'}
              </button>
              <button className="btn ghost grow" onClick={contact} disabled={contacting}>
                <MessageCircle size={16} /> {contacting ? 'Opening…' : 'Ask a question'}
              </button>
            </div>
            <div className="row gap-xs mt-sm full">
              <AddToEventButton provider={provider} variant="button" />
              <Link to={`/book/${provider.id}${datesQuery && `?${datesQuery}`}`} className="btn accent grow">
                Book {firstName}
              </Link>
            </div>
          </>
        )}
        {!provider && !isMine && (
          <button className="btn block mt" onClick={contact} disabled={contacting}>
            <MessageCircle size={16} /> {contacting ? 'Opening…' : `Message ${firstName}`}
          </button>
        )}
        {provider && isMine && (
          <div className="row gap-xs mt full">
            <Link to="/upload" className="btn grow"><Plus size={16} /> Post photos</Link>
            {provider.albumCount > 0 ? (
              <Link to="/my-work" className="btn ghost grow"><Images size={16} /> My work</Link>
            ) : (
              <Link to="/me" className="btn ghost grow"><Package size={16} /> Packages</Link>
            )}
          </div>
        )}
      </div>

      {provider && dates.length > 0 && (
        <div className="pad-x">
          <div className="info-card your-dates">
            <div className="small"><b>Your dates</b></div>
            <div className="chips mt-sm">
              {dates.map((k) => {
                const isFree = freeDates.includes(k)
                return (
                  <span key={k} className={`chip avail-chip ${!free ? '' : isFree ? 'free' : 'busy'}`}>
                    {isFree ? <CalendarCheck size={12} /> : <CalendarX size={12} />} {fmtChip(fromKey(k))}
                    {free && ` · ${isFree ? 'Free' : 'Booked'}`}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {provider && (
        <div className="pad-x">
          <div className="info-card">
            <div className="row between">
              <div className="small"><b>Availability</b> · next 2 weeks</div>
              <div className="muted tiny">{provider.serviceArea}</div>
            </div>
            <AvailabilityStrip free={free} pending={!free} />
          </div>
        </div>
      )}

      {provider && attributeLines(config.providerFields.filter((f) => f.key !== 'specialties'), provider.attributes).length > 0 && (
        <div className="pad-x">
          <div className="info-card mt-sm">
            <div className="small"><b>About {firstName}</b></div>
            <AttributeList fields={config.providerFields.filter((f) => f.key !== 'specialties')} attrs={provider.attributes} />
          </div>
        </div>
      )}

      {provider && tagged?.length > 0 && (
        <section className="tagged mt">
          <div className="section-head">
            <div className="grow">
              <h3>Tagged in</h3>
              <div className="muted tiny">Posts by other vendors that credit {firstName}</div>
            </div>
          </div>
          <div className="h-scroll">
            {tagged.map((a) => (
              <Link key={a.id} to={`/gallery/${a.by.id}?post=${a.id}`} className="tagged-tile" title={a.title}>
                <img src={a.cover} alt="" loading="lazy" />
                <b className="ellipsis">{a.title}</b>
                <span className="muted tiny ellipsis">by {a.by.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {provider && (
        <div className="pad-x mt profile-tabs" ref={tabsRef}>
          <Segmented
            options={tabs.map((t) => ({ value: t, label: TAB_LABELS[t] }))}
            value={activeTab}
            onChange={setTab}
          />
        </div>
      )}

      {provider && activeTab === 'portfolio' && (
        <>
          {albumsLoading && <Loading inline />}
          {albumsError && <ErrorState error={albumsError} onRetry={reloadAlbums} />}
          {albums?.length === 0 && (
            <div className="pad">
              <EmptyState compact icon={Images} title="No albums yet"
                text={isMine ? 'Post your first album and it will show up here.' : `${firstName} hasn’t posted any work yet.`}
                action={isMine ? <Link to="/upload" className="btn sm">Post photos</Link> : null} />
            </div>
          )}
          {albums?.length > 0 && (
            <div className="grid3 mt-sm">
              {albums.map((a) => (
                <Link
                  key={a.id}
                  to={a.status === 'under_review' && isMine ? `/ai-review/${a.id}` : `/gallery/${provider.id}?post=${a.id}`}
                  className="album-tile"
                  title={a.title}
                >
                  <img src={a.cover} alt="" loading="lazy" />
                  {a.photos.length > 1 && (
                    <span className="album-count"><Copy size={12} /> {a.photos.length}</span>
                  )}
                  {a.status && a.status !== 'published' && <span className="album-status">{ALBUM_STATUS[a.status] || a.status}</span>}
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {provider && activeTab === 'packages' && (
        <div className="pad">
          {provider.packages.length === 0 && (
            <EmptyState compact icon={Package} title="No packages listed yet" text={isMine ? null : 'Ask a question to get a quote.'} />
          )}
          {provider.packages.map((pkg) => {
            const Card = isMine ? 'div' : Link
            const cardProps = isMine ? {} : { to: `/book/${provider.id}?pkg=${pkg.id}${datesQuery && `&${datesQuery}`}` }
            return (
            <Card key={pkg.id} className={`package-card ${isMine ? '' : 'tappable'}`} {...cardProps}>
              <div className="row between">
                <h4>{pkg.name}</h4>
                <b>{priceLabel(pkg)}</b>
              </div>
              <PackageFacts pkg={pkg} config={config} />
              {pkg.description && <div className="small">{pkg.description}</div>}
              <AttributeList fields={config.packageFields.filter((f) => !config.packageKeys.includes(f.key))} attrs={pkg.attributes} />
              {pkg.depositPct != null && <div className="muted small">{pkg.depositPct}% deposit to confirm</div>}
              {!isMine && (
                <span className="btn sm mt-sm pkg-select" aria-hidden="true">Select <ChevronRight size={14} /></span>
              )}
            </Card>
            )
          })}
          {provider.addons?.length > 0 && (
            <>
              <h2 className="section-title h4">Add-ons</h2>
              {provider.addons.map((a) => (
                <div key={a.id} className="row between small line">
                  <span>{a.name}</span>
                  <span>{a.price == null ? 'Quote' : `+$${a.price.toLocaleString()}`}</span>
                </div>
              ))}
            </>
          )}
          <h2 className="section-title h4">Service area</h2>
          <div className="small">{provider.serviceArea}</div>
          <div className="muted small">Travel fee: {provider.travelFee}</div>
          {provider.location && (
            <Link to={`/search?view=map&focus=${provider.id}`} className="area-preview" aria-label={`See where ${firstName} travels on the map`}>
              <MapPreview location={provider.location} radiusKm={provider.radiusKm} avatar={provider.avatar} />
              <span className="area-preview-open"><MapPin size={13} /> Open map</span>
            </Link>
          )}
          <div className="mt">
            <PolicyTable policy={provider.cancellationPolicy} />
          </div>
        </div>
      )}

      {provider && activeTab === 'gear' && (
        <div className="pad">
          {!provider.gear.bodies.length && !provider.gear.lenses.length && (
            <EmptyState compact icon={Camera} title="No gear listed yet" />
          )}
          {provider.gear.bodies.length > 0 && (
            <>
              <h2 className="section-title h4">Bodies</h2>
              {provider.gear.bodies.map((g) => (
                <div key={g} className="gear-row"><Camera size={16} /> {g}</div>
              ))}
            </>
          )}
          {provider.gear.lenses.length > 0 && (
            <>
              <h2 className="section-title h4">Lenses</h2>
              {provider.gear.lenses.map((g) => (
                <div key={g} className="gear-row"><CircleDot size={16} /> {g}</div>
              ))}
            </>
          )}
        </div>
      )}

      {provider && activeTab === 'reviews' && (
        <div className="pad">
          {provider.rating != null ? (
            <div className="rating-summary">
              <div className="big">{provider.rating.toFixed(1)}</div>
              <div>
                <Stars value={provider.rating} size={16} />
                <div className="muted small">{provider.reviewCount} review{provider.reviewCount === 1 ? '' : 's'} from completed bookings</div>
              </div>
            </div>
          ) : (
            <EmptyState compact icon={Star} title="No reviews yet" text="Reviews appear here after completed bookings." />
          )}
          {provider.rating != null && provider.reviews.length === 0 && <div className="muted small mt">No written reviews yet.</div>}
          <ReviewList reviews={provider.reviews} provider={provider} here />
        </div>
      )}

      {provider && (
        <FollowersSheet open={followers} onClose={() => setFollowers(false)} providerId={provider.id} count={provider.followers} />
      )}
      {provider ? (
        share && (
          <SendToSheet
            item={{ kind: 'provider', id: provider.id, link, title: provider.name, subtitle: [provider.verticalInfo?.name, provider.city?.split(',')[0]].filter(Boolean).join(' · '), image: provider.avatar }}
            onClose={() => setShare(false)}
          />
        )
      ) : (
        <ShareSheet
          open={share}
          onClose={() => setShare(false)}
          link={link}
          payload={{ text: `Check out ${handle ? `@${handle}` : person.name}: ${window.location.origin}${link}` }}
        />
      )}
      <ModerationSheet
        open={menu}
        onClose={() => setMenu(false)}
        what="profile"
        username={person.username}
        target={provider ? { type: 'provider', id: provider.id } : { type: 'profile', id: person.id }}
        blockProfileId={person.profileId}
      />
    </div>
  )
}

const TABS = ['portfolio', 'packages', 'gear', 'reviews']
const TAB_LABELS = { portfolio: 'Portfolio', packages: 'Packages', gear: 'Gear', reviews: 'Reviews' }

// A package's key facts as icon chips: hours, then the vertical's headline fields
// (edited photos and turnaround for photography, guests for catering...).
function PackageFacts({ pkg, config }) {
  const lines = attributeLines(config.packageFields, pkg.attributes, config.packageKeys)
  if (!pkg.hours && !lines.length) return null
  return (
    <div className="pkg-facts">
      {pkg.hours && <span><Clock size={13} /> {pkg.hours}h</span>}
      {lines.map((l) => <span key={l}><Sparkles size={13} /> {l}</span>)}
    </div>
  )
}
const ALBUM_STATUS = { processing: 'Processing', under_review: 'In review', hidden: 'Hidden' }
