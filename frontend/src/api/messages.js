// Inbox: conversations (direct messages, group chats, booking threads,
// inquiries) and their messages. You only ever see conversations you're a
// member of (Row-Level Security); new conversations are created through
// database functions that also enforce blocks.
import { supabase } from '../lib/supabase.js'
import { avatarUrl, fromPriceLabel, photoUrl } from '../lib/format.js'
import { listProviders } from './catalog.js'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

const viewer = async () => (await supabase.auth.getSession()).data.session?.user.id ?? null

// Turn database errors into something to show people.
export const messageError = (err) => {
  const msg = err?.message || ''
  if (/function .* does not exist|Could not find the function/i.test(msg)) return 'Messaging isn’t fully set up yet (database update pending).'
  return msg.replace(/^.*?ERROR:\s*/, '') || 'Something went wrong'
}

export const CONVERSATION_COLUMNS = `
  id, kind, title, booking_id, provider_id, created_at, last_message_at,
  provider:providers!conversations_provider_id_fkey(id, display_name, profile_id),
  booking:bookings!conversations_booking_id_fkey(id, status, time_range, package_snapshot),
  members:conversation_members(profile_id, last_read_at, joined_at,
    profile:profiles!conversation_members_profile_id_fkey(id, username, display_name, avatar_path,
      listing:providers!providers_profile_id_fkey(id, display_name, status)))`

const toMember = (m, row) => {
  // In inquiries/booking threads the photographer shows under their business name.
  const listing = (m.profile?.listing || []).find((l) => l.status === 'active') || null
  const isThreadProvider = row.provider && row.provider.profile_id === m.profile_id
  const name = isThreadProvider ? row.provider.display_name : m.profile?.display_name || m.profile?.username || 'Someone'
  return {
    // Link target for /u/:id: the photographer listing if they have one, else the profile.
    id: isThreadProvider ? row.provider.id : listing?.id ?? m.profile_id,
    profileId: m.profile_id,
    name,
    username: m.profile?.username,
    avatar: avatarUrl(m.profile?.avatar_path, name),
    isPhotographer: !!(isThreadProvider || listing),
    lastReadAt: m.last_read_at,
  }
}

// A conversations row as the object screens use, from the viewer's side.
function toConversation(row, uid, last = null) {
  const me = row.members.find((m) => m.profile_id === uid)
  const others = row.members.filter((m) => m.profile_id !== uid).map((m) => toMember(m, row))
  const lastAt = last?.created_at || row.last_message_at
  return {
    id: row.id,
    kind: row.kind, // 'direct' | 'group' | 'booking' | 'inquiry' | 'event' | 'event_vendors'
    isGroup: row.kind === 'group' || row.kind === 'event_vendors',
    title: row.title || others.map((o) => (row.kind === 'group' ? o.name.split(' ')[0] : o.name)).join(', ') || 'Just you',
    customTitle: row.title,
    bookingId: row.booking_id,
    booking: row.booking ? { id: row.booking.id, status: row.booking.status, packageName: row.booking.package_snapshot?.name } : null,
    providerId: row.provider_id,
    members: others, // everyone except me
    memberIds: others.map((o) => o.id),
    myLastReadAt: me?.last_read_at ?? null,
    lastMessage: last ? { text: last.body || shareLabel(last), fromMe: last.sender_id === uid, at: last.created_at, senderId: last.sender_id } : null,
    lastMessageAt: lastAt || row.created_at,
    unread: !!(last && last.sender_id !== uid && (!me?.last_read_at || me.last_read_at < last.created_at)),
  }
}

