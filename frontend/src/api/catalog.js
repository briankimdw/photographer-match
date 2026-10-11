// Providers (photographers, caterers, venues... every vertical), their packages,
// reviews and availability, plus categories. Everything here is readable while
// signed out. Plain JS, shared with the Expo app.
//
// Screens get plain objects (see toProvider) rather than raw rows, so they
// don't need to know column names.
//
// Vertical-aware API (vertical = a catalog slug like 'catering'; see verticals/catalog.js):
//   getCategories()                     -> verticals, catalog order, merged with the database:
//       [{ id|null, slug, name, noun, plural, icon, tint, group, priceUnit, visual, tagline, live,
//          services: [{ id|null, slug, name, vertical, live }] }]
//       `live` = the database has this row (false until the all-verticals migration is applied,
//       so new verticals show a "coming soon"/"be the first" state). DB rows missing from
//       catalog.js are appended with generic fallbacks.
//   getVerticalInfo(slug)               -> one entry of getCategories(), or null
//   getServices(vertical = 'photography') -> [{ id, slug, name, vertical }] live services (pickers)
//   listProviders({ vertical } = {})    -> active providers, all verticals unless `vertical` is set
//   searchProviders({ vertical, service, category, dates, maxPrice, minRating, proOnly })
//       `service` (or legacy `category`) may be a service or vertical slug; `vertical` narrows further.
//   countProvidersByVertical()          -> { photography: 7, catering: 0, ... } (cached; only verticals with providers)
// Each provider object carries `vertical` (slug), `verticalInfo` (catalog metadata:
// name, noun, plural, icon, tint, visual, priceUnit) and `attributes` (its custom fields).
import { supabase } from '../lib/supabase.js'
import { avatarUrl, callName, dollars, photoUrl, policyFromRules, toPackage } from '../lib/format.js'
import { toKey } from '../lib/dates.js'
import { VERTICALS, verticalMeta, verticalOfService } from '../verticals/index.js'
import { parsePoint } from './locations.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

// Tiny in-memory cache so tab switches don't refetch everything.
const cache = new Map()
const TTL = 60_000
export function cached(key, load) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.promise
  const promise = load().catch((err) => {
    cache.delete(key)
    throw err
  })
  cache.set(key, { at: Date.now(), promise })
  return promise
}
export const invalidate = (prefix = '') => {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k)
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

// The vertical metadata screens need on a provider (kept small: no services list).
const verticalInfo = (slug, row) => {
  const m = verticalMeta(slug, row)
  return { slug: m.slug, name: m.name, noun: m.noun, plural: m.plural, icon: m.icon, tint: m.tint, group: m.group, priceUnit: m.priceUnit, visual: m.visual, concurrent: m.concurrent }
}

const categoryRows = () =>
  cached('categories:rows', async () =>
    must(await supabase.from('service_categories').select('id, slug, name, kind, parent_id, sort_order, is_active').order('sort_order')),
  )

// Every vertical (catalog order) with its services, merged with the database rows.
// See the top of this file for the shape.
export const getCategories = () =>
  cached('categories', async () => {
    const rows = (await categoryRows()).filter((r) => r.is_active)
    const verticalRows = rows.filter((r) => r.kind === 'vertical' || !r.parent_id)
    const bySlug = new Map(rows.map((r) => [r.slug, r]))
    const childrenOf = (id) => rows.filter((r) => r.parent_id === id)
    const build = (meta, vRow) => {
      const dbServices = vRow ? childrenOf(vRow.id) : []
      const known = new Set(meta.services.map((s) => s.slug))
      const services = [
        ...meta.services.map((s) => {
          const row = bySlug.get(s.slug)
          return { id: row?.id ?? null, slug: s.slug, name: s.name, vertical: meta.slug, live: !!row }
        }),
        ...dbServices.filter((r) => !known.has(r.slug)).map((r) => ({ id: r.id, slug: r.slug, name: r.name, vertical: meta.slug, live: true })),
      ]
      const { services: _drop, known: _k, ...rest } = meta
      return { ...rest, id: vRow?.id ?? null, live: !!vRow, services }
    }
    const fromCatalog = VERTICALS.map((v) => build(verticalMeta(v.slug), bySlug.get(v.slug)))
    const extra = verticalRows.filter((r) => !VERTICALS.some((v) => v.slug === r.slug)).map((r) => build(verticalMeta(r.slug, r), r))
    return [...fromCatalog, ...extra]
  })

