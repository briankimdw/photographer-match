// /events/[id]: native port of frontend/src/screens/EventDetail.jsx. The event workspace:
// header (title, date, place, countdown), who's planning + Invite, the group chat, a budget
// summary, and the "Who we're hiring" board (candidates per needed category, 👍 votes, status
// Considering -> Shortlisted -> Booked; bookings with this event show as Requested / Booked).
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  CalendarDays, CalendarX, Check, ChevronRight, MapPin, MessageCircle, MoreHorizontal, Search as SearchIcon, Send, ThumbsUp, Trash2, UserPlus, Users,
} from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import {
  CANDIDATE_STATUSES, EVENT_KINDS, countdownLabel, deleteEvent, editEvent, eventError, getEventBoard, leaveEvent, removeCandidate,
  removeEventMember, setCandidateStatus, setVote, subscribeToEvent, whenLabel,
} from '@shared/api/events.js'
import { priceFrom } from '@shared/api/home.js'
import { cents } from '@shared/lib/planBrief.js'
import { Avatar, Button, Chip, EmptyState, ErrorState, IconButton, InA11yGroup, Loading, Photo, RatingInline, ratingLabel, Screen, Sheet, SignInPrompt, Text, TextField, VerticalIcon } from '@/components'
import { ShareSheet } from '@/components/share/ShareSheet'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, readableTint, useTheme } from '@/theme'
import { SetupNote, type EventItem } from './AddToEvent'
import { InviteSheet, MemberStack } from './parts'

type Board = NonNullable<Awaited<ReturnType<typeof getEventBoard>>>
type Ev = Board['event']
type Group = Board['groups'][number]
type Cand = Group['items'][number]
type Member = EventItem['members'][number]

const STAGE: Record<string, { label: string; bg: string; fg: string }> = {
  considering: { label: 'Considering', bg: 'soft', fg: 'muted' },
  shortlisted: { label: 'Shortlisted', bg: '#f5f3ff', fg: '#7c3aed' },
  requested: { label: 'Requested', bg: '#eff6ff', fg: '#2563eb' },
  booked: { label: 'Booked', bg: '#ecfdf3', fg: '#16a34a' },
}
const article = (w: string) => (/^[aeiou]/i.test(w) ? 'an' : 'a')

export default function EventDetail() {
  const { id, invite } = useLocalSearchParams<{ id: string; invite?: string }>()
  const { user, loading: authLoading } = useAuth()
  const router = useRouter()
  const board = useQuery<Board | null>(user ? () => getEventBoard(String(id)) as Promise<Board | null> : null, [id, user?.id])
  const { reload } = board
  const ready = !!board.data?.setup
  useEffect(() => (ready ? subscribeToEvent(String(id), reload) : undefined), [id, ready, reload])

  if (authLoading || (board.loading && !board.data)) return <Screen title="Event" back><Loading /></Screen>
  if (!user) return <Screen title="Event" back><SignInPrompt title="Sign in to see this event" text="Events are shared with the people planning them." /></Screen>
  if (board.error) return <Screen title="Event" back><ErrorState error={board.error} onRetry={reload} /></Screen>
  if (!board.data) {
    return (
      <Screen title="Event" back>
        <EmptyState icon={CalendarX} title="Event not found" text="It may have been deleted, or you’re not planning it."
          action={<Button title="My events" size="sm" variant="ghost" onPress={() => router.replace('/events')} />} />
      </Screen>
    )
  }
  return <Workspace board={board.data} reload={reload} setData={board.setData} openInvite={invite === '1'} refreshing={board.loading} />
}

