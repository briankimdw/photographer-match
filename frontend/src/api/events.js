// Events: plan one event together with friends (public.events).
//
// Each event has members (the owner + co-planners), a group chat (a
// conversation of kind 'event', created with the event and kept in sync with
// the members by the database), and a "Who we're hiring" board: candidate
// vendors per category with votes and a status (considering -> shortlisted ->
// booked). Bookings made from the event carry its id and show as booked.
// Database: supabase/migrations/20261011000100_event_groups.sql. Until that's
// applied, events still load and save, but the board, invites and the chat
// report `setup: false` (screens show a "needs a database update" state).
//
// The events table holds the essentials (type, dates, place, guests, budget).
// The AI planner's full brief (styles, exact dates, notes) is also kept in this
// browser so reopening a plan here restores everything; elsewhere it's rebuilt
// from the columns.
import { supabase } from '../lib/supabase.js'
import { addDays, fromKey, toKey, today } from '../lib/dates.js'
import { avatarUrl } from '../lib/format.js'
import { toEWKT } from './locations.js'
import { listProviders } from './catalog.js'
import { OCCASIONS, getOccasion } from '../verticals/catalog.js'
import { verticalMeta } from '../verticals/index.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

const viewer = async () => (await supabase.auth.getSession()).data.session?.user.id ?? null

const COLUMNS = 'id, owner_id, title, type, starts_at, ends_at, location_text, guest_count, budget_cents, currency, status, created_at, updated_at'
const MEMBER_COLUMNS = 'members:event_members(profile_id, role, created_at, profile:profiles!event_members_profile_id_fkey(id, username, display_name, avatar_path))'

// ---- errors -----------------------------------------------------------------

/** True when the error means the event-groups migration isn't applied yet. */
export const isSetupError = (err) =>
  /does not exist|Could not find the (function|table)|schema cache|PGRST20[25]|42P01|42883/i.test(`${err?.code || ''} ${err?.message || ''}`)

export const SETUP_MESSAGE = 'Events with friends need a database update.'

export const eventError = (err) => {
  if (isSetupError(err)) return SETUP_MESSAGE
  const msg = err?.message || ''
  return msg.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong'
}

// ---- names ------------------------------------------------------------------

