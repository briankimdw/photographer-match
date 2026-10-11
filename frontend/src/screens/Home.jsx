import { Link } from 'react-router-dom'
import { LayoutGrid, Plus } from 'lucide-react'
import ProfileLink from '../components/ProfileLink.jsx'
import SearchLauncher from '../components/SearchLauncher.jsx'
import PlanCard from '../components/planner/PlanCard.jsx'
import EventsShelf from '../components/events/EventsShelf.jsx'
import { StatusPill } from '../components/Booking.jsx'
import { ErrorState } from '../components/States.jsx'
import { CardsSkeleton, ProviderCard, ProviderRow, RowsSkeleton, SectionHead } from '../components/home/Cards.jsx'
import { ComingSoonCard, OccasionRow, VerticalRail } from '../components/home/Browse.jsx'
import { useAuth } from '../auth.jsx'
import useQuery from '../lib/useQuery.js'
import { fmtChip, today } from '../lib/dates.js'
import { listMyBookings } from '../api/bookings.js'
import { buildHomeFeed, comingWeekend, listBrowseProviders, listExplorePhotos, weekendAvailability } from '../api/home.js'

// Booking states where the client has something to do.
const NEEDS_ACTION = {
  accepted: 'Pay the deposit to lock in your date',
  countered: 'Review the counter offer',
  delivered: 'Your photos are ready',
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

// Home = plan & browse: search, the AI planner, every service as a tinted icon,
// occasions, then intent shelves ("free this weekend", "top rated") from real data.
export default function Home() {
  const { user, profile } = useAuth()
  const uid = user?.id ?? null
  const firstName = (profile?.display_name || '').split(' ')[0]

  const weekendDays = comingWeekend()
  const all = useQuery(() => listBrowseProviders(), [uid])
  const weekend = useQuery(() => weekendAvailability(), [])
  const photos = useQuery(() => listExplorePhotos(), [])
  const bookings = useQuery(uid ? () => listMyBookings() : null, [uid])

  const feed = buildHomeFeed({
    providers: all.data || [],
    weekend: weekend.data || new Map(),
    weekendLabel: weekendDays.map(fmtChip).join(' – '),
  })
  const loading = all.loading && !all.data
  const mixed = feed.live.length > 1

  const myBookings = bookings.data || []
  const actionItems = myBookings.filter((b) => b.role === 'client' && NEEDS_ACTION[b.status])
  const upcoming = myBookings
    .filter((b) => ['requested', 'confirmed'].includes(b.status) && b.day >= today())
    .sort((a, b) => a.start - b.start)
  const bookingTiles = [...actionItems, ...upcoming]

  // Three real portfolio shots (different providers) for the Explore teaser.
  const teaser = []
  for (const ph of photos.data || []) {
    if (teaser.length === 3) break
    if (!teaser.some((t) => t.providerId === ph.providerId)) teaser.push(ph)
  }

  const [firstShelf, ...otherShelves] = all.data ? feed.shelves : []

  return (
    <div className="home">
      <header className="home-header">
        <div>
          <div className="hd-greet">{firstName ? `${greeting()}, ${firstName}` : greeting()}</div>
          <h1 className="hd-title">What are you planning?</h1>
        </div>
        <Link to="/upload" className="post-btn" aria-label="Post your work">
          <Plus size={18} aria-hidden="true" /> Post
        </Link>
      </header>

      <div className="pad-x">
        <SearchLauncher placeholder="Photographers, venues, caterers…" />
      </div>

      {bookings.error && (
        <section>
          <SectionHead title="Your bookings" to="/bookings" />
          <ErrorState error={bookings.error} onRetry={bookings.reload} />
        </section>
      )}
      {bookingTiles.length > 0 && (
        <section>
          <SectionHead title={actionItems.length ? 'Needs your attention' : 'Your bookings'} to="/bookings" />
          <div className="h-scroll">
            {bookingTiles.map((b) => (
              <Link key={b.id} to={`/bookings/${b.id}`} className={`booking-tile ${NEEDS_ACTION[b.status] ? 'action' : ''}`}>
                <ProfileLink id={b.provider.id} className="row gap-xs" preview={{ src: b.provider.avatar, name: b.provider.name }}>
                  <img className="avatar sm" src={b.provider.avatar} alt="" />
                  <b className="small grow ellipsis">{b.provider.name}</b>
                </ProfileLink>
                <div className="small mt-xs">{b.packageName}</div>
                <div className="muted tiny">{b.date}</div>
                <div className="mt-sm">
                  {NEEDS_ACTION[b.status] ? <span className="action-text">{NEEDS_ACTION[b.status]} →</span> : <StatusPill status={b.status} />}
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <EventsShelf />

      <section>
        <SectionHead title="Browse services" sub="Everything for your event, in one place" />
        <VerticalRail counts={all.data ? feed.counts : null} />
      </section>

      <div className="pad-x">
        <PlanCard />
      </div>

      <section>
        <SectionHead title="Plan by occasion" sub="A checklist of who you’ll need" />
        <OccasionRow />
      </section>

      {all.error && (
        <section>
          <ErrorState error={all.error} onRetry={all.reload} />
        </section>
      )}
      {loading && (
        <section>
          <SectionHead title="Free this weekend" />
          <CardsSkeleton />
        </section>
      )}
      {firstShelf && <Shelf shelf={firstShelf} mixed={mixed} weekendLoading={weekend.loading} />}

      {teaser.length === 3 && (
        <div className="pad-x mt-lg">
          <Link to="/discover?mode=explore" className="hd-explore">
            <span className="hd-explore-stack">
              {teaser.map((t) => <img key={t.id} src={t.src} alt="" />)}
            </span>
            <span className="grow">
              <b>Not sure what you want?</b>
              <span className="small block">Browse real work from local pros, then tap what you love.</span>
            </span>
            <LayoutGrid size={20} />
          </Link>
        </div>
      )}

      {otherShelves.map((s) => (
        <Shelf key={s.key} shelf={s} mixed={mixed} weekendLoading={weekend.loading} />
      ))}
      {loading && (
        <section>
          <SectionHead title="New on photomatch" />
          <RowsSkeleton />
        </section>
      )}

      {all.data && feed.soon.length > 0 && (
        <section className="pad-x">
          <ComingSoonCard soon={feed.soon} />
        </section>
      )}
      <div className="mt-lg" />
    </div>
  )
}

function Shelf({ shelf, mixed, weekendLoading = false }) {
  const showVertical = mixed && !shelf.vertical
  if (shelf.key === 'weekend' && weekendLoading) {
    return (
      <section>
        <SectionHead title={shelf.title} sub={shelf.sub} />
        <CardsSkeleton />
      </section>
    )
  }
  if (!shelf.items.length && !shelf.empty) return null
  return (
    <section>
      <SectionHead title={shelf.title} sub={shelf.sub} to={shelf.items.length ? shelf.to : null} />
      {!shelf.items.length ? (
        <div className="pad-x muted small">{shelf.empty}</div>
      ) : shelf.layout === 'rows' ? (
        <div className="pad-x">
          {shelf.items.map((p) => <ProviderRow key={p.id} p={p} showVertical={showVertical} />)}
        </div>
      ) : (
        <div className="h-scroll hd-shelf">
          {shelf.items.map((p) => <ProviderCard key={p.id} p={p} showVertical={showVertical} />)}
        </div>
      )}
    </section>
  )
}
