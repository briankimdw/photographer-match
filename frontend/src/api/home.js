// Data for the browse screens: Home, Discover's Explore grid, /services/:vertical
// and /occasions/:slug. Plain JS (no React, no DOM) so the Expo app can reuse it.
//
// Fetchers hit Supabase; everything else is a pure function that shapes data the
// screens already have (providers from listProviders, catalog metadata from
// verticals/catalog.js). Nothing here invents data: a vertical with no providers
// comes back with count 0 and the screens show an intentional "coming soon" state.
import { supabase } from '../lib/supabase.js'
import { fromPriceLabel, money, photoUrl, startingPrice } from '../lib/format.js'
import { addDays, toKey, today } from '../lib/dates.js'
import { cached, listProviders, searchProviders, withMatches } from './catalog.js'
import { OCCASIONS, VERTICALS, getVertical } from '../verticals/catalog.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

// Every active provider, each with `.vertical` (a catalog slug, from api/catalog.js)
// and `.tasteMatch` (% match from Discover swipes, null when unknown).
export const listBrowseProviders = () => listProviders().then(withMatches)

// Providers free on any day of the coming weekend: Map(providerId -> free 'YYYY-MM-DD'[]).
// vertical: limit to one vertical (the search RPC accepts a vertical slug).
export async function weekendAvailability(vertical = null) {
  const rows = await searchProviders({ dates: comingWeekend(), vertical })
  return new Map(rows.filter((p) => p.freeDates.length).map((p) => [p.id, p.freeDates]))
}

// Portfolio photos for the Explore grid, newest posts first. Each:
// { id, src, width, height, albumId, title, providerId, serviceSlug, serviceName }
export const listExplorePhotos = ({ limit = 120 } = {}) =>
  cached(`home:explore:${limit}`, async () => {
    const rows = must(
      await supabase
        .from('photos')
        .select('id, display_path, width, height, pair_role, position, album:albums!photos_album_id_fkey!inner(id, title, kind, status, provider_id, created_at, category:service_categories(slug, name))')
        .eq('album.status', 'published')
        .order('created_at', { ascending: false })
        .limit(limit),
    )
    return rows
      .filter((r) => r.album && r.pair_role !== 'before')
      .map((r) => ({
        id: r.id,
        src: photoUrl(r.display_path),
        width: r.width || 4,
        height: r.height || 5,
        position: r.position ?? 0,
        albumId: r.album.id,
        albumCreatedAt: r.album.created_at,
        title: r.album.title,
        providerId: r.album.provider_id,
        serviceSlug: r.album.category?.slug ?? null,
        serviceName: r.album.category?.name ?? null,
      }))
  })

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// The coming weekend: this Sat + Sun (just Sunday if today is Sunday).
export function comingWeekend(now = today()) {
  if (now.getDay() === 0) return [now]
  const sat = addDays(now, 6 - now.getDay())
  return [sat, addDays(sat, 1)]
}

