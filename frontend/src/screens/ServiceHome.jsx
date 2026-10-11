import { useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, Map as MapIcon, Search as SearchIcon, Send, Store, Tag } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import useDocumentTitle from '../components/useDocumentTitle.js'
import { EmptyState, ErrorState } from '../components/States.jsx'
import { CardsSkeleton, ProviderCard, ProviderRow, RowsSkeleton, SectionHead } from '../components/home/Cards.jsx'
import { TintIcon } from '../components/home/CatalogIcon.jsx'
import { useInvite } from '../components/home/Browse.jsx'
import useQuery from '../lib/useQuery.js'
import { fmtChip, toKey } from '../lib/dates.js'
import { money } from '../lib/format.js'
import { buildVerticalPage, comingWeekend, listBrowseProviders, liveVerticals, pluralLower, weekendAvailability, withArticle } from '../api/home.js'
import { getVertical, unitLabel } from '../verticals/catalog.js'

// /services/:vertical — a vertical's landing page: hero, service chips, shelves of
// providers, a map link, and a "list your services" call for providers.
// With no providers yet it shows an intentional "coming soon" state instead.
export default function ServiceHome() {
  const { vertical: slug } = useParams()
  const vertical = getVertical(slug)
  useDocumentTitle(vertical?.name)
  if (!vertical) {
    return (
      <>
        <TopBar title="Services" />
        <EmptyState icon={SearchIcon} title="We don’t have that service" text="Browse every service from Home." action={<Link className="btn" to="/">Go home</Link>} />
      </>
    )
  }
  return <VerticalPage key={slug} vertical={vertical} />
}