/** One vertical from getCategories() (with services and `live`), or null. */
export const getVerticalInfo = async (slug) => (await getCategories()).find((v) => v.slug === slug) ?? null

/** Live services (with database ids) of one vertical, for pickers: [{ id, slug, name, vertical }]. */
export const getServices = async (vertical = 'photography') =>
  ((await getVerticalInfo(vertical))?.services || []).filter((s) => s.live).map(({ id, slug, name, vertical: v }) => ({ id, slug, name, vertical: v }))

/** { [verticalSlug]: number of active providers } (only verticals with at least one). Cached for a minute. */
export const countProvidersByVertical = () =>
  cached('providers:counts', async () => {
    const rows = must(await supabase.from('providers').select('vertical:service_categories!providers_vertical_id_fkey(slug)').eq('status', 'active'))
    const counts = {}
    for (const r of rows) {
      const slug = r.vertical?.slug
      if (slug) counts[slug] = (counts[slug] || 0) + 1
    }
    return counts
  })

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

const LIST_COLUMNS = `
  id, profile_id, slug, display_name, bio, city, base_location, service_radius_km, travel_fee_per_km_cents, timezone,
  attributes, status, identity_verified, is_pro, rating_avg, rating_count, created_at,
  vertical:service_categories!providers_vertical_id_fkey(slug, name),
  profile:profiles!providers_profile_id_fkey(id, username, display_name, avatar_path),
  policy:cancellation_policies!providers_cancellation_policy_id_fkey(name, rules),
  services:provider_services(category:service_categories(slug, name, sort_order)),
  packages(*),
  albums!albums_provider_id_fkey(id, created_at, status, cover:photos!albums_cover_photo_fk(display_path)),
  follows(count)`

// A providers row (with the embeds above) as the object screens use.
export function toProvider(row) {
  const services = (row.services || [])
    .map((s) => s.category)
    .filter(Boolean)
    .sort((a, b) => a.sort_order - b.sort_order)
  const packages = (row.packages || [])
    .filter((p) => p.is_active !== false)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(toPackage)
  const albums = [...(row.albums || [])].filter((a) => a.status !== 'hidden').sort((a, b) => b.created_at.localeCompare(a.created_at))
  const covers = albums.map((a) => photoUrl(a.cover?.display_path)).filter(Boolean)
  const priced = packages.filter((p) => p.price != null)
  const attrs = row.attributes || {}
  const fee = row.travel_fee_per_km_cents
  const vertical = row.vertical?.slug || services.map((s) => verticalOfService(s.slug)?.slug).find(Boolean) || 'photography'
  return {
    id: row.id,
    kind: 'provider',
    vertical, // 'photography', 'catering'...
    verticalInfo: verticalInfo(vertical, row.vertical), // { name, noun, plural, icon, tint, visual, priceUnit... }
    attributes: attrs, // the vertical's custom fields (cuisines, capacity...)
    profileId: row.profile_id,
    slug: row.slug,
    name: row.display_name,
    shortName: callName(row.display_name, row.profile?.display_name), // "Maya" or "The Glasshouse DTLA"
    username: row.profile?.username ?? row.slug,
    avatar: avatarUrl(row.profile?.avatar_path, row.display_name),
    cover: covers[0] ?? null,
    covers, // newest album covers first, for previews
    albumCount: albums.length,
    city: row.city ?? '',
    timezone: row.timezone,
    // Venues and other fixed places travel nowhere (radius 0): just say where they are.
    serviceArea: row.service_radius_km > 0 ? `${(row.city || 'Base').split(',')[0]} + ${row.service_radius_km} km radius` : (row.city || '').split(',')[0] || 'Service area not set',
    travelFee: fee ? `$${(fee / 100).toFixed(2)}/km beyond service area` : 'No travel fee',
    specialties: attrs.specialties?.length ? attrs.specialties : services.map((s) => s.name),
    categories: services.map((s) => s.name),
    categorySlugs: services.map((s) => s.slug),
    bio: row.bio ?? '',
    rating: row.rating_avg == null ? null : Number(row.rating_avg),
    reviewCount: row.rating_count ?? 0,
    idVerified: !!row.identity_verified,
    pro: !!row.is_pro,
    status: row.status,
    tasteMatch: null, // filled in by withMatches()
    distanceKm: null, // needs locations; not collected yet
    location: parsePoint(row.base_location), // { lat, lng } | null
    radiusKm: row.service_radius_km ?? null,
    followers: row.follows?.[0]?.count ?? 0,
    cancellationPolicy: policyFromRules(row.policy?.rules, row.policy?.name),
    gear: { bodies: attrs.gear?.bodies || [], lenses: attrs.gear?.lenses || [] },
    packages,
    startingPrice: priced.length ? Math.min(...priced.map((p) => p.price)) : null,
    addons: [], // full profile only (getProvider)
    reviews: [], // full profile only (getProvider)
    createdAt: row.created_at,
  }
}

