import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowUp, Check, ChevronLeft, ChevronRight, Search as SearchIcon, Sparkles, Users } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import useDocumentTitle from '../components/useDocumentTitle.js'
import { EmptyState, ErrorState } from '../components/States.jsx'
import { RatingInline, RowsSkeleton, SectionHead } from '../components/home/Cards.jsx'
import { TintIcon } from '../components/home/CatalogIcon.jsx'
import { ComingSoonCard } from '../components/home/Browse.jsx'
import { CoverFallback } from '../components/verticals/VerticalIcon.jsx'
import useQuery from '../lib/useQuery.js'
import { money } from '../lib/format.js'
import { buildOccasionChecklist, listBrowseProviders, occasionPrompt, readCovered, withArticle, writeCovered } from '../api/home.js'
import { getOccasion, unitLabel } from '../verticals/catalog.js'

// Example details for the "Plan this with AI" box.
const EXAMPLES = {
  wedding: 'Napa, next June, 120 guests, about $30k',
  birthday: 'My 30th in LA, a Saturday in March, 40 people',
  graduation: 'UCLA grad photos, first week of June, under $400',
  engagement: 'A surprise proposal at sunset in Malibu',
  corporate: 'Holiday offsite in SF for 60 people, $10k',
  'baby-shower': 'Backyard shower for 25, late April',
  quinceanera: '150 guests in San Diego, next summer',
  'dinner-party': 'Dinner for 8 at home, Italian, Friday',
  bachelor: 'Bachelorette weekend in Vegas, 10 friends',
  'holiday-party': 'Office party for 80, mid-December',
}

// /occasions/:slug — The Knot-style plan: the vendor types this occasion needs as
// a checklist, a few top vendors for each, and a "Plan this with AI" shortcut.
export default function Occasion() {
  const { slug } = useParams()
  const occasion = getOccasion(slug)
  useDocumentTitle(occasion ? `Plan ${occasion.name.toLowerCase()}` : null)
  if (!occasion) {
    return (
      <>
        <TopBar title="Occasions" />
        <EmptyState icon={SearchIcon} title="We don’t know that occasion" text="Pick one from Home to see what you’ll need." action={<Link className="btn" to="/">Go home</Link>} />
      </>
    )
  }
  return <OccasionPage key={slug} occasion={occasion} />
}

const storage = () => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function OccasionPage({ occasion: o }) {
  const navigate = useNavigate()
  const providers = useQuery(() => listBrowseProviders(), [])
  const items = buildOccasionChecklist(o, providers.data || [])
  const [covered, setCovered] = useState(() => readCovered(storage(), o.slug))
  const [details, setDetails] = useState('')
  const soon = items.filter((it) => !it.count).map((it) => it.vertical)
  const done = items.filter((it) => covered.has(it.vertical.slug)).length
  const lower = o.name.toLowerCase()

  const toggle = (slug) => {
    const next = new Set(covered)
    next.has(slug) ? next.delete(slug) : next.add(slug)
    setCovered(next)
    writeCovered(storage(), o.slug, next)
  }
  const plan = (e) => {
    e.preventDefault()
    navigate(`/plan?q=${encodeURIComponent(occasionPrompt(o, details))}`)
  }

  return (
    <div className="occ" style={{ '--tint': o.tint }}>
      <div className="hd-float-bar">
        <div>
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
            <ChevronLeft size={24} />
          </button>
        </div>
      </div>
      <div className="occ-hero">
        <TintIcon item={o} size={56} className="on-card" />
        <h1>Plan {withArticle(lower)}</h1>
        <p className="muted small">The {items.length} kinds of vendors you’ll likely need, most important first. Tick them off as you go.</p>
        <div className="occ-progress">
          <div className="row between tiny occ-progress-label">
            <b>{done} of {items.length} covered</b>
            {done === items.length && <span className="ok">All set</span>}
          </div>
          <div className="occ-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done} aria-label="Checklist progress">
            <div style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
        </div>
        <Link to={`/events/new?type=${o.slug}`} className="btn block mt">
          <Users size={16} /> Start planning with friends
        </Link>
      </div>

      <div className="occ-ai">
        <div className="plan-promo">
          <div className="plan-promo-head">
            <span className="plan-ai-mark lg"><Sparkles size={18} /></span>
            <span className="grow">
              <b>Plan this {lower} with AI</b>
              <span className="muted small block">Add where, when and your budget. Get a draft budget and vendors who are free.</span>
            </span>
          </div>
          <form className="plan-promo-input" onSubmit={plan}>
            <input value={details} onChange={(e) => setDetails(e.target.value)} placeholder={EXAMPLES[o.slug] || 'Where, when, guests, budget…'} aria-label={`Describe your ${lower}`} />
            <button className="plan-send sm" aria-label="Plan it with AI">
              <ArrowUp size={16} strokeWidth={2.5} />
            </button>
          </form>
        </div>
      </div>

      <section>
        <SectionHead title="Your checklist" sub="Tap a category to compare vendors" />
        {providers.error && <ErrorState error={providers.error} onRetry={providers.reload} />}
        {providers.loading && !providers.data ? (
          <RowsSkeleton count={4} />
        ) : (
          <div className="occ-list">
            {items.map((it) => {
              const v = it.vertical
              const on = covered.has(v.slug)
              const unit = unitLabel(v.priceUnit)
              return (
                <div key={v.slug} className={`occ-item ${on ? 'covered' : ''}`}>
                  <div className="occ-item-head">
                    <button
                      className={`occ-check ${on ? 'on' : ''}`}
                      onClick={() => toggle(v.slug)}
                      aria-pressed={on}
                      aria-label={`${v.name}: ${on ? 'covered' : 'mark as covered'}`}
                    >
                      <span>{on && <Check size={14} strokeWidth={3} />}</span>
                    </button>
                    <Link to={`/services/${v.slug}`} className="occ-item-link">
                      <TintIcon item={v} size={36} />
                      <span className="grow">
                        <span className="occ-item-name block">{v.name}</span>
                        <span className="muted tiny block ellipsis">
                          {it.count
                            ? [`${it.count} available`, it.minPrice != null && `from ${money(it.minPrice)}${unit ? ` ${unit}` : ''}`].filter(Boolean).join(' · ')
                            : v.tagline}
                        </span>
                      </span>
                      {!it.count && <span className="occ-soon-tag">Soon</span>}
                      <ChevronRight size={16} className="muted" />
                    </Link>
                  </div>
                  {it.count > 0 && !on && (
                    <div className="occ-vendors scroll-x">
                      {it.top.map((p) => (
                        <Link key={p.id} to={`/u/${p.id}`} className="occ-vendor" aria-label={p.name}>
                          {p.cover ? <img src={p.cover} alt="" loading="lazy" draggable={false} /> : <CoverFallback vertical={p.vertical} />}
                          <div className="tiny ellipsis"><b>{p.name}</b></div>
                          <div className="tiny"><RatingInline p={p} /></div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {providers.data && soon.length > 0 && (
        <section className="pad-x">
          <ComingSoonCard soon={soon} />
        </section>
      )}
      <div className="pad-x mt">
        <p className="muted tiny">Ticks are saved on this device. Anyone you book shows up in Bookings.</p>
      </div>
      <div className="mt-lg" />
    </div>
  )
}
