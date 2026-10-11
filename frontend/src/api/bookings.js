// Bookings for the signed-in user, as a client and as a photographer.
// Reading uses Row-Level Security (you only ever get your own bookings);
// every change goes through the booking functions in the database.
import { supabase } from '../lib/supabase.js'
import { ACTIVE_STATUSES, PAID_STATUSES, avatarUrl, callName, dollars, policyFromRules, toPackage } from '../lib/format.js'
import { fmtBooking, fmtTime, toKey } from '../lib/dates.js'
import { invalidate } from './catalog.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

// `*` (rather than a column list) so newer columns such as `quantity` (guests /
// items / days, from the all-verticals migration) come through when they exist.
export const BOOKING_COLUMNS = `
  *,
  provider:providers!bookings_provider_id_fkey(id, slug, display_name, profile_id, identity_verified, is_pro, rating_avg, rating_count,
    vertical:service_categories!providers_vertical_id_fkey(slug),
    profile:profiles!providers_profile_id_fkey(username, display_name, avatar_path)),
  client:profiles!bookings_client_id_fkey(id, username, display_name, avatar_path, client_rating_avg, client_rating_count),
  addons:booking_addons(name, price_cents),
  history:booking_events(to_status, created_at),
  offers:booking_offers(id, proposed_total_cents, message, status, created_at),
  conversation:conversations(id),
  reviews(id, author_id, direction, rating, body, revealed_at)`