// Every active provider (cached for a minute). { vertical: 'catering' } keeps one vertical.
// (Also safe to pass straight to useQuery / .then: a non-object argument means "all".)
const allProviders = () =>
  cached('providers', async () => {
    const rows = must(await supabase.from('providers').select(LIST_COLUMNS).eq('status', 'active').order('rating_count', { ascending: false }))
    return rows.map(toProvider)
  })
export const listProviders = async (opts) => {
  const vertical = opts && typeof opts === 'object' ? opts.vertical : null
  const all = await allProviders()
  return vertical ? all.filter((p) => p.vertical === vertical) : all
}

// One photographer with add-ons, reviews and working hours.
// `id` may be the provider id, the owner's profile id, or the slug.
export async function getProvider(id) {
  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  let q = supabase.from('providers').select(
    `${LIST_COLUMNS},
     package_addons(id, name, price_cents, is_active, sort_order),
     availability_rules(weekday, start_time, end_time)`,
  )
  // A profile id may own several listings (one per vertical): prefer an exact
  // provider id, else the owner's first listing.
  q = isUuid ? q.or(`id.eq.${id},profile_id.eq.${id}`) : q.eq('slug', id)
  const rows = must(await q.order('created_at').limit(5))
  if (!rows.length) return null
  const row = rows.find((r) => r.id === id) || rows[0]
  const provider = toProvider(row)
  provider.addons = (row.package_addons || [])
    .filter((a) => a.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((a) => ({ id: a.id, name: a.name, price: dollars(a.price_cents) }))
  provider.workingDays = [...new Set((row.availability_rules || []).map((r) => r.weekday))].sort()
  provider.reviews = await listReviews(provider.id)
  return provider
}

// Revealed client reviews of a photographer, newest first.
export async function listReviews(providerId, limit = 20) {
  const rows = must(
    await supabase
      .from('reviews')
      .select('id, rating, body, created_at, booking_id, author:profiles!reviews_author_id_fkey(id, username, display_name, avatar_path)')
      .eq('provider_id', providerId)
      .eq('direction', 'client_to_provider')
      .not('revealed_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit),
  )
  return rows.map((r) => ({
    id: r.id,
    authorId: r.author?.id,
    username: r.author?.username ?? null,
    bookingId: r.booking_id,
    createdAt: r.created_at,
    name: shortName(r.author?.display_name),
    avatar: avatarUrl(r.author?.avatar_path, r.author?.display_name),
    rating: r.rating,
    text: r.body ?? '',
    date: new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
  }))
}

// What a review was for: { packageName, completed } — only for people who can see the
// booking (its client and photographer); null for everyone else.
export async function reviewBooking(bookingId) {
  if (!bookingId) return null
  const { data } = await supabase.from('bookings').select('package_snapshot, completed_at').eq('id', bookingId).maybeSingle()
  if (!data) return null
  return {
    packageName: data.package_snapshot?.name ?? null,
    completed: data.completed_at ? new Date(data.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null,
  }
}

// "Hannah Park" -> "Hannah P."
const shortName = (name = '') => {
  const [first, last] = name.split(/\s+/)
  return last ? `${first} ${last[0]}.` : first || 'Client'
}

// ---------------------------------------------------------------------------
// People (anyone, provider or not), for /u/:id
// ---------------------------------------------------------------------------

// Returns { kind: 'provider', ...provider } if the id belongs to a photographer
// listing (or its owner), else { kind: 'person', ... } for a client profile, else null.
export async function getPerson(id) {
  const provider = await getProvider(id)
  if (provider) return provider
  const isUuid = /^[0-9a-f-]{36}$/i.test(id)
  const q = supabase.from('profiles').select('id, username, display_name, avatar_path, bio, city, client_rating_avg, client_rating_count, created_at')
  const row = must(await (isUuid ? q.eq('id', id) : q.eq('username', id)).maybeSingle())
  if (!row) return null
  // A photographer's username (e.g. /u/mayachen) opens their listing.
  if (!isUuid) {
    const listing = await getProvider(row.id)
    if (listing) return listing
  }
  return toPerson(row)
}

export const toPerson = (row) => ({
  id: row.id,
  kind: 'person',
  profileId: row.id,
  name: row.display_name || row.username,
  shortName: (row.display_name || row.username || '').split(' ')[0],
  username: row.username,
  avatar: avatarUrl(row.avatar_path, row.display_name || row.username),
  city: row.city ?? '',
  bio: row.bio ?? '',
  clientRating: row.client_rating_avg == null ? null : Number(row.client_rating_avg),
  clientReviews: row.client_rating_count ?? 0,
  createdAt: row.created_at,
})

// ---------------------------------------------------------------------------
// Availability + search
// ---------------------------------------------------------------------------

// Server-side search. dates: Date[] or 'YYYY-MM-DD'[]. Returns providers (from
// listProviders) that match, each with freeDates ('YYYY-MM-DD'[]).
//   service:  a service slug ('buffet') or vertical slug; `category` is the older name for it.
//   vertical: keep one vertical (also implied by a service slug).
export async function searchProviders({ dates = [], vertical = null, service = null, category = null, maxPrice = null, minRating = null, proOnly = false } = {}) {
  const keys = dates.map((d) => (typeof d === 'string' ? d : toKey(d)))
  const slug = service || category || vertical || null
  const [rows, all] = await Promise.all([
    supabase.rpc('search_providers', {
      p_dates: keys.length ? keys : null,
      p_category: slug,
      p_max_price_cents: maxPrice == null ? null : Math.round(maxPrice * 100),
      p_min_rating: minRating || null,
      p_pro_only: !!proOnly,
    }).then(must),
    listProviders(),
  ])
  const byId = new Map(all.map((p) => [p.id, p]))
  return rows
    .filter((r) => byId.has(r.provider_id) && (!vertical || byId.get(r.provider_id).vertical === vertical))
    .map((r) => ({ ...byId.get(r.provider_id), freeDates: r.free_dates || [] }))
}

// Which of these days a photographer is free on (working hours, blocked-off
// time and existing bookings all count). Returns a Set of 'YYYY-MM-DD'.
export async function freeDays(providerId, dates) {
  const keys = dates.map((d) => (typeof d === 'string' ? d : toKey(d)))
  if (!keys.length) return new Set()
  const rows = must(await supabase.rpc('search_providers', { p_dates: keys }))
  return new Set(rows.find((r) => r.provider_id === providerId)?.free_dates || [])
}

// Free photographers per day for a range of days: Map('YYYY-MM-DD' -> Set(providerId)).
export async function availabilityByDay(dates) {
  const keys = dates.map((d) => (typeof d === 'string' ? d : toKey(d)))
  const rows = must(await supabase.rpc('search_providers', { p_dates: keys }))
  const map = new Map(keys.map((k) => [k, new Set()]))
  for (const r of rows) for (const d of r.free_dates || []) map.get(d)?.add(r.provider_id)
  return map
}

// ---------------------------------------------------------------------------
// Taste match (% match per photographer, from the user's Discover swipes)
// ---------------------------------------------------------------------------

// Map(providerId -> 60..98). Empty when signed out or with fewer than 3 likes.
export const getMatches = () =>
  cached('matches', async () => {
    const { data: session } = await supabase.auth.getSession()
    if (!session.session) return new Map()
    const rows = must(await supabase.rpc('provider_matches'))
    return new Map(rows.map((r) => [r.provider_id, r.match_pct]))
  })

// Copies of the providers with tasteMatch filled in (null when unknown).
export async function withMatches(providers) {
  const matches = await getMatches().catch(() => new Map())
  return providers.map((p) => ({ ...p, tasteMatch: matches.get(p.id) ?? null }))
}