// My conversations, most recent first, each with its last message.
export async function listConversations() {
  const uid = await viewer()
  if (!uid) return []
  const rows = must(await supabase.from('conversations').select(CONVERSATION_COLUMNS).order('last_message_at', { ascending: false, nullsFirst: false }).limit(100))
  if (!rows.length) return []
  // The last message of each conversation (small parallel queries; each uses the (conversation_id, created_at) index).
  const lastColumns = `conversation_id, body, shared_album_id, sender_id, created_at${(await shareColumnsReady()) ? ', shared_provider_id, shared_event_id, share_preview' : ''}`
  const lasts = await Promise.all(
    rows.map((r) =>
      supabase
        .from('messages')
        .select(lastColumns)
        .eq('conversation_id', r.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data }) => data?.[0] ?? null),
    ),
  )
  return rows
    .map((r, i) => toConversation(r, uid, lasts[i]))
    // Empty threads you started but never wrote in stay out of the list (except booking threads, groups and vendor chats).
    .filter((c) => c.lastMessage || c.kind === 'booking' || c.kind === 'group' || c.kind === 'event_vendors')
    .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''))
}

export async function getConversation(id) {
  const uid = await viewer()
  const row = must(await supabase.from('conversations').select(CONVERSATION_COLUMNS).eq('id', id).maybeSingle())
  return row ? toConversation(row, uid) : null
}

