// /inbox/[id]: native port of frontend/src/screens/Chat.jsx. One conversation:
// realtime messages, read receipts and "typing…" (shared openChat), optimistic send
// with retry/delete, day separators, stacked bubbles, pinned booking, details sheet.
// The list is an inverted FlatList (newest at the bottom, stays pinned there);
// KeyboardView keeps the composer above the keyboard on iOS and Android.
// Long-press someone else's message to report it or block them.
import { useLocalSearchParams, useRouter } from 'expo-router'
import { AlertCircle, Calendar, CalendarHeart, ChevronLeft, ChevronRight, Info, MessageCircle, SendHorizontal } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, TextInput, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

import { getBooking } from '@shared/api/bookings.js'
import { eventForConversation } from '@shared/api/events.js'
import {
  getConversation, listMessages, markRead, messageError, openChat, sendMessage,
} from '@shared/api/messages.js'
import { avatarUrl } from '@shared/lib/format.js'
import { Avatar, Button, EmptyState, ErrorState, KeyboardView, Loading, Photo, Screen, SignInPrompt, Text, VerticalIcon } from '@/components'
import useQuery from '@/hooks/useQuery'
import { StatusPill } from '@/screens/bookings/parts'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { announce } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'
import { ShareCard, type SharedThing } from '@/components/share/ShareCard'
import ChatInfo, { type ChatConversation } from './ChatInfo'
import ModerationSheet, { type ModerationTarget } from './ModerationSheet'

type Conversation = NonNullable<Awaited<ReturnType<typeof getConversation>>>
type Message = Awaited<ReturnType<typeof listMessages>>[number] & { pending?: boolean; failed?: string | null }
type Thread = { conversation: Conversation | null; messages: Message[] }

const loadThread = async (id: string): Promise<Thread> => {
  const [conversation, messages] = await Promise.all([getConversation(id), listMessages(id)])
  return { conversation, messages }
}

// Add a message from the server, replacing its optimistic copy (tempId) and skipping duplicates.
const withMessage = (msg: Message, tempId?: string) => (d: Thread | undefined) => {
  if (!d) return d
  let messages = tempId ? d.messages.filter((m) => m.id !== tempId) : d.messages
  if (!messages.some((m) => m.id === msg.id)) messages = [...messages, msg]
  return { ...d, messages }
}