function VerticalPage({ vertical: v }) {
  const navigate = useNavigate()
  const invite = useInvite()
  const [params, setParams] = useSearchParams()
  const service = params.get('s')
  const setService = (s) => {
    const p = new URLSearchParams(params)
    s ? p.set('s', s) : p.delete('s')
    setParams(p, { replace: true })
  }

  // Arriving with ?s= picked: bring that chip into view.
  useEffect(() => {
    document.querySelector('.svc .chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [])

  const providers = useQuery(() => listBrowseProviders(), [])
  const weekend = useQuery(() => weekendAvailability(v.slug), [v.slug])
  const page = buildVerticalPage({ vertical: v, providers: providers.data || [], weekend: weekend.data || new Map(), service })
  const loading = providers.loading && !providers.data
  const empty = !!providers.data && page.total === 0
  const unit = unitLabel(v.priceUnit)
  const serviceName = v.services.find((s) => s.slug === service)?.name
  const searchQs = `v=${v.slug}${service ? `&cat=${service}` : ''}`
  const weekendKeys = comingWeekend().map(toKey)
  const others = providers.data ? liveVerticals(providers.data, v.slug) : []

  return (
    <div className="svc" style={{ '--tint': v.tint }}>
      <div className="hd-float-bar">
        <div>
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
            <ChevronLeft size={24} />
          </button>
          {!empty && (
            <Link to={`/search?${searchQs}`} className="icon-btn" aria-label={`Search ${pluralLower(v)}`}>
              <SearchIcon size={20} />
            </Link>
          )}
        </div>
      </div>
      <div className="svc-hero">
        <TintIcon item={v} size={56} className="on-card" />
        <h1>{v.name}</h1>
        <p className="muted small">{v.tagline}</p>
        <div className="hd-hero-meta">
          {loading ? (
            <span className="hd-meta-pill">Loading…</span>
          ) : empty ? (
            <span className="hd-meta-pill soon">Coming soon near you</span>
          ) : (
            <span className="hd-meta-pill">{page.total} {page.total === 1 ? v.noun : pluralLower(v)}</span>
          )}
          {page.minPrice != null && <span className="hd-meta-pill"><Tag size={12} /> from {money(page.minPrice)}{unit ? ` ${unit}` : ''}</span>}
          {page.minPrice == null && unit && <span className="hd-meta-pill">Priced {unit}</span>}
        </div>
        {!empty && !loading && (
          <div className="svc-actions">
            <Link to={`/search?${searchQs}&view=map`} className="btn ghost"><MapIcon size={16} /> Map</Link>
            <Link to={`/search?${searchQs}`} className="btn"><SearchIcon size={16} /> See all</Link>
          </div>
        )}
      </div>

      {/* Service chips filter the shelves below (Airbnb's category bar). */}
      {!empty && (
        <div className="chips scroll-x pad-x" role="group" aria-label={`${v.name} services`}>
          <button className={`chip toggle ${!service ? 'on' : ''}`} aria-pressed={!service} onClick={() => setService(null)}>All</button>
          {v.services.map((s) => (
            <button key={s.slug} className={`chip toggle ${service === s.slug ? 'on' : ''}`} aria-pressed={service === s.slug} onClick={() => setService(s.slug)}>
              {s.name}
              {page.offered.get(s.slug) ? <span className="chip-count">{page.offered.get(s.slug)}</span> : null}
            </button>
          ))}
        </div>
      )}

      {providers.error && <ErrorState error={providers.error} onRetry={providers.reload} />}

      {loading && (
        <>
          <section><SectionHead title="Free this weekend" /><CardsSkeleton /></section>
          <section><SectionHead title={`All ${pluralLower(v)}`} /><RowsSkeleton /></section>
        </>
      )}

      {empty && (
        <>
          <div className="svc-empty">
            <b>No {pluralLower(v)} here yet</b>
            <p className="muted small">
              We’re bringing {pluralLower(v)} to the app. Invite {withArticle(v.noun)} you love so you can book them here, or be the first to list.
            </p>
            <button className="btn block mt" onClick={() => invite(v)}><Send size={15} /> Invite {withArticle(v.noun)}</button>
            <Link className="btn ghost block mt-sm" to={`/new-listing?v=${v.slug}`}><Store size={15} /> List your services</Link>
          </div>
          <section>
            <SectionHead title="What you’ll be able to book" />
            <div className="chips pad-x">
              {v.services.map((s) => <span key={s.slug} className="chip">{s.name}</span>)}
            </div>
          </section>
        </>
      )}

      {!loading && !empty && providers.data && (
        <>
          {page.list.length === 0 ? (
            <section>
              <EmptyState
                compact
                title={`No ${pluralLower(v)} offer ${serviceName?.toLowerCase() ?? 'this'} yet`}
                text="Try another service, or see everyone."
                action={<button className="btn sm ghost" onClick={() => setService(null)}>Show all {pluralLower(v)}</button>}
              />
            </section>
          ) : (
            <>
              <section>
                <SectionHead
                  title="Free this weekend"
                  sub={comingWeekend().map(fmtChip).join(' – ')}
                  to={page.free.length ? `/search?${searchQs}&dates=${weekendKeys.join(',')}` : null}
                />
                {weekend.loading ? (
                  <CardsSkeleton />
                ) : page.free.length ? (
                  <div className="h-scroll">{page.free.map((p) => <ProviderCard key={p.id} p={p} />)}</div>
                ) : (
                  <div className="pad-x muted small">Nobody{serviceName ? ` offering ${serviceName.toLowerCase()}` : ''} has free time this weekend yet.</div>
                )}
              </section>
              {page.rated.length > 0 && (
                <section>
                  <SectionHead title="Top rated" sub="Loved by clients" to={`/search?${searchQs}`} />
                  <div className="h-scroll">{page.rated.slice(0, 8).map((p) => <ProviderCard key={p.id} p={p} />)}</div>
                </section>
              )}
              {page.budget.items.length >= 2 && (
                <section>
                  <SectionHead title={`Under ${money(page.budget.cap)}`} sub="Great work at a friendly price" />
                  <div className="h-scroll">{page.budget.items.slice(0, 8).map((p) => <ProviderCard key={p.id} p={p} />)}</div>
                </section>
              )}
              <section>
                <SectionHead title={`All ${serviceName ? `${serviceName.toLowerCase()} ` : ''}${pluralLower(v)}`} sub={`${page.list.length} available`} to={`/search?${searchQs}`} />
                <div className="pad-x">{page.list.map((p) => <ProviderRow key={p.id} p={p} />)}</div>
              </section>
            </>
          )}
        </>
      )}

      {page.occasions.length > 0 && (
        <section>
          <SectionHead title="Popular for" />
          <div className="hd-occ-chips pad-x">
            {page.occasions.map((o) => (
              <Link key={o.slug} to={`/occasions/${o.slug}`} className="hd-occ-chip">
                <TintIcon item={o} size={30} />
                {o.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {empty && others.length > 0 && (
        <section>
          <SectionHead title="Book now" sub="Already on the app near you" />
          <div className="hd-occ-chips pad-x">
            {others.map((o) => (
              <Link key={o.slug} to={`/services/${o.slug}`} className="hd-occ-chip">
                <TintIcon item={o} size={30} />
                {o.plural} <span className="chip-count">{o.count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {!empty && !loading && (
        <section className="pad-x">
          <div className="hd-soon">
            <b>Are you {withArticle(v.noun)}?</b>
            <p className="muted small mt-xs">List your {v.name.toLowerCase()} services, set your prices and availability, and get booked by people planning events nearby.</p>
            <Link className="btn sm ghost mt" to={`/new-listing?v=${v.slug}`}><Store size={14} /> List your services</Link>
          </div>
        </section>
      )}
      <div className="mt-lg" />
    </div>
  )
}