// How many conversations have unread messages (for the tab badge).
export async function unreadCount() {
  const list = await listConversations()
  return list.filter((c) => c.unread).length
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// Base columns work on every database; the share-card columns (vendor and event
// cards, migration 20261011000000_share_cards) are added once that migration is applied.
const BASE_MESSAGE_COLUMNS = `
  id, conversation_id, sender_id, body, shared_album_id, created_at,
  album:albums!messages_shared_album_id_fkey(id, title, caption, provider_id, cover:photos!albums_cover_photo_fk(display_path),
    owner:providers!albums_provider_id_fkey(display_name))`
const SHARE_MESSAGE_COLUMNS = `,
  shared_provider_id, shared_event_id, share_preview,
  provider:providers!messages_shared_provider_id_fkey(id, display_name, slug, status, rating_avg, rating_count,
    profile:profiles!providers_profile_id_fkey(avatar_path))`
export const MESSAGE_COLUMNS = BASE_MESSAGE_COLUMNS // back-compat export

// Does the database have the share-card columns? Probed once per session (a
// missing column is remembered; network errors are retried next time).
let shareColumns = null
export async function shareColumnsReady() {
  if (shareColumns !== null) return shareColumns
  const { error } = await supabase.from('messages').select('shared_provider_id, shared_event_id, share_preview').limit(0)
  if (!error) shareColumns = true
  else if (/column|does not exist|schema cache|42703|PGRST20/i.test(`${error.code} ${error.message}`)) shareColumns = false
  return shareColumns ?? false
}
const messageColumns = async () => BASE_MESSAGE_COLUMNS + ((await shareColumnsReady()) ? SHARE_MESSAGE_COLUMNS : '')

// What can be sent as a card in chat. Posts always work; vendor and event
// cards need the share-card migration.
export async function shareSupport() {
  const ready = await shareColumnsReady()
  return { post: true, provider: ready, event: ready }
}

// In-app path of a shared thing (also used for "Copy link").
export const shareLink = ({ kind, id, providerId } = {}) =>
  kind === 'post' ? (providerId ? `/gallery/${providerId}?post=${id}` : `/post/${id}`)
    : kind === 'provider' ? `/u/${id}`
      : kind === 'event' ? `/events/${id}`
        : kind === 'plan' ? '/plan'
          : '/'

// One-line summary of a message without text ("Shared Lumen Studio").
export function shareLabel(m) {
  const p = m?.share_preview || {}
  if (m?.shared_event_id || p.kind === 'event') return p.title ? `Shared an event: ${p.title}` : 'Shared an event'
  if (m?.shared_provider_id || p.kind === 'provider') return p.name ? `Shared ${p.name}` : 'Shared a vendor'
  if (m?.shared_album_id || p.kind === 'post') return 'Shared a post'
  return ''
}

const fmtEventDate = (start, end) => {
  if (!start) return null
  const opts = { weekday: 'short', month: 'short', day: 'numeric' }
  const a = new Date(start)
  const yearly = a.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}
  const first = a.toLocaleDateString('en-US', { ...opts, ...yearly })
  if (!end) return first
  const b = new Date(end)
  if (b.toDateString() === a.toDateString()) return first
  return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...yearly })}`
}

// The card a message carries, or null:
//   { kind: 'post', id, providerId, title, caption, cover, vendorName, available }
//   { kind: 'provider', id, name, avatar, cover, noun, rating, reviewCount, fromPrice, available }
//   { kind: 'event', id, title, typeName, date, location, cover, available }
function toShared(m) {
  const p = m.share_preview || {}
  if (m.shared_album_id || p.kind === 'post') {
    const a = m.album
    return {
      kind: 'post',
      id: a?.id ?? m.shared_album_id ?? p.id ?? null,
      providerId: a?.provider_id ?? p.provider_id ?? null,
      title: a?.title ?? p.title ?? null,
      caption: a?.caption ?? null,
      cover: photoUrl(a?.cover?.display_path ?? p.cover ?? null),
      vendorName: a?.owner?.display_name ?? p.vendor ?? null,
      available: !!a,
    }
  }
  if (m.shared_provider_id || p.kind === 'provider') {
    const v = m.provider
    const name = v?.display_name ?? p.name ?? 'Vendor'
    return {
      kind: 'provider',
      id: v?.id ?? m.shared_provider_id ?? p.id ?? null,
      name,
      avatar: avatarUrl(v?.profile?.avatar_path ?? p.avatar ?? null, name),
      cover: null,
      noun: null,
      rating: v?.rating_avg == null ? null : Number(v.rating_avg),
      reviewCount: v?.rating_count ?? 0,
      fromPrice: null,
      available: !!v && v.status === 'active',
    }
  }
  if (m.shared_event_id || p.kind === 'event') {
    return {
      kind: 'event',
      id: m.shared_event_id ?? p.id ?? null,
      title: p.title || 'Event',
      type: p.type ?? null,
      date: fmtEventDate(p.starts_at, p.ends_at),
      startsAt: p.starts_at ?? null,
      location: p.location_text ?? null,
      cover: p.cover ? photoUrl(p.cover) : null,
      available: !!m.shared_event_id,
    }
  }
  return null
}

const toMessage = (m, uid) => {
  const shared = toShared(m)
  return {
    id: m.id,
    conversationId: m.conversation_id,
    from: m.sender_id,
    mine: m.sender_id === uid,
    text: m.body ?? '',
    shared,
    // Back-compat (older screens): the post card only.
    sharedAlbum: shared?.kind === 'post' && shared.available ? { id: shared.id, title: shared.title, providerId: shared.providerId, cover: shared.cover } : null,
    sharedAlbumId: m.shared_album_id,
    at: m.created_at,
    time: new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  }
}

// Vendor cards: fill in the vertical noun, cover and "from $X" from the
// (cached) provider list. Best effort; the card works without it.
async function withVendorDetails(messages) {
  if (!messages.some((m) => m.shared?.kind === 'provider' && m.shared.available)) return messages
  let byId
  try {
    byId = new Map((await listProviders()).map((p) => [p.id, p]))
  } catch (e) {
    console.warn(e)
    return messages
  }
  for (const m of messages) {
    const s = m.shared
    const p = s?.kind === 'provider' ? byId.get(s.id) : null
    if (!p) continue
    m.shared = { ...s, name: p.name, avatar: p.avatar, cover: p.cover, noun: p.verticalInfo?.noun ?? null, vertical: p.vertical, city: p.city, rating: p.rating, reviewCount: p.reviewCount, fromPrice: fromPriceLabel(p) }
  }
  return messages
}

// The latest messages of a conversation, oldest first.
export async function listMessages(conversationId, limit = 300) {
  const uid = await viewer()
  const rows = must(await supabase.from('messages').select(await messageColumns()).eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(limit))
  return withVendorDetails(rows.reverse().map((m) => toMessage(m, uid)))
}

const fetchMessage = async (id, uid) => {
  const { data } = await supabase.from('messages').select(await messageColumns()).eq('id', id).maybeSingle()
  if (!data) return null
  return (await withVendorDetails([toMessage(data, uid)]))[0]
}

// Send a message: text and/or one shared thing (a post, a vendor or an event).
// Returns the saved message.
export async function sendMessage(conversationId, { text = null, sharedAlbumId = null, sharedProviderId = null, sharedEventId = null }) {
  const uid = await viewer()
  const row = { conversation_id: conversationId, body: text?.trim() || null, shared_album_id: sharedAlbumId }
  if (sharedProviderId) row.shared_provider_id = sharedProviderId
  if (sharedEventId) row.shared_event_id = sharedEventId
  const saved = must(await supabase.from('messages').insert(row).select(await messageColumns()).single())
  return (await withVendorDetails([toMessage(saved, uid)]))[0]
}

// ---------------------------------------------------------------------------
// Sharing ("Send to"): one message with a card in each chosen conversation.
// ---------------------------------------------------------------------------

//   await shareToChats({ conversationIds, profileIds, kind: 'post'|'provider'|'event', id, text })
// profileIds: people to send to directly; their one-to-one thread is opened
// (or created) first. text: an optional note sent with the card.
// Returns { sent: [conversationId], failed: [{ target, error }] }; throws only
// when nothing could be sent.
export async function shareToChats({ conversationIds = [], profileIds = [], kind, id, text = null, link = null } = {}) {
  if (!['post', 'provider', 'event'].includes(kind) || !id) throw new Error('Nothing to share')
  const support = await shareSupport()
  const note = text?.trim() || null
  let payload
  if (kind === 'post') payload = { sharedAlbumId: id }
  else if (support[kind]) payload = kind === 'provider' ? { sharedProviderId: id } : { sharedEventId: id }
  else if (kind === 'provider') {
    // Older database: send the vendor's link as text instead of a card.
    const url = `${typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'https://photomatch.app'}${link || shareLink({ kind, id })}`
    payload = { text: note ? `${note}\n${url}` : url }
  } else throw new Error('Sharing events in chat isn’t set up yet (database update pending).')

  const failed = []
  const direct = await Promise.all(
    [...new Set(profileIds)].map((pid) =>
      startDirectMessage(pid).catch((error) => {
        failed.push({ target: { profileId: pid }, error })
        return null
      }),
    ),
  )
  const targets = [...new Set([...conversationIds, ...direct.filter(Boolean)])]
  const sent = []
  await Promise.all(
    targets.map((cid) =>
      sendMessage(cid, { text: note, ...payload })
        .then(() => sent.push(cid))
        .catch((error) => failed.push({ target: { conversationId: cid }, error })),
    ),
  )
  if (!sent.length && failed.length) throw failed[0].error
  return { sent, failed }
}

// Recipients for the share sheet, as one list:
//   { key, type: 'conversation'|'person', conversationId?, profileId?, name, avatar, avatars[], sub, isGroup }
// With an empty query: my recent chats (DMs, groups, event chats, vendor threads).
// With a query: matching chats, then matching people. A person I already have a
// one-to-one thread with shows as that thread.
export const conversationTarget = (c) => ({
  key: `c:${c.id}`,
  type: 'conversation',
  conversationId: c.id,
  name: c.title,
  avatar: c.members[0]?.avatar ?? avatarUrl(null, c.title),
  avatars: c.members.slice(0, 2).map((m) => m.avatar),
  isGroup: c.isGroup || c.kind === 'event' || c.members.length > 1,
  kind: c.kind,
  sub: c.kind === 'event' ? 'Event chat' : c.isGroup ? `${c.members.length + 1} people` : c.members[0]?.username ? `@${c.members[0].username}` : '',
})

export const personTarget = (p) => ({
  key: `p:${p.profileId}`,
  type: 'person',
  profileId: p.profileId,
  name: p.name,
  avatar: p.avatar,
  avatars: [p.avatar],
  isGroup: false,
  kind: 'person',
  sub: p.username ? `@${p.username}` : p.city || '',
})

export function mergeShareTargets(conversations = [], people = [], q = '') {
  const term = q.trim().replace(/^@/, '').toLowerCase()
  const direct = new Map()
  for (const c of conversations) if (c.kind === 'direct' && c.members.length === 1) direct.set(c.members[0].profileId, c)
  const matches = (c) =>
    !term || c.title.toLowerCase().includes(term) || c.members.some((m) => m.name?.toLowerCase().includes(term) || m.username?.toLowerCase().includes(term))
  const out = conversations.filter(matches).map(conversationTarget)
  if (!term) return out
  const seen = new Set(out.map((t) => t.key))
  for (const p of people) {
    const c = direct.get(p.profileId)
    const t = c ? conversationTarget(c) : personTarget(p)
    if (!seen.has(t.key)) {
      seen.add(t.key)
      out.push(t)
    }
  }
  return out
}

// Split chosen targets into the shareToChats arguments.
export const shareRecipients = (targets) => ({
  conversationIds: targets.filter((t) => t.type === 'conversation').map((t) => t.conversationId),
  profileIds: targets.filter((t) => t.type === 'person').map((t) => t.profileId),
})

export async function markRead(conversationId) {
  const uid = await viewer()
  if (!uid) return
  await supabase.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', conversationId).eq('profile_id', uid)
}

// ---------------------------------------------------------------------------
// Starting conversations
// ---------------------------------------------------------------------------

// "Ask a question": open (or reopen) an inquiry thread with a photographer. Returns its id.
export const startInquiry = async (providerId) => must(await supabase.rpc('start_inquiry', { p_provider_id: providerId }))

// Open (or reopen) a one-to-one thread with anyone. Returns its id.
export const startDirectMessage = async (profileId) => must(await supabase.rpc('start_direct_message', { p_profile_id: profileId }))

// New group with at least two other people. Returns its id.
export const createGroup = async (title, profileIds) => must(await supabase.rpc('create_group_chat', { p_title: title || null, p_member_ids: profileIds }))

export const addGroupMembers = async (conversationId, profileIds) =>
  must(await supabase.rpc('add_group_members', { p_conversation_id: conversationId, p_member_ids: profileIds }))

export const renameGroup = async (conversationId, title) => must(await supabase.rpc('rename_group', { p_conversation_id: conversationId, p_title: title }))

export const leaveGroup = async (conversationId) => must(await supabase.rpc('leave_group', { p_conversation_id: conversationId }))

// ---------------------------------------------------------------------------
// Event vendor chats (kind 'event_vendors'): the event's booked vendors + its planners
// ---------------------------------------------------------------------------

//   { event_id, event_title, closed, closes_at, is_planner, is_owner,
//     participants: [{ profile_id, role: 'planner'|'vendor'|'former_planner', name, provider_id, active }] }
export const vendorChatInfo = async (conversationId) => must(await supabase.rpc('vendor_chat_info', { p_conversation_id: conversationId }))

// The vendor chat of a booking's event, if I'm in it; null otherwise (or on any error).
export async function vendorChatForBooking(bookingId) {
  const { data, error } = await supabase.rpc('vendor_chat_for_booking', { p_booking_id: bookingId })
  if (error) return null
  return data ?? null
}

// People to message: matches on name or @username (everyone, photographers and
// clients), minus me and anyone I've blocked. Empty query = people I've talked to.
export async function searchPeople(q = '') {
  const uid = await viewer()
  const term = q.trim().replace(/^@/, '').replace(/[%_,()]/g, ' ').trim()
  const blocked = uid ? new Set(must(await supabase.from('blocks').select('blocked_id').eq('blocker_id', uid)).map((b) => b.blocked_id)) : new Set()

  let rows
  if (!term) {
    if (!uid) return []
    const convs = await listConversations()
    const seen = new Map()
    for (const c of convs) for (const m of c.members) if (!seen.has(m.profileId)) seen.set(m.profileId, m)
    return [...seen.values()].filter((p) => !blocked.has(p.profileId)).slice(0, 20).map((p) => ({ ...p, recent: true }))
  }
  rows = must(
    await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_path, city, listing:providers!providers_profile_id_fkey(id, display_name, status)')
      .or(`display_name.ilike.%${term}%,username.ilike.%${term}%`)
      .neq('display_name', '')
      .limit(25),
  )
  return rows
    .filter((r) => r.id !== uid && !blocked.has(r.id))
    .map((r) => {
      const listing = (r.listing || []).find((l) => l.status === 'active') || null
      const name = r.display_name || r.username
      return { id: listing?.id ?? r.id, profileId: r.id, name, username: r.username, avatar: avatarUrl(r.avatar_path, name), city: r.city, isPhotographer: !!listing, businessName: listing?.display_name ?? null }
    })
}

// ---------------------------------------------------------------------------
// Live updates (Supabase Realtime)
// ---------------------------------------------------------------------------

let channelSeq = 0

// One conversation: new messages, read receipts and "typing…".
//   const live = openChat(id, { onMessage, onRead, onTyping })
//   live.typing()   // tell the others I'm typing (throttled)
//   live.close()
export function openChat(conversationId, { onMessage, onRead, onTyping } = {}) {
  let uid = null
  let me = null
  viewer().then((id) => (uid = id))
  supabase.auth.getSession().then(({ data }) => (me = data.session?.user ?? null))

  // Message + read-receipt events (database changes, filtered by RLS).
  const db = supabase
    .channel(`chat-db:${conversationId}:${++channelSeq}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, async (payload) => {
      const msg = await fetchMessage(payload.new.id, uid).catch(() => null)
      onMessage?.(msg || toMessage(payload.new, uid))
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversation_members', filter: `conversation_id=eq.${conversationId}` }, (payload) => {
      if (payload.new.profile_id !== uid) onRead?.(payload.new.profile_id, payload.new.last_read_at)
    })
    .subscribe()

  // Typing indicator: a broadcast between the people who have the chat open (nothing is stored).
  // The topic must be the same for everyone, so the channel is shared (see typingChannel).
  const onBroadcast = (payload) => {
    if (payload?.profileId && payload.profileId !== uid) onTyping?.(payload.profileId)
  }
  const live = typingChannel(conversationId)
  live.handlers.add(onBroadcast)

  let lastTyping = 0
  return {
    typing() {
      const now = Date.now()
      if (now - lastTyping < 2500 || !me) return
      lastTyping = now
      live.channel.send({ type: 'broadcast', event: 'typing', payload: { profileId: me.id } }).catch(() => {})
    },
    close() {
      supabase.removeChannel(db)
      live.handlers.delete(onBroadcast)
      releaseTypingChannel(conversationId)
    },
  }
}