const TYPE_NAMES = {
  ...Object.fromEntries(OCCASIONS.map((o) => [o.slug, o.name])),
  wedding: 'Wedding',
  engagement: 'Engagement',
  graduation: 'Graduation',
  headshots: 'Headshots',
  portrait: 'Portrait session',
  event: 'Event',
  party: 'Party',
  birthday: 'Birthday',
  corporate: 'Corporate event',
  bachelor: 'Bachelor/ette party',
}
export const eventTypeName = (type) =>
  !type ? 'Event' : TYPE_NAMES[type] || type.replace(/[-_]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// Occasions to pick from when creating an event ([slug, label]).
export const EVENT_KINDS = [...OCCASIONS.map((o) => [o.slug, o.name]), ['event', 'Something else']]

// The kinds of vendors an event needs: its occasion's list, else a sensible default.
const DEFAULT_NEEDS = ['venue', 'catering', 'photography', 'music', 'decor']
export const neededVerticals = (type) => getOccasion(type)?.needs || DEFAULT_NEEDS

// ---- brief <-> row ----------------------------------------------------------

// A date key at local noon, so it reads back as the same day in this time zone.
const keyToTs = (key) => (key ? new Date(`${key}T12:00:00`).toISOString() : null)
const tsToKey = (ts) => (ts ? toKey(new Date(ts)) : null)

export function titleFor(brief) {
  const t = (brief?.title || '').trim()
  if (t) return t.slice(0, 120)
  const name = eventTypeName(brief?.event_type)
  const place = (brief?.location_text || '').split(',')[0].trim()
  return (place ? `${name} in ${place}` : name).slice(0, 120)
}

function rowFromBrief(brief) {
  const dates = [...(brief.dates || [])].sort()
  const start = brief.start_date || dates[0] || null
  const end = brief.end_date || dates[dates.length - 1] || start
  return {
    title: titleFor(brief),
    type: brief.event_type || null,
    starts_at: keyToTs(start),
    ends_at: keyToTs(end && start && end < start ? start : end),
    location_text: brief.location_text || null,
    location: brief.location?.lat != null && brief.location?.lng != null ? toEWKT(brief.location) : null,
    guest_count: brief.guest_count ?? null,
    budget_cents: brief.budget_total_cents != null ? Math.round(brief.budget_total_cents) : null,
  }
}

// Rebuild a planner brief from the stored columns (dates become the full range, up to 14 days).
function briefFromRow(row) {
  const start = tsToKey(row.starts_at)
  const end = tsToKey(row.ends_at) || start
  const dates = []
  if (start) {
    for (let d = fromKey(start); toKey(d) <= end && dates.length < 14; d = addDays(d, 1)) dates.push(toKey(d))
  }
  return {
    event_type: row.type,
    title: row.title,
    start_date: start,
    end_date: end,
    dates,
    location_text: row.location_text,
    location: null,
    budget_total_cents: row.budget_cents,
    guest_count: row.guest_count,
    styles: [],
    services_needed: [],
    notes: null,
  }
}

const BRIEF_KEY = (id) => `planner-brief:${id}`
function rememberBrief(id, brief) {
  try {
    localStorage.setItem(BRIEF_KEY(id), JSON.stringify(brief))
  } catch {
    /* storage unavailable: the columns are enough */
  }
}
function recallBrief(id) {
  try {
    return JSON.parse(localStorage.getItem(BRIEF_KEY(id)) || 'null')
  } catch {
    return null
  }
}

const toMember = (m, uid, ownerId) => {
  const name = m.profile?.display_name || m.profile?.username || 'Someone'
  return {
    profileId: m.profile_id,
    id: m.profile_id, // /u/:id accepts a profile id
    name,
    firstName: name.split(' ')[0],
    username: m.profile?.username ?? null,
    avatar: avatarUrl(m.profile?.avatar_path, name),
    role: m.role,
    isOwner: m.profile_id === ownerId || m.role === 'owner',
    isMe: m.profile_id === uid,
  }
}

// Whole days from today to the event's first day (negative once it's past), or null.
export function daysUntil(startKey) {
  if (!startKey) return null
  return Math.round((fromKey(startKey) - today()) / 86400000)
}
// "Today", "Tomorrow", "In 12 days", "In 3 months", "2 days ago"...
export function countdownLabel(startKey) {
  const n = daysUntil(startKey)
  if (n == null) return null
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  if (n === -1) return 'Yesterday'
  if (n < 0) return `${-n} days ago`
  if (n < 60) return `In ${n} days`
  return `In ${Math.round(n / 30)} months`
}
// "Sat, Jun 12, 2027" or "Jun 12 – 14, 2027".
export function whenLabel(ev) {
  if (!ev?.startDate) return null
  const a = fromKey(ev.startDate)
  const opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
  if (!ev.endDate || ev.endDate === ev.startDate) return a.toLocaleDateString('en-US', opts)
  const b = fromKey(ev.endDate)
  const sameMonth = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()
  return sameMonth
    ? `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.getDate()}, ${b.getFullYear()}`
    : `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

// A row as the object screens use.
export function toEvent(row, uid = null) {
  const fromColumns = briefFromRow(row)
  const saved = recallBrief(row.id)
  const members = (row.members || [])
    .map((m) => toMember(m, uid, row.owner_id))
    .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name))
  const occasion = getOccasion(row.type)
  return {
    id: row.id,
    ownerId: row.owner_id,
    isOwner: !!uid && row.owner_id === uid,
    title: row.title,
    type: row.type,
    typeName: eventTypeName(row.type),
    tint: occasion?.tint ?? '#6366f1',
    icon: occasion?.icon ?? 'PartyPopper',
    startDate: fromColumns.start_date,
    endDate: fromColumns.end_date,
    locationText: row.location_text,
    guestCount: row.guest_count,
    budgetCents: row.budget_cents,
    currency: row.currency,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    members, // [] unless loaded with members
    // The saved columns win over anything remembered, in case it was edited elsewhere.
    brief: saved ? { ...saved, ...pickDefined(fromColumns, ['title', 'event_type', 'location_text', 'guest_count', 'budget_total_cents']) } : fromColumns,
  }
}
const pickDefined = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]))

// ---- creating -----------------------------------------------------------------

const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })

// Create from columns: the database function makes the chat and invites people in
// one go. Without the migration, falls back to a plain insert (no chat, no invites).
async function createFromRow(row, { status = 'planning', inviteIds = [] } = {}) {
  const { data, error } = await supabase.rpc('create_event_with_chat', {
    p_title: row.title,
    p_type: row.type,
    p_starts_at: row.starts_at,
    p_ends_at: row.ends_at,
    p_location_text: row.location_text,
    p_guest_count: row.guest_count,
    p_budget_cents: row.budget_cents,
    p_invite_ids: inviteIds,
    p_status: status,
  })
  if (!error) {
    if (row.location) await supabase.from('events').update({ location: row.location }).eq('id', data.event_id)
    return { id: data.event_id, conversationId: data.conversation_id, setup: true }
  }
  if (!isSetupError(error)) throw error
  // Old database: insert without RETURNING (its select policy only matches once the
  // owner's member row exists), with an id made here.
  const id = newId()
  must(await supabase.from('events').insert({ id, ...row, status }))
  return { id, conversationId: null, setup: false }
}

const mustFind = (ev) => {
  if (!ev) throw new Error('Saved, but couldn’t load the event. Pull to refresh.')
  return ev
}

// From the AI planner's brief ("Save as event").
export async function createEvent(brief, { status = 'planning', inviteIds = [] } = {}) {
  const { id } = await createFromRow(rowFromBrief(brief), { status, inviteIds })
  rememberBrief(id, brief)
  return mustFind(await getEvent(id))
}

// From the "New event" form: { title, type, date 'YYYY-MM-DD', endDate, locationText, guestCount, budget (dollars), inviteIds }.
// Returns { id, conversationId, setup }.
export function createEventFromForm({ title, type = null, date = null, endDate = null, locationText = '', guestCount = null, budget = null, inviteIds = [] }) {
  const name = (title || '').trim() || titleFor({ event_type: type, location_text: locationText })
  return createFromRow(
    {
      title: name.slice(0, 120),
      type: type || null,
      starts_at: keyToTs(date),
      ends_at: keyToTs(endDate && date && endDate >= date ? endDate : date),
      location_text: locationText?.trim() || null,
      guest_count: guestCount ? Math.max(0, Math.round(guestCount)) : null,
      budget_cents: budget ? Math.round(Number(budget) * 100) : null,
    },
    { inviteIds },
  )
}

// ---- reading ------------------------------------------------------------------

// Events I can see (mine, plus any I've been added to), most recently changed first.
export async function listMyEvents() {
  const rows = must(await supabase.from('events').select(COLUMNS).order('updated_at', { ascending: false }).limit(50))
  return rows.map((r) => toEvent(r))
}

// For /events: with members; upcoming first (soonest first), then undated, then past.
export async function listEvents() {
  const uid = await viewer()
  if (!uid) return []
  const rows = must(await supabase.from('events').select(`${COLUMNS}, ${MEMBER_COLUMNS}`).order('starts_at', { ascending: true, nullsFirst: false }).limit(100))
  const events = rows.map((r) => toEvent(r, uid))
  const rank = (e) => (e.status === 'cancelled' ? 3 : e.startDate == null ? 1 : daysUntil(e.endDate || e.startDate) < 0 ? 2 : 0)
  return events.sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? (b.startDate || '').localeCompare(a.startDate || '') : (a.startDate || '').localeCompare(b.startDate || '')) || (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}

// Upcoming events only (for Home / Me shelves).
export const listUpcomingEvents = async (limit = 6) =>
  (await listEvents()).filter((e) => e.status !== 'cancelled' && (e.startDate == null || daysUntil(e.endDate || e.startDate) >= 0)).slice(0, limit)

export async function getEvent(id) {
  const uid = await viewer()
  const row = must(await supabase.from('events').select(`${COLUMNS}, ${MEMBER_COLUMNS}`).eq('id', id).maybeSingle())
  return row ? toEvent(row, uid) : null
}

// patch: a planner brief (saves all its fields) and/or { status }.
export async function updateEvent(id, { brief, status } = {}) {
  const patch = { ...(brief ? rowFromBrief(brief) : {}), ...(status ? { status } : {}) }
  must(await supabase.from('events').update(patch).eq('id', id))
  if (brief) rememberBrief(id, brief)
  return mustFind(await getEvent(id))
}

// Edit from the event page: { title, type, date, endDate, locationText, guestCount, budget (dollars) }.
export async function editEvent(id, { title, type, date, endDate, locationText, guestCount, budget }) {
  const patch = {}
  if (title !== undefined) patch.title = (title || '').trim().slice(0, 120) || 'Event'
  if (type !== undefined) patch.type = type || null
  if (date !== undefined) {
    patch.starts_at = keyToTs(date)
    patch.ends_at = keyToTs(endDate && date && endDate >= date ? endDate : date)
  }
  if (locationText !== undefined) patch.location_text = locationText?.trim() || null
  if (guestCount !== undefined) patch.guest_count = guestCount ? Math.max(0, Math.round(guestCount)) : null
  if (budget !== undefined) patch.budget_cents = budget ? Math.round(Number(budget) * 100) : null
  must(await supabase.from('events').update(patch).eq('id', id))
  return getEvent(id)
}

export async function deleteEvent(id) {
  must(await supabase.from('events').delete().eq('id', id))
}

// ---- people + chat ------------------------------------------------------------

/** Invite people (profile ids): they become co-planners and join the chat. Returns how many were added. */
export const inviteToEvent = async (eventId, profileIds) =>
  must(await supabase.rpc('invite_to_event', { p_event_id: eventId, p_profile_ids: profileIds }))

/** Leave an event you co-plan (and its chat). */
export const leaveEvent = async (eventId) => must(await supabase.rpc('leave_event', { p_event_id: eventId }))

/** The owner removes a co-planner (and they leave the chat). */
export const removeEventMember = async (eventId, profileId) =>
  must(await supabase.rpc('remove_event_member', { p_event_id: eventId, p_profile_id: profileId }))

/** The event's group chat id (created if missing), or null before the migration. */
export async function eventChatId(eventId) {
  const { data, error } = await supabase.rpc('ensure_event_chat', { p_event_id: eventId })
  if (error) {
    if (isSetupError(error)) return null
    throw error
  }
  return data
}

/** For a chat of kind 'event': the event it belongs to (or null). */
export async function eventIdForConversation(conversationId) {
  const { data, error } = await supabase.from('conversations').select('event_id').eq('id', conversationId).maybeSingle()
  if (error) return null
  return data?.event_id ?? null
}

/** For a chat of kind 'event': { id, type, tint, icon } of its event (for the chat header), or null. */
export async function eventForConversation(conversationId) {
  const id = await eventIdForConversation(conversationId)
  if (!id) return null
  const { data } = await supabase.from('events').select('id, type').eq('id', id).maybeSingle()
  const occasion = getOccasion(data?.type)
  return { id, type: data?.type ?? null, tint: occasion?.tint ?? '#6366f1', icon: occasion?.icon ?? 'PartyPopper' }
}

// ---- vendor chat --------------------------------------------------------------

/**
 * For planners: the event's vendor chat and its vendors, or null before the migration.
 * { conversation_id|null, closed, closes_at|null, is_owner, vendors: [{ provider_id, name, vertical, booking_status, in_chat, removed }] }
 */
export async function getVendorChat(eventId) {
  const { data, error } = await supabase.rpc('event_vendor_chat', { p_event_id: eventId })
  if (error) {
    if (isSetupError(error)) return null
    throw error
  }
  return data
}

/** The owner takes a vendor out of the vendor chat (the booking isn't affected). */
export const removeVendorFromChat = async (eventId, providerId) =>
  must(await supabase.rpc('remove_event_vendor', { p_event_id: eventId, p_provider_id: providerId }))

/** The owner lets a removed vendor back in. False when they no longer have an active booking. */
export const readdVendorToChat = async (eventId, providerId) =>
  must(await supabase.rpc('readd_event_vendor', { p_event_id: eventId, p_provider_id: providerId }))

// ---- the board ----------------------------------------------------------------

export const CANDIDATE_STATUSES = [
  ['considering', 'Considering'],
  ['shortlisted', 'Shortlisted'],
  ['booked', 'Booked'],
]

// Booking statuses that count as hired / still pending.
const BOOKED = new Set(['accepted', 'confirmed', 'in_progress', 'delivered', 'completed'])
const PENDING = new Set(['requested', 'countered'])

async function loadBookings(eventId) {
  const { data, error } = await supabase.rpc('event_bookings', { p_event_id: eventId })
  if (!error) return data || []
  if (!isSetupError(error)) throw error
  // Old database: only my own bookings are visible.
  const { data: mine } = await supabase.from('bookings').select('id, provider_id, client_id, status, total_cents, currency, package_snapshot').eq('event_id', eventId)
  return (mine || []).map((b) => ({ ...b, package_name: b.package_snapshot?.name ?? null }))
}

/**
 * Everything on the event page:
 * { event, setup, chatId, groups: [{ vertical, needed, items: [candidate] }], budget: { planned, booked, pending } (cents), counts }
 * candidate: { providerId, provider, vertical, status, stage ('considering'|'shortlisted'|'requested'|'booked'),
 *              booking {id, status, totalCents, mine}|null, votes, votedByMe, voters [names], addedBy {name}|null, note, createdAt }
 */
export async function getEventBoard(eventId) {
  const uid = await viewer()
  const event = await getEvent(eventId)
  if (!event) return null

  let setup = true
  let candidates = []
  let votes = []
  const cand = await supabase.from('event_candidates').select('provider_id, vertical_slug, status, added_by, note, created_at').eq('event_id', eventId)
  if (cand.error) {
    if (!isSetupError(cand.error)) throw cand.error
    setup = false
  } else {
    candidates = cand.data || []
    votes = must(await supabase.from('event_candidate_votes').select('provider_id, profile_id').eq('event_id', eventId))
  }
  const [bookings, providers, chatId] = await Promise.all([
    loadBookings(eventId),
    listProviders().catch(() => []),
    setup ? eventChatId(eventId).catch(() => null) : Promise.resolve(null),
  ])
  const byProvider = new Map(providers.map((p) => [p.id, p]))
  const byMember = new Map(event.members.map((m) => [m.profileId, m]))

  // Best booking per vendor: booked beats pending; cancelled/declined ones don't count.
  const bookingOf = new Map()
  for (const b of bookings) {
    if (!BOOKED.has(b.status) && !PENDING.has(b.status)) continue
    const prev = bookingOf.get(b.provider_id)
    if (!prev || (BOOKED.has(b.status) && !BOOKED.has(prev.status))) bookingOf.set(b.provider_id, b)
  }

  const items = candidates.map((c) => ({ ...c }))
  // Vendors booked for the event but never added to the board still show up.
  for (const [providerId] of bookingOf) {
    if (!items.some((c) => c.provider_id === providerId)) {
      const p = byProvider.get(providerId)
      items.push({ provider_id: providerId, vertical_slug: p?.vertical || 'photography', status: 'considering', added_by: null, note: null, created_at: null, fromBooking: true })
    }
  }

  const toCandidate = (c) => {
    const b = bookingOf.get(c.provider_id)
    const mine = votes.filter((v) => v.provider_id === c.provider_id)
    const stage = b ? (BOOKED.has(b.status) ? 'booked' : 'requested') : c.status
    return {
      providerId: c.provider_id,
      provider: byProvider.get(c.provider_id) || null,
      vertical: c.vertical_slug,
      status: c.status,
      stage,
      onBoard: !c.fromBooking,
      booking: b ? { id: b.id, status: b.status, totalCents: b.total_cents, mine: b.client_id === uid, packageName: b.package_name } : null,
      votes: mine.length,
      votedByMe: mine.some((v) => v.profile_id === uid),
      voters: mine.map((v) => byMember.get(v.profile_id)?.firstName || 'Someone'),
      addedBy: c.added_by ? byMember.get(c.added_by) || { name: 'Former planner', firstName: 'Someone' } : null,
      note: c.note,
      createdAt: c.created_at,
    }
  }
  const order = { booked: 0, requested: 1, shortlisted: 2, considering: 3 }
  const all = items.map(toCandidate).sort((a, b) => order[a.stage] - order[b.stage] || b.votes - a.votes || (a.createdAt || '').localeCompare(b.createdAt || ''))

  const needs = neededVerticals(event.type)
  const slugs = [...needs, ...all.map((c) => c.vertical).filter((s) => !needs.includes(s))]
  const groups = [...new Set(slugs)].map((slug) => {
    const m = verticalMeta(slug)
    return {
      vertical: { slug, name: m.name, noun: m.noun, plural: m.plural, icon: m.icon, tint: m.tint },
      needed: needs.includes(slug),
      items: all.filter((c) => c.vertical === slug),
    }
  })

  const sum = (pred) => [...bookingOf.values()].filter((b) => pred(b.status)).reduce((s, b) => s + (b.total_cents || 0), 0)
  return {
    event,
    setup,
    chatId,
    groups,
    budget: { planned: event.budgetCents, booked: sum((s) => BOOKED.has(s)), pending: sum((s) => PENDING.has(s)) },
    counts: {
      categories: groups.filter((g) => g.needed).length,
      covered: groups.filter((g) => g.needed && g.items.some((c) => c.stage === 'booked')).length,
      candidates: all.length,
    },
  }
}

/** Add a vendor to an event's board (posts "Brian added X to Music" in the chat). */
export async function addCandidate(eventId, providerId, { vertical = null, note = null } = {}) {
  return must(await supabase.rpc('add_event_candidate', { p_event_id: eventId, p_provider_id: providerId, p_vertical_slug: vertical, p_note: note }))
}

/** 'considering' | 'shortlisted' | 'booked' (shortlisting and booking are announced in the chat). */
export const setCandidateStatus = async (eventId, providerId, status) =>
  must(await supabase.rpc('set_event_candidate_status', { p_event_id: eventId, p_provider_id: providerId, p_status: status }))

export async function removeCandidate(eventId, providerId) {
  must(await supabase.from('event_candidates').delete().eq('event_id', eventId).eq('provider_id', providerId))
}

/** 👍 a candidate (on = true) or take the vote back. */
export async function setVote(eventId, providerId, on) {
  if (on) {
    const { error } = await supabase.from('event_candidate_votes').insert({ event_id: eventId, provider_id: providerId })
    if (error && error.code !== '23505') throw error // already voted: fine
  } else {
    must(await supabase.from('event_candidate_votes').delete().eq('event_id', eventId).eq('provider_id', providerId).eq('profile_id', await viewer()))
  }
}

/** Which of my events already have this vendor on the board: Set of event ids. */
export async function eventsWithCandidate(providerId) {
  const { data, error } = await supabase.from('event_candidates').select('event_id').eq('provider_id', providerId)
  if (error) return new Set()
  return new Set(data.map((r) => r.event_id))
}

let channelSeq = 0
/** Live board: calls onChange (debounced) when candidates or votes change. Returns an unsubscribe function. */
export function subscribeToEvent(eventId, onChange) {
  let timer
  const fire = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 300)
  }
  const channel = supabase
    .channel(`event:${eventId}:${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_candidates', filter: `event_id=eq.${eventId}` }, fire)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_candidate_votes', filter: `event_id=eq.${eventId}` }, fire)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'event_members', filter: `event_id=eq.${eventId}` }, fire)
    .subscribe()
  return () => {
    clearTimeout(timer)
    supabase.removeChannel(channel)
  }
}