function Workspace({ board, reload, setData, openInvite, refreshing }: {
  board: Board; reload: () => void; setData: (fn: (d: Board | null | undefined) => Board | null | undefined) => void; openInvite: boolean; refreshing: boolean
}) {
  const s = useStyles()
  const { c, scheme } = useTheme()
  const router = useRouter()
  const { toast } = useStore()
  const ev = board.event
  const [invite, setInvite] = useState(openInvite && board.setup)
  const [share, setShare] = useState(false)
  const [more, setMore] = useState(false)
  const [editing, setEditing] = useState(false)
  const [picked, setPicked] = useState<Cand | null>(null)

  const countdown = countdownLabel(ev.startDate)
  const others = (ev.members as Member[]).filter((m) => !m.isMe)
  const names = others.length ? `You, ${others.slice(0, 3).map((m: Member) => m.firstName).join(', ')}${others.length > 3 ? ` +${others.length - 3}` : ''}` : 'Just you so far'
  const tint = ev.tint

  const openChat = () => {
    if (!board.chatId) return toast('The group chat needs a database update first.')
    router.push({ pathname: '/inbox/[id]', params: { id: String(board.chatId) } })
  }
  const findVendors = (g: Group) => router.push({ pathname: '/search', params: { v: g.vertical.slug, ...(ev.startDate ? { dates: ev.startDate } : {}) } })

  const vote = async (cand: Cand) => {
    const on = !cand.votedByMe
    setData((d) => d && { ...d, groups: d.groups.map((g) => ({ ...g, items: g.items.map((x) => (x.providerId === cand.providerId ? { ...x, votedByMe: on, votes: x.votes + (on ? 1 : -1) } : x)) })) })
    try {
      await setVote(ev.id, cand.providerId, on)
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    }
    reload()
  }

  const { planned, booked, pending } = board.budget
  const showBudget = planned != null || booked > 0 || pending > 0
  const groups = board.groups.filter((g) => g.needed || g.items.length)

  return (
    <Screen
      title="Event"
      back
      refreshing={refreshing}
      onRefresh={reload}
      right={
        <View style={s.rowCenter}>
          <IconButton icon={Send} label="Share event" size={20} onPress={() => setShare(true)} />
          <IconButton icon={MoreHorizontal} label="More" size={20} onPress={() => setMore(true)} />
        </View>
      }
    >
      <View style={[s.hero, { backgroundColor: `${tint}1c` }]}>
        <View style={s.heroTop}>
          <View style={s.heroIcon}><VerticalIcon name={ev.icon} size={22} color={tint} /></View>
          {!!countdown && <View style={s.count}><Text variant="tiny" weight="700" style={{ color: readableTint(tint, scheme, 5) }}>{countdown}</Text></View>}
        </View>
        <Text variant="h2" style={{ marginTop: 10 }}>{ev.title}</Text>
        <View style={s.lines}>
          <View style={s.line}><CalendarDays size={14} color={c.muted} /><Text variant="small">{whenLabel(ev as any) || 'Date to be decided'}</Text></View>
          <View style={s.line}><MapPin size={14} color={c.muted} /><Text variant="small" numberOfLines={1} style={s.grow}>{ev.locationText || 'Place to be decided'}</Text></View>
          {ev.guestCount != null && <View style={s.line}><Users size={14} color={c.muted} /><Text variant="small">{ev.guestCount} guests · {ev.typeName}</Text></View>}
        </View>
        <View style={[s.people, { borderTopColor: `${tint}30` }]}>
          <MemberStack members={ev.members} max={5} size={30} />
          <Text variant="small" numberOfLines={1} style={s.grow}>{names}</Text>
          <Button title="Invite" icon={UserPlus} size="sm" disabled={!board.setup} onPress={() => setInvite(true)} />
        </View>
      </View>

      <View style={s.padX}>
        <Button title="Open group chat" icon={MessageCircle} block onPress={openChat} style={{ marginTop: 12 }} />
      </View>
      {!board.setup && <View style={[s.padX, { marginTop: 12 }]}><SetupNote /></View>}

      {showBudget && (
        <View style={s.budget}>
          <View style={s.between}>
            <Text variant="small" weight="700">Budget</Text>
            <Text variant="small" muted>{planned != null ? `${cents(booked)} of ${cents(planned)} booked` : `${cents(booked)} booked`}</Text>
          </View>
          {!!planned && (
            <View style={s.bar}>
              <View style={{ width: `${Math.min(100, (booked / planned) * 100)}%`, backgroundColor: c.ok }} />
              <View style={{ width: `${Math.max(0, Math.min(100 - (booked / planned) * 100, (pending / planned) * 100))}%`, backgroundColor: '#fbbf24' }} />
            </View>
          )}
          <Text variant="tiny" muted style={{ marginTop: 6 }}>
            Booked {cents(booked)}{pending > 0 ? ` · Requested ${cents(pending)}` : ''}{planned != null ? ` · Left ${cents(Math.max(0, planned - booked - pending))}` : ''}
          </Text>
        </View>
      )}

      <View style={s.boardHead}>
        <Text variant="h3">Who we’re hiring</Text>
        <Text variant="tiny" muted>{board.counts.covered} of {board.counts.categories} booked · tap 👍 on the ones you like</Text>
      </View>

      {groups.map((g) => {
        const done = g.items.some((x) => x.stage === 'booked')
        return (
          <View key={g.vertical.slug} style={[s.group, done && { borderColor: `${c.ok}66` }]}>
            <View style={s.groupHead}>
              <VerticalIcon name={g.vertical.icon} tint={g.vertical.tint} bubble bubbleSize={34} size={17} />
              <View style={s.groupTitle}>
                <Text variant="body" weight="700" numberOfLines={1}>{g.vertical.name}</Text>
                <Text variant="tiny" muted numberOfLines={1}>{done ? 'Booked' : g.items.length ? `${g.items.length} option${g.items.length === 1 ? '' : 's'}` : 'Nothing picked yet'}</Text>
              </View>
              {done ? (
                <View style={[s.pill, { backgroundColor: STAGE.booked.bg }]}><Check size={11} color={STAGE.booked.fg} /><Text variant="caption" style={{ color: STAGE.booked.fg }}>Done</Text></View>
              ) : !g.items.length ? (
                <Pressable onPress={() => findVendors(g)} hitSlop={8} style={[s.rowCenter, s.findInline]} accessibilityRole="button">
                  <Text variant="small" weight="600" color="accent">Find {article(g.vertical.noun)} {g.vertical.noun}</Text>
                  <ChevronRight size={14} color={c.accent} />
                </Pressable>
              ) : null}
            </View>
            {g.items.length > 0 && (
              <View style={s.items}>
                {g.items.map((x, i) => (
                  <CandidateRow key={x.providerId} cand={x} first={i === 0} canVote={board.setup && x.onBoard} onVote={() => vote(x)} onOpen={() => setPicked(x)} />
                ))}
                {!done && (
                  <Pressable onPress={() => findVendors(g)} style={s.find} accessibilityRole="button">
                    <SearchIcon size={14} color={c.muted} />
                    <Text variant="small" weight="600" muted>Find another {g.vertical.noun}</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )
      })}
      <Text variant="tiny" muted style={[s.padX, { marginTop: 16, marginBottom: 32 }]}>
        Add vendors from their profile with “Add to event”. Book from here and the booking is linked to this event.
      </Text>

      <InviteSheet open={invite} onClose={() => setInvite(false)} event={ev} onInvited={reload} />
      <CandidateSheet cand={picked} ev={ev} onClose={() => setPicked(null)} onChanged={reload} />
      <MoreSheet open={more} onClose={() => setMore(false)} ev={ev} setup={board.setup} onEdit={() => { setMore(false); setEditing(true) }} onChanged={reload} />
      <EditSheet open={editing} onClose={() => setEditing(false)} ev={ev} onSaved={reload} />
      <ShareSheet
        open={share}
        item={share ? { kind: 'event', id: ev.id, title: ev.title, subtitle: [whenLabel(ev as any), ev.locationText].filter(Boolean).join(' · ') } : null}
        onClose={() => setShare(false)}
      />
    </Screen>
  )
}

function StagePill({ stage }: { stage: string }) {
  const s = useStyles()
  const { c } = useTheme()
  const st = STAGE[stage] || STAGE.considering
  const bg = st.bg === 'soft' ? c.soft : st.bg
  const fg = st.fg === 'muted' ? c.muted : st.fg
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      {stage === 'booked' && <Check size={11} color={fg} />}
      <Text variant="caption" style={{ color: fg }}>{st.label}</Text>
    </View>
  )
}

function CandidateRow({ cand, first, canVote, onVote, onOpen }: { cand: Cand; first: boolean; canVote: boolean; onVote: () => void; onOpen: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const p = cand.provider as any
  const price = p ? priceFrom(p) : null
  return (
    <View style={[s.cand, !first && s.candLine]}>
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={p?.name || 'Vendor'}>
        <Photo uri={p?.cover} vertical={p?.vertical || cand.vertical} style={s.candImg} />
      </Pressable>
      <View style={s.grow}>
        <InA11yGroup value>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`${p?.name || 'Vendor'}${p ? `, ${ratingLabel(p.rating)}` : ', no longer listed'}${price ? `, ${price}` : ''}${cand.note ? `, note: ${cand.note}` : ''}`}
          accessibilityHint="Status and actions"
        >
          <Text variant="body" weight="700" numberOfLines={1}>{p?.name || 'A vendor'}</Text>
          <View style={s.rowCenter}>
            {p ? <RatingInline rating={p.rating} /> : <Text variant="tiny" muted>No longer listed</Text>}
            {!!price && <Text variant="tiny" muted numberOfLines={1}> · {price}</Text>}
          </View>
          {!!cand.note && <Text variant="tiny" style={{ fontStyle: 'italic', marginTop: 2 }}>“{cand.note}”</Text>}
        </Pressable>
        </InA11yGroup>
        <View style={[s.rowCenter, { gap: 6, marginTop: 6, flexWrap: 'wrap' }]}>
          <Pressable onPress={onOpen} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Status: ${cand.stage}. Change`}>
            <StagePill stage={cand.stage} />
          </Pressable>
          {canVote && (
            <Pressable onPress={onVote} hitSlop={6} style={[s.vote, cand.votedByMe && s.voteOn]} accessibilityRole="button" accessibilityState={{ selected: cand.votedByMe }} accessibilityLabel={`Vote, ${cand.votes}`}>
              <ThumbsUp size={12} color={cand.votedByMe ? '#2563eb' : c.ink} />
              {cand.votes > 0 && <Text variant="tiny" weight="600" style={cand.votedByMe ? { color: '#2563eb' } : undefined}>{cand.votes}</Text>}
            </Pressable>
          )}
          {!!cand.addedBy && <Text variant="tiny" muted numberOfLines={1}>by {(cand.addedBy as any).isMe ? 'you' : cand.addedBy.firstName}</Text>}
        </View>
      </View>
    </View>
  )
}

function CandidateSheet({ cand, ev, onClose, onChanged }: { cand: Cand | null; ev: Ev; onClose: () => void; onChanged: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { toast } = useStore()
  const [busy, setBusy] = useState(false)
  if (!cand) return null
  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true)
    try {
      await fn()
      if (msg) toast(msg)
      onChanged()
      onClose()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(false)
    }
  }
  const name = (cand.provider as any)?.name || 'This vendor'
  const go = (to: Parameters<typeof router.push>[0]) => {
    onClose()
    router.push(to)
  }
  const b = cand.booking
  return (
    <Sheet open onClose={onClose} title={name}>
      {b ? (
        <View style={s.noteBox}>
          <Check size={15} color={c.ok} />
          <Text variant="small" style={s.grow}>
            {cand.stage === 'booked' ? 'Booked' : 'Requested'} for this event{b.packageName ? ` · ${b.packageName}` : ''}{b.totalCents != null ? ` · ${cents(b.totalCents)}` : ''}.
          </Text>
          {b.mine && <Button title="Open" size="sm" variant="ghost" onPress={() => go({ pathname: '/bookings/[id]', params: { id: b.id } })} />}
        </View>
      ) : cand.onBoard ? (
        <View style={{ gap: 8 }}>
          {CANDIDATE_STATUSES.map(([value]) => {
            const on = cand.status === value
            return (
              <Pressable
                key={value}
                disabled={busy}
                onPress={() => (on ? onClose() : run(() => setCandidateStatus(ev.id, cand.providerId, value)))}
                style={[s.opt, on && { borderColor: c.ink, borderWidth: 2 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
              >
                <StagePill stage={value} />
                <Text variant="tiny" muted style={s.grow}>
                  {value === 'considering' ? 'Still deciding' : value === 'shortlisted' ? 'A favorite: tell the group' : 'Hired outside the app'}
                </Text>
                {on && <Check size={16} color={c.ink} />}
              </Pressable>
            )
          })}
        </View>
      ) : null}
      {cand.voters.length > 0 && <Text variant="small" muted style={{ marginTop: 8 }}>👍 {cand.voters.join(', ')}</Text>}
      <View style={[s.rowCenter, { gap: 8, marginTop: 16 }]}>
        <Button title="View profile" variant="ghost" grow onPress={() => go({ pathname: '/u/[id]', params: { id: cand.providerId } })} />
        {!b && (
          <Button title="Book for event" variant="accent" grow onPress={() => go({ pathname: '/book/[providerId]', params: { providerId: cand.providerId, event: ev.id, ...(ev.startDate ? { dates: ev.startDate } : {}) } })} />
        )}
      </View>
      {cand.onBoard && <Button title="Remove from board" icon={Trash2} variant="danger" block disabled={busy} onPress={() => run(() => removeCandidate(ev.id, cand.providerId), `Removed ${name}`)} style={{ marginTop: 8 }} />}
    </Sheet>
  )
}

function MoreSheet({ open, onClose, ev, setup, onEdit, onChanged }: { open: boolean; onClose: () => void; ev: Ev; setup: boolean; onEdit: () => void; onChanged: () => void }) {
  const s = useStyles()
  const router = useRouter()
  const { toast } = useStore()
  const [confirm, setConfirm] = useState<null | 'leave' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const close = () => {
    setConfirm(null)
    onClose()
  }
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true)
    try {
      await fn()
      after?.()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(false)
    }
  }
  if (confirm) {
    const leaving = confirm === 'leave'
    return (
      <Sheet open={open} onClose={close} title={leaving ? 'Leave this event?' : 'Delete this event?'}>
        <Text variant="small" muted>
          {leaving ? `You’ll leave “${ev.title}” and its group chat. Anyone planning can invite you back.` : `“${ev.title}”, its board and its group chat are deleted for everyone. Bookings stay in Bookings.`}
        </Text>
        <View style={[s.rowCenter, { gap: 10, marginTop: 16 }]}>
          <Button title="Cancel" variant="ghost" grow onPress={() => setConfirm(null)} />
          <Button
            title={leaving ? 'Leave' : 'Delete'}
            variant="danger"
            grow
            loading={busy}
            onPress={() => run(() => (leaving ? leaveEvent(ev.id) : deleteEvent(ev.id)), () => {
              toast(leaving ? 'You left the event' : 'Event deleted')
              close()
              router.replace('/events')
            })}
          />
        </View>
      </Sheet>
    )
  }
  return (
    <Sheet open={open} onClose={close} title="Event">
      <Text variant="label">{ev.members.length} planning</Text>
      {(ev.members as Member[]).map((m) => (
        <View key={m.profileId} style={s.member}>
          <Avatar uri={m.avatar} name={m.name} size={36} />
          <View style={s.grow}>
            <Text variant="body" numberOfLines={1}>{m.isMe ? `${m.name} (you)` : m.name}</Text>
            <Text variant="tiny" muted>{m.isOwner ? 'Organizer' : 'Co-planner'}{m.username ? ` · @${m.username}` : ''}</Text>
          </View>
          {ev.isOwner && !m.isMe && setup && (
            <Button title="Remove" size="sm" variant="ghost" disabled={busy} onPress={() => run(() => removeEventMember(ev.id, m.profileId), () => { toast(`Removed ${m.firstName}`); onChanged() })} />
          )}
        </View>
      ))}
      <View style={{ gap: 8, marginTop: 12 }}>
        <Button title="Edit details" variant="ghost" block onPress={onEdit} />
        {ev.isOwner ? (
          <Button title="Delete event" variant="danger" block onPress={() => setConfirm('delete')} />
        ) : (
          <Button title="Leave event" variant="danger" block onPress={() => setConfirm('leave')} />
        )}
      </View>
    </Sheet>
  )
}

function EditSheet({ open, onClose, ev, onSaved }: { open: boolean; onClose: () => void; ev: Ev; onSaved: () => void }) {
  const { toast } = useStore()
  const [title, setTitle] = useState(ev.title)
  const [type, setType] = useState<string | null>(ev.type)
  const [place, setPlace] = useState(ev.locationText || '')
  const [guests, setGuests] = useState(ev.guestCount != null ? String(ev.guestCount) : '')
  const [budget, setBudget] = useState(ev.budgetCents != null ? String(Math.round(ev.budgetCents / 100)) : '')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setTitle(ev.title)
    setType(ev.type)
    setPlace(ev.locationText || '')
    setGuests(ev.guestCount != null ? String(ev.guestCount) : '')
    setBudget(ev.budgetCents != null ? String(Math.round(ev.budgetCents / 100)) : '')
  }, [open, ev])
  const save = async () => {
    setBusy(true)
    try {
      await editEvent(ev.id, { title, type, locationText: place, guestCount: guests === '' ? null : Number(guests), budget: budget === '' ? null : Number(budget) } as any)
      toast('Saved')
      onSaved()
      onClose()
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Edit event">
      <View style={{ gap: 12 }}>
        <TextField label="Name" value={title} onChangeText={setTitle} maxLength={120} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {EVENT_KINDS.map(([slug, name]) => <Chip key={slug} label={name} toggle on={type === slug} onPress={() => setType(slug)} />)}
        </View>
        <TextField label="Where" value={place} onChangeText={setPlace} maxLength={200} />
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><TextField label="Guests" value={guests} onChangeText={setGuests} keyboardType="number-pad" /></View>
          <View style={{ flex: 1 }}><TextField label="Budget ($)" value={budget} onChangeText={setBudget} keyboardType="decimal-pad" /></View>
        </View>
        <Button title={busy ? 'Saving…' : 'Save'} block loading={busy} onPress={save} />
      </View>
    </Sheet>
  )
}

const useStyles = makeStyles((t) => ({
  grow: { flex: 1, minWidth: 0 },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  padX: { paddingHorizontal: t.space.lg },
  hero: { marginHorizontal: t.space.lg, marginTop: 4, padding: 16, borderRadius: 22 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: t.c.card, alignItems: 'center', justifyContent: 'center' },
  count: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: t.c.card },
  lines: { gap: 4, marginTop: 8 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  people: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 12, borderTopWidth: 1 },
  budget: { marginHorizontal: t.space.lg, marginTop: 14, padding: 14, borderWidth: 1, borderColor: t.c.line, borderRadius: 16 },
  bar: { height: 8, borderRadius: 999, backgroundColor: t.c.soft, overflow: 'hidden', flexDirection: 'row', marginTop: 8 },
  boardHead: { paddingHorizontal: t.space.lg, paddingTop: 22, paddingBottom: 4 },
  group: { marginHorizontal: t.space.lg, marginTop: 10, borderWidth: 1, borderColor: t.c.line, borderRadius: 18, overflow: 'hidden' },
  // "Entertainment / Nothing picked yet" + "Find an entertainer >": when they don't fit on one
  // line (320pt) the link wraps under the title, right-aligned, instead of truncating the name.
  groupHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 2, padding: 12 },
  groupTitle: { flexGrow: 1, flexShrink: 1, flexBasis: 140, minWidth: 0 },
  findInline: { marginLeft: 'auto', minHeight: 32 },
  items: { borderTopWidth: 1, borderTopColor: t.c.line },
  find: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 10, borderTopWidth: 1, borderTopColor: t.c.line, borderStyle: 'dashed' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  cand: { flexDirection: 'row', gap: 10, padding: 12, alignItems: 'flex-start' },
  candLine: { borderTopWidth: 1, borderTopColor: t.c.line },
  candImg: { width: 56, height: 56, borderRadius: 12 },
  vote: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: t.c.line },
  voteOn: { backgroundColor: t.scheme === 'dark' ? '#172554' : '#eff6ff', borderColor: '#bfdbfe' },
  noteBox: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.soft },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: t.c.line },
  member: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
}))