// One "typing:<id>" channel per conversation, shared by everyone who opens it here.
// supabase.channel() hands back an existing channel with the same topic, and removing
// one only finishes after the server acknowledges, so closing a chat and opening it
// again right away (React StrictMode does exactly that) used to get a channel that was
// being torn down: typing stopped working. Channels are released a moment after the
// last user closes them instead.
const typingChannels = new Map() // conversationId -> { channel, handlers, refs, timer }
function typingChannel(conversationId) {
  let entry = typingChannels.get(conversationId)
  if (entry) {
    clearTimeout(entry.timer)
    entry.refs++
    return entry
  }
  const handlers = new Set()
  const channel = supabase
    .channel(`typing:${conversationId}`, { config: { broadcast: { self: false } } })
    .on('broadcast', { event: 'typing' }, ({ payload }) => handlers.forEach((h) => h(payload)))
    .subscribe()
  entry = { channel, handlers, refs: 1, timer: null }
  typingChannels.set(conversationId, entry)
  return entry
}
function releaseTypingChannel(conversationId) {
  const entry = typingChannels.get(conversationId)
  if (!entry) return
  entry.refs = Math.max(0, entry.refs - 1)
  if (entry.refs) return
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    if (entry.refs || typingChannels.get(conversationId) !== entry) return
    typingChannels.delete(conversationId)
    supabase.removeChannel(entry.channel)
  }, 2000)
}

// Back-compat: new messages in one conversation. Returns an unsubscribe function.
export function subscribeToMessages(conversationId, onMessage) {
  const live = openChat(conversationId, { onMessage })
  return () => live.close()
}

// Anything new for me anywhere (a message in any of my conversations, or a
// read marker moving): calls onChange (debounced). For the inbox list and the tab badge.
export function subscribeToInbox(onChange) {
  let timer
  const fire = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 300)
  }
  const channel = supabase
    .channel(`inbox:${++channelSeq}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, fire)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, fire)
    .subscribe()
  return () => {
    clearTimeout(timer)
    supabase.removeChannel(channel)
  }
}