// '["2026-10-21 23:00:00+00","2026-10-22 01:00:00+00")' -> [Date, Date]
// Chrome can't parse a bare "+00" offset, so it's expanded to "+00:00".
const toDate = (s) => new Date(s.trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
const parseRange = (range) => {
  const [a, b] = range.replace(/[[\]()"]/g, '').split(',')
  return [toDate(a), toDate(b)]
}

// Calendar day of a moment in a time zone, as a local Date at midnight.
const dayIn = (date, timeZone) => {
  const [y, m, d] = date.toLocaleDateString('en-CA', { timeZone }).split('-').map(Number)
  return new Date(y, m - 1, d)
}

// A bookings row as the object screens use. `viewerId` decides `role`.
export function toBooking(row, viewerId) {
  const [start, end] = parseRange(row.time_range)
  const day = dayIn(start, row.timezone)
  const pkg = toPackage(row.package_snapshot)
  const history = [...(row.history || [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((h) => ({ status: h.to_status, at: fmtBooking(new Date(h.created_at)), iso: h.created_at }))
  const offers = [...(row.offers || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const openOffer = offers.find((o) => o.status === 'pending')
  const reviews = row.reviews || []
  const conv = Array.isArray(row.conversation) ? row.conversation[0] : row.conversation
  const hoursLeft = row.expires_at ? Math.max(0, Math.round((new Date(row.expires_at) - Date.now()) / 3600000)) : null
  const daysSinceDelivery = row.delivered_at ? Math.floor((Date.now() - new Date(row.delivered_at)) / 86400000) : null
  const pr = row.provider || {}
  const cl = row.client || {}
  const role = viewerId && viewerId === row.client_id ? 'client' : 'provider'
  return {
    id: row.id,
    status: row.status,
    role, // 'client' if the viewer booked it, 'provider' if they're the photographer
    providerId: row.provider_id,
    vertical: pr.vertical?.slug || 'photography', // the provider's vertical (wording, delivery steps)
    quantity: row.quantity ?? null, // guests / items / days for per-person, per-item and daily packages
    provider: {
      id: pr.id,
      vertical: pr.vertical?.slug || 'photography',
      profileId: pr.profile_id,
      name: pr.display_name,
      shortName: callName(pr.display_name, pr.profile?.display_name), // "Maya" or "The Glasshouse DTLA"
      username: pr.profile?.username ?? pr.slug,
      avatar: avatarUrl(pr.profile?.avatar_path, pr.display_name),
      idVerified: !!pr.identity_verified,
      pro: !!pr.is_pro,
      rating: pr.rating_avg == null ? null : Number(pr.rating_avg),
      reviewCount: pr.rating_count ?? 0,
    },
    clientId: row.client_id,
    client: {
      id: cl.id,
      name: cl.display_name || cl.username,
      shortName: (cl.display_name || cl.username || '').split(' ')[0],
      username: cl.username,
      avatar: avatarUrl(cl.avatar_path, cl.display_name || cl.username),
      rating: cl.client_rating_avg == null ? null : Number(cl.client_rating_avg),
      reviews: cl.client_rating_count ?? 0,
      verified: false, // client verification isn't built yet
    },
    packageId: row.package_id,
    pkg,
    packageName: pkg?.name ?? 'Package',
    addons: (row.addons || []).map((a) => ({ name: a.name, price: dollars(a.price_cents) })),
    start,
    end,
    hours: (end - start) / 3600000,
    day, // local Date (midnight) of the shoot, in the photographer's time zone
    dateKey: toKey(day),
    date: fmtBooking(day), // "Oct 21, 2026"
    time: fmtTime(start, row.timezone), // "4:00 PM"
    timezone: row.timezone,
    location: row.location_text ?? '',
    note: row.notes ?? '',
    subtotal: dollars(row.subtotal_cents),
    addonsTotal: dollars(row.addons_cents),
    travelFee: dollars(row.travel_fee_cents) ?? 0,
    total: dollars(row.total_cents), // null for quote requests until a price is agreed
    deposit: dollars(row.deposit_cents),
    depositPaid: PAID_STATUSES.includes(row.status),
    isActive: ACTIVE_STATUSES.includes(row.status),
    policy: policyFromRules(row.policy_snapshot),
    conversationId: conv?.id ?? null,
    history,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    expiresIn: ['requested', 'countered'].includes(row.status) && hoursLeft != null ? `${hoursLeft}h` : null,
    offer: openOffer ? { id: openOffer.id, total: dollars(openOffer.proposed_total_cents), message: openOffer.message ?? '' } : null,
    counterTotal: openOffer ? dollars(openOffer.proposed_total_cents) : null,
    counterNote: openOffer?.message ?? null,
    deliveredAt: row.delivered_at,
    // Days left before a delivery auto-completes (7 days after delivery).
    deliveryExpiresDays: daysSinceDelivery == null ? null : Math.max(0, 7 - daysSinceDelivery),
    completedAt: row.completed_at,
    reviewWindowOpen: row.status === 'completed' && row.completed_at && Date.now() - new Date(row.completed_at) < 14 * 86400000,
    myReview: reviews.find((r) => r.author_id === viewerId) ?? null,
    // Reviews are double-blind: the other side's review only shows once both are in (or after 14 days).
    theirReview: reviews.find((r) => r.author_id !== viewerId && r.revealed_at) ?? null,
  }
}

async function viewer() {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

// Bookings I made as a client, newest shoot first.
export async function listMyBookings() {
  const uid = await viewer()
  if (!uid) return []
  const rows = must(await supabase.from('bookings').select(BOOKING_COLUMNS).eq('client_id', uid).order('time_range', { ascending: false }))
  return rows.map((r) => toBooking(r, uid))
}

// Bookings clients made with my photographer listing.
export async function listProviderBookings(providerId) {
  const uid = await viewer()
  if (!uid || !providerId) return []
  const rows = must(await supabase.from('bookings').select(BOOKING_COLUMNS).eq('provider_id', providerId).order('time_range', { ascending: true }))
  return rows.map((r) => toBooking(r, uid))
}

export async function getBooking(id) {
  const uid = await viewer()
  const row = must(await supabase.from('bookings').select(BOOKING_COLUMNS).eq('id', id).maybeSingle())
  return row ? toBooking(row, uid) : null
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const changed = () => invalidate('providers') // availability / ratings may have moved

// Request a package on one or more days. dates: Date[] or 'YYYY-MM-DD'[]; startTime: 'HH:MM'.
// quantity: guests / items / days for per_person, per_item and daily packages; leave it
// null otherwise (it's only sent when set, so this works before the all-verticals migration).
// Returns the new bookings (one per day).
export async function requestBooking({ packageId, dates, startTime, hours = null, quantity = null, addonIds = [], location = null, notes = null, eventId = null }) {
  const args = {
    p_package_id: packageId,
    p_dates: dates.map((d) => (typeof d === 'string' ? d : toKey(d))),
    p_start_time: startTime,
    p_hours: hours,
    p_addon_ids: addonIds,
    p_location_text: location || null,
    p_notes: notes || null,
  }
  if (quantity != null) args.p_quantity = Math.max(1, Math.round(quantity))
  if (eventId) args.p_event_id = eventId // booked from an event's board: the booking belongs to it
  const rows = must(await supabase.rpc('request_booking', args))
  changed()
  return rows
}

// Photographer answers a request: 'accept' | 'decline' | 'counter' (with a total in dollars).
export async function respondToBooking(id, action, { total = null, message = null } = {}) {
  const row = must(
    await supabase.rpc('respond_to_booking', {
      p_booking_id: id,
      p_action: action,
      p_total_cents: total == null ? null : Math.round(total * 100),
      p_message: message,
    }),
  )
  changed()
  return row
}

// Client accepts or declines a counter offer.
export async function respondToOffer(offerId, accept) {
  return must(await supabase.rpc('respond_to_offer', { p_offer_id: offerId, p_accept: accept }))
}

// Either side cancels. Returns { status, refund_pct }.
export async function cancelBooking(id) {
  const result = must(await supabase.rpc('cancel_booking', { p_booking_id: id }))
  changed()
  return result
}

export const markDelivered = async (id) => must(await supabase.rpc('mark_delivered', { p_booking_id: id }))
export const acceptDelivery = async (id) => must(await supabase.rpc('accept_delivery', { p_booking_id: id }))

// Leave a review (1–5 stars). Hidden until the other side reviews too, or 14 days pass.
export async function submitReview(bookingId, rating, body = null) {
  const row = must(await supabase.rpc('submit_review', { p_booking_id: bookingId, p_rating: rating, p_body: body || null }))
  changed()
  return row
}

// The error message to show for a failed booking call.
export const bookingError = (err) => err?.message?.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong'