// "Today", "Yesterday", "Mon, Oct 5", or "Oct 5, 2025" for other years.
const dayLabel = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((start(today) - start(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  if (d.getFullYear() !== today.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

const GROUP_GAP_MS = 5 * 60 * 1000 // messages closer than this from the same person stack together
let tempSeq = 0

type Row =
  | { kind: 'msg'; key: string; m: Message; newDay: string | null; joinsPrev: boolean; joinsNext: boolean; receipt: string | null }
  | { kind: 'typing'; key: string }

export default function Chat() {
  const s = useStyles()
  const { c: col } = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { toast } = useStore()
  const { user, loading: authLoading } = useAuth()
  const { data, loading, error, reload, setData } = useQuery<Thread>(user && id ? () => loadThread(id) : null, [id, user?.id])
  const c = data?.conversation ?? null
  const messages = data?.messages || []
  const { data: booking } = useQuery<any>(c?.bookingId ? () => getBooking(c.bookingId) : null, [c?.bookingId])
  // Event chats link to their board and wear the occasion's icon in the header.
  const { data: chatEvent } = useQuery<{ id: string; tint: string; icon: string } | null>(c?.kind === 'event' ? () => eventForConversation(c.id) : null, [c?.id, c?.kind])
  const eventId = chatEvent?.id ?? null
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<ModerationTarget | null>(null)
  const [info, setInfo] = useState(false)
  const [typing, setTyping] = useState<Record<string, number>>({}) // profileId -> timestamp
  const live = useRef<ReturnType<typeof openChat> | null>(null)
  const input = useRef<TextInput>(null)

  // Live: new messages, read receipts, typing. Mark read on open and on each incoming message.
  const ready = !!c
  useEffect(() => {
    if (!ready || !id) return
    markRead(id).catch((e: unknown) => console.warn(e))
    live.current = openChat(id, {
      onMessage: (msg: Message) => {
        setData(withMessage(msg))
        if (!msg.mine) {
          setTyping((t) => ({ ...t, [msg.from]: 0 }))
          markRead(id).catch((e: unknown) => console.warn(e))
        }
      },
      onRead: (profileId: string, at: string) =>
        setData((d) => d && d.conversation ? { ...d, conversation: { ...d.conversation, members: d.conversation.members.map((m: any) => (m.profileId === profileId ? { ...m, lastReadAt: at } : m)) } } : d),
      onTyping: (profileId: string) => setTyping((t) => ({ ...t, [profileId]: Date.now() })),
    })
    return () => live.current?.close()
  }, [id, ready, setData])

  // Typing indicators fade after a few seconds.
  const [, tick] = useState(0)
  useEffect(() => {
    if (!Object.values(typing).some((t) => Date.now() - t < 4000)) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [typing])

  // Optimistic send: show the message right away, then swap in the saved one (or mark it failed).
  const deliver = async (text: string, tempId: string) => {
    try {
      const saved = await sendMessage(id, { text } as any)
      setData(withMessage(saved, tempId))
    } catch (err) {
      console.warn(err)
      setData((d) => d && { ...d, messages: d.messages.map((m) => (m.id === tempId ? { ...m, pending: false, failed: messageError(err) } : m)) })
    }
  }
  const send = () => {
    const text = draft.trim()
    if (!text || !user) return
    const tempId = `tmp-${++tempSeq}`
    const at = new Date().toISOString()
    setDraft('')
    const temp = { id: tempId, conversationId: id, mine: true, from: user.id, text, at, time: timeOf(at), sharedAlbum: null, sharedAlbumId: null, pending: true } as Message
    setData((d) => d && { ...d, messages: [...d.messages, temp] })
    deliver(text, tempId)
  }
  const retry = (m: Message) => {
    setData((d) => d && { ...d, messages: d.messages.map((x) => (x.id === m.id ? { ...x, pending: true, failed: null } : x)) })
    deliver(m.text, m.id)
  }
  const discard = (m: Message) => setData((d) => d && { ...d, messages: d.messages.filter((x) => x.id !== m.id) })

  const isGroup = !!c?.isGroup || c?.kind === 'event'
  const others = (c?.members || []) as ChatConversation['members']
  const other = others[0]
  const byProfile = useMemo(() => new Map(others.map((m) => [m.profileId, m])), [others])
  const authorOf = (m: Message) =>
    byProfile.get(m.from) || { id: m.from, profileId: m.from, name: 'Former member', username: null, avatar: avatarUrl(null, '?') }

  // Read receipt for my latest delivered message.
  const lastMine = [...messages].reverse().find((m) => m.mine && !m.pending && !m.failed)
  const seenBy = lastMine ? others.filter((m) => m.lastReadAt && m.lastReadAt >= lastMine.at) : []
  const receipt = !lastMine
    ? null
    : isGroup
      ? seenBy.length ? `Seen by ${seenBy.length === others.length ? 'everyone' : seenBy.map((m) => m.name.split(' ')[0]).join(', ')}` : 'Sent'
      : seenBy.length ? 'Seen' : 'Sent'
  const typers = others.filter((m) => typing[m.profileId] && Date.now() - typing[m.profileId] < 4000)

  // Rows, oldest first, then reversed for the inverted list.
  const rows: Row[] = useMemo(() => {
    const out: Row[] = messages.map((m, i) => {
      const prev = messages[i - 1]
      const next = messages[i + 1]
      const newDay = !prev || dayLabel(prev.at) !== dayLabel(m.at) ? dayLabel(m.at) : null
      const joinsPrev = !newDay && !!prev && prev.from === m.from && +new Date(m.at) - +new Date(prev.at) < GROUP_GAP_MS
      const joinsNext = !!next && next.from === m.from && dayLabel(next.at) === dayLabel(m.at) && +new Date(next.at) - +new Date(m.at) < GROUP_GAP_MS
      return { kind: 'msg', key: m.id, m, newDay, joinsPrev, joinsNext, receipt: m === lastMine ? receipt : null }
    })
    if (typers.length) out.push({ kind: 'typing', key: 'typing' })
    return out.reverse()
  }, [messages, lastMine, receipt, typers.length])

  if (authLoading || (loading && !data)) return <Screen title="Messages" back scroll={false}><Loading /></Screen>
  if (!user) return <Screen title="Messages" back><SignInPrompt title="Sign in to see this conversation" /></Screen>
  if (error && !data) return <Screen title="Messages" back><ErrorState error={error} onRetry={reload} /></Screen>
  if (!c) {
    return (
      <Screen title="Messages" back>
        <EmptyState
          icon={MessageCircle}
          title="Conversation not found"
          text="It may have been removed, or you’re not part of it."
          action={<Button title="Back to messages" variant="ghost" size="sm" onPress={() => router.replace('/inbox')} />}
        />
      </Screen>
    )
  }

  const pinned = c.bookingId ? { status: booking?.status ?? c.booking?.status, name: booking?.packageName ?? c.booking?.packageName ?? 'Booking' } : null
  const subtitle = typers.length ? 'typing…' : isGroup ? `${others.length + 1} people` : other?.username ? `@${other.username}` : null
  const openProfile = (pid: string) => router.push({ pathname: '/u/[id]', params: { id: pid } })

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header: back, who (tap: their profile, or group details), details */}
      <View style={s.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/inbox'))} hitSlop={10} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={col.ink} />
        </Pressable>
        <Pressable
          style={s.who}
          onPress={() => (isGroup || !other ? setInfo(true) : openProfile(other.id))}
          accessibilityRole="button"
          accessibilityLabel={isGroup ? `${c.title}, group details` : `${c.title}, view profile`}
        >
          {c.kind === 'event' ? (
            <VerticalIcon name={chatEvent?.icon ?? 'PartyPopper'} tint={chatEvent?.tint ?? col.muted} size={16} bubble bubbleSize={32} />
          ) : other && <Avatar uri={other.avatar} name={other.name} size={32} />}
          <View style={s.grow}>
            <Text variant="h4" numberOfLines={1}>{c.title}</Text>
            {!!subtitle && <Text variant="tiny" muted numberOfLines={1} color={typers.length ? 'accent' : undefined}>{subtitle}</Text>}
          </View>
        </Pressable>
        {!!eventId && (
          <Pressable onPress={() => router.push({ pathname: '/events/[id]', params: { id: eventId } })} hitSlop={10} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Event board">
            <CalendarHeart size={22} color={col.ink} />
          </Pressable>
        )}
        <Pressable onPress={() => setInfo(true)} hitSlop={10} style={s.iconBtn} accessibilityRole="button" accessibilityLabel="Conversation details">
          <Info size={22} color={col.ink} />
        </Pressable>
      </View>

      {pinned && (
        <Pressable onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: c.bookingId! } })} style={({ pressed }) => [s.pinned, pressed && { opacity: 0.8 }]} accessibilityRole="button">
          <Calendar size={18} color={col.ink} />
          <View style={s.grow}>
            <Text variant="small" weight="600" numberOfLines={1}>{pinned.name}</Text>
            {booking && <Text variant="tiny" muted numberOfLines={1}>{[booking.date, booking.location].filter(Boolean).join(' · ')}</Text>}
          </View>
          {pinned.status && <StatusPill status={pinned.status} />}
          <ChevronRight size={16} color={col.muted} />
        </Pressable>
      )}

      <KeyboardView bottomInset={insets.bottom}>
        {messages.length === 0 ? (
          <View style={s.intro}>
            {isGroup ? (
              <View style={s.introAvatars}>
                {others.slice(0, 3).map((m) => <Avatar key={m.profileId} uri={m.avatar} name={m.name} size={52} ring />)}
              </View>
            ) : other ? (
              <Avatar uri={other.avatar} name={other.name} size="lg" />
            ) : null}
            <Text variant="h3" center>{c.title}</Text>
            {!isGroup && other && <Button title="View profile" variant="ghost" size="sm" onPress={() => openProfile(other.id)} />}
            <Text variant="small" muted center>
              {c.kind === 'inquiry' && other
                ? `Ask ${other.name?.split(' ')[0] || 'them'} about availability, pricing or style.`
                : isGroup
                  ? 'Say hi to the group.'
                  : `This is the start of your conversation with ${other?.name?.split(' ')[0] || 'them'}.`}
            </Text>
          </View>
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(r) => r.key}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={s.list}
            renderItem={({ item: r }) =>
              r.kind === 'typing' ? (
                <View style={[s.msg, s.typingRow]}>
                  <View style={s.msgAvatar}><Avatar uri={typers[0].avatar} name={typers[0].name} size={28} /></View>
                  <View style={[s.bubble, s.typingBubble]} accessibilityLabel={`${typers[0].name} is typing`}>
                    <Text muted>• • •</Text>
                  </View>
                </View>
              ) : (
                <MessageRow
                  row={r}
                  isGroup={isGroup}
                  author={r.m.mine ? null : authorOf(r.m)}
                  onProfile={openProfile}
                  onLongPress={(m, a) => setMenu({ what: 'message', username: a.username, target: { type: 'message', id: m.id }, blockProfileId: a.profileId })}
                  onRetry={retry}
                  onDiscard={discard}
                />
              )
            }
          />
        )}

        <View style={s.composer}>
          <TextInput
            ref={input}
            style={s.input}
            placeholder="Message…"
            placeholderTextColor={col.faint}
            multiline
            maxLength={4000}
            value={draft}
            onChangeText={(v) => {
              setDraft(v)
              if (v) live.current?.typing()
            }}
            accessibilityLabel="Message"
          />
          <Pressable
            onPress={send}
            disabled={!draft.trim()}
            hitSlop={4}
            style={({ pressed }) => [s.send, !draft.trim() && s.sendOff, pressed && { opacity: 0.7 }]}
            accessibilityRole="button"
            accessibilityLabel="Send"
            accessibilityState={{ disabled: !draft.trim() }}
          >
            <SendHorizontal size={20} color={col.onAccent} />
          </Pressable>
        </View>
      </KeyboardView>

      <ChatInfo
        open={info}
        onClose={() => setInfo(false)}
        conversation={c as unknown as ChatConversation}
        onChanged={reload}
        onLeft={() => {
          setInfo(false)
          router.replace('/inbox')
        }}
        onReport={() => {
          setInfo(false)
          // Let the first sheet finish closing before opening the next one (iOS can't stack modals mid-animation).
          setTimeout(() => setMenu({
            what: 'conversation',
            username: isGroup ? null : other?.username,
            target: !isGroup && other ? { type: 'profile', id: other.profileId } : null,
            blockProfileId: isGroup ? null : other?.profileId,
          }), 400)
        }}
      />
      <ModerationSheet open={!!menu} onClose={() => setMenu(null)} {...(menu || {})} />
    </SafeAreaView>
  )
}