export const byRating = (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.reviewCount - a.reviewCount
export const byNewest = (a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')
export const byMatch = (a, b) => (b.tasteMatch ?? -1) - (a.tasteMatch ?? -1) || byRating(a, b)

// True when two lists start with the same providers in the same order (a shelf
// that would just repeat the one above it).
export const sameOrder = (a, b) => a.length > 0 && a.every((p, i) => b[i]?.id === p.id)

// A friendly "under $X" line for a vertical, by how it's priced.
const BUDGET_CAPS = { session: 250, hour: 150, person: 50, item: 100, day: 2000 }
export const budgetCap = (vertical) => BUDGET_CAPS[vertical?.priceUnit] ?? 250

// Providers whose starting price is at most `cap`, cheapest first.
export const underPrice = (providers, cap) =>
  providers
    .filter((p) => startingPrice(p) != null && startingPrice(p) <= cap)
    .sort((a, b) => startingPrice(a) - startingPrice(b))

// Map(vertical slug -> number of active providers).
export function countByVertical(providers) {
  const counts = new Map()
  for (const p of providers) if (p.vertical) counts.set(p.vertical, (counts.get(p.vertical) || 0) + 1)
  return counts
}

// "from $250", "from $45 / person", or null when nothing is priced.
export const priceFrom = (provider) => fromPriceLabel(provider)

// What a provider does, for card subtitles: their services, else the vertical name.
export function subtitleOf(provider, { withVertical = false } = {}) {
  const v = getVertical(provider.vertical)
  const specialties = (provider.specialties || []).slice(0, 2).join(' · ')
  if (withVertical && v) return specialties ? `${v.noun[0].toUpperCase()}${v.noun.slice(1)} · ${specialties}` : v.name
  return specialties || v?.name || ''
}

// "caterers" / "a caterer" style words for copy.
// Lower-cases words but keeps acronyms: "DJs & musicians" stays, "Private chefs" -> "private chefs".
export const pluralLower = (v) => v.plural.replace(/([A-Z])(?=[a-z])/g, (c) => c.toLowerCase())
export const withArticle = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`

// Text for "Know a great caterer? Invite them" shares.
export function inviteMessage(vertical) {
  const noun = vertical ? vertical.noun : 'event pro'
  return {
    title: 'Join me on photomatch',
    text: `I’d love to book you through photomatch. ${vertical ? `It’s opening up to ${pluralLower(vertical)}` : 'Event pros can list their services'} and clients can find and book you there.`,
    noun,
  }
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

// The Home feed from real data.
//   providers: listBrowseProviders()   weekend: weekendAvailability()
// Returns { live: vertical[], soon: vertical[], counts, shelves: [...] } where each
// shelf is { key, title, sub, to, layout: 'cards'|'rows', items: provider[] }.
// Shelf titles name the vertical while only one has providers ("Photographers
// available this weekend") and go generic once several do.
export function buildHomeFeed({ providers = [], weekend = new Map(), weekendLabel = '' }) {
  const counts = countByVertical(providers)
  const live = VERTICALS.filter((v) => counts.get(v.slug))
  const soon = VERTICALS.filter((v) => !counts.get(v.slug))
  const single = live.length === 1 ? live[0] : null
  const who = single ? single.plural : 'Pros'
  const whoLower = single ? pluralLower(single) : 'pros'
  const qs = single ? `?v=${single.slug}` : ''

  const shelves = []
  const used = new Set()
  const take = (list, n) => list.slice(0, n)

  const matched = providers.filter((p) => p.tasteMatch != null).sort(byMatch)
  if (matched.length) {
    shelves.push({ key: 'match', title: 'Matched to your taste', sub: 'Based on your Discover swipes', to: `/search${qs}`, layout: 'cards', items: take(matched, 8) })
  }

  const free = providers.filter((p) => weekend.has(p.id)).map((p) => ({ ...p, freeDates: weekend.get(p.id) })).sort(byMatch)
  shelves.push({
    key: 'weekend',
    title: `${who} free this weekend`,
    sub: weekendLabel,
    to: `/search?${single ? `v=${single.slug}&` : ''}dates=${comingWeekend().map(toKey).join(',')}`,
    layout: 'cards',
    items: take(free, 8),
    empty: `No ${whoLower} have free time this weekend yet.`,
  })
  free.slice(0, 8).forEach((p) => used.add(p.id))

  // One shelf per vertical once several have providers ("Caterers near you").
  if (!single && live.length > 1) {
    for (const v of [...live].sort((a, b) => counts.get(b.slug) - counts.get(a.slug))) {
      const list = providers.filter((p) => p.vertical === v.slug).sort(byRating)
      shelves.push({ key: `v:${v.slug}`, title: `Top ${pluralLower(v)}`, to: `/services/${v.slug}`, layout: 'cards', items: take(list, 8), vertical: v })
    }
  } else {
    const rated = providers.filter((p) => p.rating != null).sort(byRating)
    if (rated.length && !sameOrder(rated, free)) {
      shelves.push({ key: 'top', title: `Top-rated ${whoLower}`, sub: 'Loved by clients', to: `/search${qs}`, layout: 'cards', items: take(rated, 8) })
    }
    const cap = budgetCap(single)
    const budget = underPrice(providers, cap)
    if (budget.length >= 2) {
      shelves.push({ key: 'budget', title: `Under ${money(cap)}`, sub: 'Great work at a friendly price', to: null, layout: 'cards', items: take(budget, 8) })
    }
  }

  const newest = [...providers].sort(byNewest)
  if (newest.length) shelves.push({ key: 'new', title: 'New on photomatch', sub: 'Recently joined', to: `/search${qs}`, layout: 'rows', items: take(newest, 4) })

  return { live, soon, counts, shelves }
}

// ---------------------------------------------------------------------------
// /services/:vertical
// ---------------------------------------------------------------------------

// Everything the vertical landing page shows.
//   service: an optional service slug chip; only providers offering it are kept.
export function buildVerticalPage({ vertical, providers = [], weekend = new Map(), service = null }) {
  const all = providers.filter((p) => p.vertical === vertical.slug)
  const list = service ? all.filter((p) => (p.categorySlugs || []).includes(service)) : all
  const free = list.filter((p) => weekend.has(p.id)).map((p) => ({ ...p, freeDates: weekend.get(p.id) })).sort(byMatch)
  const rated = list.filter((p) => p.rating != null).sort(byRating)
  const prices = all.map(startingPrice).filter((n) => n != null)
  // Services that at least one provider here offers, for the chip counts.
  const offered = new Map()
  for (const p of all) for (const s of p.categorySlugs || []) offered.set(s, (offered.get(s) || 0) + 1)
  const cap = budgetCap(vertical)
  return {
    total: all.length,
    list: [...list].sort(byMatch),
    free,
    rated: sameOrder(rated, free) ? [] : rated, // skip a shelf that repeats "free this weekend"
    budget: { cap, items: underPrice(list, cap) },
    newest: [...list].sort(byNewest),
    minPrice: prices.length ? Math.min(...prices) : null,
    offered,
    occasions: OCCASIONS.filter((o) => o.needs.includes(vertical.slug)),
  }
}

// Other verticals that have providers, to suggest from an empty vertical page.
export const liveVerticals = (providers, except = null) => {
  const counts = countByVertical(providers)
  return VERTICALS.filter((v) => v.slug !== except && counts.get(v.slug)).map((v) => ({ ...v, count: counts.get(v.slug) }))
}

// ---------------------------------------------------------------------------
// /occasions/:slug
// ---------------------------------------------------------------------------

// The occasion's vendor checklist: one item per needed vertical, in order of importance.
// Each: { vertical, count, top: provider[] (best 3), minPrice }
export function buildOccasionChecklist(occasion, providers = []) {
  return occasion.needs
    .map(getVertical)
    .filter(Boolean)
    .map((vertical) => {
      const list = providers.filter((p) => p.vertical === vertical.slug)
      const prices = list.map(startingPrice).filter((n) => n != null)
      return {
        vertical,
        count: list.length,
        top: [...list].sort(byMatch).slice(0, 6),
        minPrice: prices.length ? Math.min(...prices) : null,
      }
    })
}

// The planner prompt for "Plan this with AI" (the planner opens with it via /plan?q=).
export function occasionPrompt(occasion, details = '') {
  const extra = details.trim()
  const article = withArticle(occasion.name.toLowerCase())
  if (!extra) return `I’m planning ${article}. Help me figure out what I need.`
  return /^(a|an|my|our)\b/i.test(extra) || extra.toLowerCase().includes(occasion.name.toLowerCase())
    ? extra
    : `${article[0].toUpperCase()}${article.slice(1)}: ${extra}`
}

// "I've got this covered" ticks on an occasion checklist, kept on this device.
// storage: a Storage-like object ({ getItem, setItem }); pass null where there is none.
export function readCovered(storage, occasionSlug) {
  try {
    return new Set(JSON.parse(storage?.getItem(`occasion-covered:${occasionSlug}`) || '[]'))
  } catch {
    return new Set()
  }
}
export function writeCovered(storage, occasionSlug, set) {
  try {
    storage?.setItem(`occasion-covered:${occasionSlug}`, JSON.stringify([...set]))
  } catch {
    // private mode / storage full: the ticks just won't persist
  }
}

// ---------------------------------------------------------------------------
// Discover → Explore
// ---------------------------------------------------------------------------

// Photos joined to their providers, interleaved so one provider doesn't fill the
// top of the grid (round-robin by provider, newest first within each).
//   vertical / service: optional filters.
export function buildExploreTiles({ photos = [], providers = [], vertical = null, service = null }) {
  const byId = new Map(providers.map((p) => [p.id, p]))
  const tiles = photos
    .map((ph) => ({ ...ph, provider: byId.get(ph.providerId) }))
    .filter((t) => t.provider && (!vertical || t.provider.vertical === vertical) && (!service || t.serviceSlug === service))
  const queues = new Map()
  for (const t of tiles) {
    if (!queues.has(t.providerId)) queues.set(t.providerId, [])
    queues.get(t.providerId).push(t)
  }
  const out = []
  const lists = [...queues.values()]
  for (let i = 0; out.length < tiles.length; i++) for (const q of lists) if (q[i]) out.push(q[i])
  // Display shape (height / width). Most portfolio shots share one shape, which
  // makes a flat grid, so portrait photos get a gently varied crop (Pinterest
  // rhythm); landscape photos keep their own shape.
  return out.map((t, i) => {
    const real = t.height / t.width
    return { ...t, ratio: real >= 1 ? CROPS[i % CROPS.length] : Math.max(0.66, real) }
  })
}
const CROPS = [1.25, 1, 1.4, 1.15, 0.85, 1.3, 1.05]

// Filter chips for Explore: verticals that have photos, and the services
// (album categories) present for the current vertical.
export function exploreFilters({ photos = [], providers = [], vertical = null }) {
  const byId = new Map(providers.map((p) => [p.id, p]))
  const vCounts = new Map()
  const sCounts = new Map()
  for (const ph of photos) {
    const p = byId.get(ph.providerId)
    if (!p) continue
    vCounts.set(p.vertical, (vCounts.get(p.vertical) || 0) + 1)
    if ((!vertical || p.vertical === vertical) && ph.serviceSlug) {
      const s = sCounts.get(ph.serviceSlug) || { slug: ph.serviceSlug, name: ph.serviceName, n: 0 }
      s.n++
      sCounts.set(ph.serviceSlug, s)
    }
  }
  return {
    verticals: VERTICALS.filter((v) => vCounts.get(v.slug)),
    services: [...sCounts.values()].sort((a, b) => b.n - a.n),
  }
}

// Split tiles into columns for a masonry grid, each tile going to the shortest
// column (by aspect ratio), so reading order stays roughly left-to-right.
export function masonry(tiles, columns = 2) {
  const cols = Array.from({ length: columns }, () => ({ h: 0, items: [] }))
  for (const t of tiles) {
    const col = cols.reduce((a, b) => (b.h < a.h ? b : a))
    col.items.push(t)
    col.h += t.ratio ?? t.height / t.width
  }
  return cols.map((c) => c.items)
}

// Verticals the swipe deck can show: those with visual portfolios, each with
// `count` (active providers). counts: { slug: n } from countProvidersByVertical().
// withPosts: Set of vertical slugs that have published posts (verticalsWithPosts());
// a vertical whose vendors haven't posted yet would give an empty deck, so it
// counts as 0 ("coming soon"). Until that loads, provider counts alone decide.
export function deckVerticals(counts = {}, withPosts = null) {
  return VERTICALS.filter((v) => v.visual).map((v) => ({
    ...v,
    count: withPosts && !withPosts.has(v.slug) ? 0 : counts[v.slug] || 0,
  }))
}

// Slugs of the verticals that have at least one published post: Set<string>.
export const verticalsWithPosts = () =>
  cached('home:post-verticals', async () => {
    const rows = must(
      await supabase
        .from('albums')
        .select('provider:providers!albums_provider_id_fkey!inner(status, vertical:service_categories!providers_vertical_id_fkey(slug))')
        .eq('status', 'published')
        .eq('provider.status', 'active')
        .limit(1000),
    )
    return new Set(rows.map((r) => r.provider?.vertical?.slug).filter(Boolean))
  })