type Author = { id: string; profileId: string; name: string; username?: string | null; avatar: string }
type MsgRow = Extract<Row, { kind: 'msg' }>

function MessageRow({ row, isGroup, author, onProfile, onLongPress, onRetry, onDiscard }: {
  row: MsgRow
  isGroup: boolean
  author: Author | null
  onProfile: (id: string) => void
  onLongPress: (m: Message, a: Author) => void
  onRetry: (m: Message) => void
  onDiscard: (m: Message) => void
}) {
  const s = useStyles()
  const { c } = useTheme()
  const { m, newDay, joinsPrev, joinsNext, receipt } = row
  // A send that failed is spoken (the red "Not sent · Retry · Delete" line is visual only).
  useEffect(() => {
    if (m.mine && m.failed) announce('Message not sent. Retry or delete it below the message.')
  }, [m.mine, m.failed])
  const shared = m.shared
  return (
    <View>
      {newDay && (
        <View style={s.daySep}>
          <Text variant="tiny" muted weight="600">{newDay}</Text>
        </View>
      )}
      <View style={[s.msg, m.mine && s.mine, joinsPrev ? s.joined : s.notJoined]}>
        {!m.mine && (
          <View style={s.msgAvatar}>
            {!joinsNext && author && (
              <Pressable onPress={() => onProfile(author.id)} accessibilityRole="link" accessibilityLabel={`${author.name}'s profile`}>
                <Avatar uri={author.avatar} name={author.name} size={28} />
              </Pressable>
            )}
          </View>
        )}
        <View style={[s.msgCol, m.mine && s.msgColMine]}>
          {!m.mine && isGroup && !joinsPrev && author && (
            <Text variant="tiny" muted style={s.author} onPress={() => onProfile(author.id)} accessibilityRole="link" accessibilityHint="Opens their profile">{author.name}</Text>
          )}
          {!!shared && <ShareCard shared={shared as SharedThing} />}
          {!!m.text && (
            <Pressable
              onLongPress={() => !m.mine && author && onLongPress(m, author)}
              delayLongPress={350}
              style={[s.bubble, m.mine ? s.bubbleMine : s.theirs, m.pending && s.pending, !!m.failed && s.failedBubble]}
              // One element per message: who said it, what, and whether it went through. Report /
              // block is a screen-reader action as well as a long-press.
              accessible
              accessibilityLabel={`${m.mine ? 'You' : author?.name || 'Them'}: ${m.text}${m.failed ? '. Not sent' : m.pending ? '. Sending' : ''}`}
              accessibilityActions={!m.mine && author ? [{ name: 'longpress', label: 'Report or block' }] : undefined}
              onAccessibilityAction={(e) => {
                if (e.nativeEvent.actionName === 'longpress' && !m.mine && author) onLongPress(m, author)
              }}
            >
              <Text style={{ color: m.mine ? c.onInk : c.ink, fontSize: 15, lineHeight: 20 }} selectable>{m.text}</Text>
            </Pressable>
          )}
          {!!m.failed && (
            <View style={s.failedRow}>
              <AlertCircle size={12} color={c.danger} />
              <Text variant="tiny" color="danger">Not sent ·</Text>
              <Text variant="tiny" color="danger" weight="700" onPress={() => onRetry(m)} accessibilityRole="button">Retry</Text>
              <Text variant="tiny" color="danger">·</Text>
              <Text variant="tiny" color="danger" weight="700" onPress={() => onDiscard(m)} accessibilityRole="button">Delete</Text>
            </View>
          )}
          {!joinsNext && !m.failed && <Text variant="tiny" muted style={s.time}>{m.pending ? 'Sending…' : m.time}</Text>}
          {!!receipt && <Text variant="tiny" muted style={s.time}>{receipt}</Text>}
        </View>
      </View>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  grow: { flex: 1, minWidth: 0 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: t.space.xs, height: 56,
    borderBottomWidth: 1, borderBottomColor: t.c.line,
  },
  iconBtn: { padding: 6 },
  who: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  pinned: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: t.space.lg, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.c.line, backgroundColor: t.c.soft,
  },
  list: { paddingHorizontal: t.space.md, paddingVertical: t.space.md },
  intro: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: t.space.xl },
  introAvatars: { flexDirection: 'row', marginBottom: 4 },
  daySep: { alignItems: 'center', marginTop: t.space.lg, marginBottom: t.space.xs },
  msg: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  mine: { justifyContent: 'flex-end' },
  joined: { marginTop: 2 },
  notJoined: { marginTop: 10 },
  msgAvatar: { width: 28 },
  msgCol: { maxWidth: '78%', alignItems: 'flex-start', gap: 2 },
  msgColMine: { alignItems: 'flex-end' },
  author: { marginLeft: 12, marginBottom: 1 },
  bubble: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 18 },
  bubbleMine: { backgroundColor: t.c.ink },
  theirs: { backgroundColor: t.c.soft },
  pending: { opacity: 0.6 },
  failedBubble: { opacity: 0.6, borderWidth: 1, borderColor: t.c.danger },
  failedRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  time: { marginHorizontal: 6 },
  typingRow: { marginTop: 10 },
  typingBubble: { backgroundColor: t.c.soft, paddingVertical: 6 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: t.space.md, paddingVertical: t.space.sm,
    borderTopWidth: 1, borderTopColor: t.c.line, backgroundColor: t.c.bg,
  },
  input: {
    flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: t.c.soft, borderRadius: 20, paddingHorizontal: 14,
    paddingTop: 10, paddingBottom: 10, fontSize: 15, color: t.c.ink,
  },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: t.c.accent, alignItems: 'center', justifyContent: 'center' },
  sendOff: { opacity: 0.35 },
}))
