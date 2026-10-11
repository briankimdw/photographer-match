// "Send to" sheet (the web's components/share/ShareSheet.jsx): pick recent chats
// or people, add a note, Send. Each chosen chat gets one message with a card.
// "Share to…" opens the system share sheet (RN Share), which also offers Copy.
//
//   <ShareSheet item={{ kind: 'post'|'provider'|'event'|'plan', id, title?, image?, subtitle?, providerId?, link? }} onClose={...} />
//
// Mount it when it should show, or pass open={bool}. kind 'plan' (an unsaved plan)
// only offers the system share sheet.
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { Check, Link2, Search, Share2, Users } from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, Share, TextInput, View } from 'react-native'

import {
  listConversations, mergeShareTargets, messageError, searchPeople, shareLink, shareRecipients, shareSupport, shareToChats,
} from '@shared/api/messages.js'
import { Avatar, Button, Loading, Photo, Sheet, Text, TextField } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, useTheme } from '@/theme'

export type ShareItem = {
  kind: 'post' | 'provider' | 'event' | 'plan'
  id: string
  title?: string | null
  image?: string | null
  subtitle?: string | null
  providerId?: string | null
  link?: string | null
}

type Target = ReturnType<typeof mergeShareTargets>[number]

const MAX_PICK = 20
const NOUN: Record<ShareItem['kind'], string> = { post: 'post', provider: 'vendor', event: 'event', plan: 'plan' }

export function ShareSheet({ item, onClose, open = true }: { item: ShareItem | null; onClose: () => void; open?: boolean }) {
  const s = useStyles()
  const { c } = useTheme()
  const { user } = useAuth()
  const { toast } = useStore()
  if (!item) return null
  const path = item.link || shareLink(item)
  const url = Platform.OS === 'web' && typeof window !== 'undefined' ? `${window.location.origin}${path}` : Linking.createURL(path)

  const shareOut = () => {
    const title = item.title || 'Event Organizer'
    Share.share(Platform.OS === 'ios' ? { title, url } : { title, message: `${title}\n${url}` }, { dialogTitle: 'Share', subject: title }).catch(() => {})
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast('Link copied')
    } catch {
      shareOut()
    }
  }
  const actions = (
    <View style={s.actions}>
      {Platform.OS === 'web' && (
        <Pressable onPress={copy} style={s.action} accessibilityRole="button" accessibilityLabel="Copy link">
          <View style={s.actionIcon}><Link2 size={20} color={c.ink} /></View>
          <Text variant="tiny">Copy link</Text>
        </Pressable>
      )}
      <Pressable onPress={shareOut} style={s.action} accessibilityRole="button" accessibilityLabel="Share to another app">
        <View style={s.actionIcon}><Share2 size={20} color={c.ink} /></View>
        <Text variant="tiny">Share to…</Text>
      </Pressable>
    </View>
  )

  return (
    <Sheet open={open} onClose={onClose} title="Share" scroll={false}>
      {(item.title || item.image) && (
        <View style={s.item}>
          {item.image ? <Photo uri={item.image} style={s.itemThumb} /> : <View style={[s.itemThumb, s.center]}><Share2 size={16} color={c.muted} /></View>}
          <View style={s.grow}>
            <Text weight="600" numberOfLines={1}>{item.title || 'Untitled'}</Text>
            {!!item.subtitle && <Text variant="tiny" muted numberOfLines={1}>{item.subtitle}</Text>}
          </View>
        </View>
      )}
      {user && item.kind !== 'plan' ? (
        <SendTo item={item} onDone={onClose} actions={actions} />
      ) : (
        <>
          {!user && (
            <Pressable
              onPress={() => {
                onClose()
                router.push('/sign-in')
              }}
              style={s.note}
              accessibilityRole="link"
            >
              <Text variant="small" muted><Text variant="small" color="accent" weight="600">Sign in</Text> to send this {NOUN[item.kind]} in a message.</Text>
            </Pressable>
          )}
          <View style={s.footer}>{actions}</View>
        </>
      )}
    </Sheet>
  )
}

export default ShareSheet

function SendTo({ item, onDone, actions }: { item: ShareItem; onDone: () => void; actions: ReactNode }) {
  const s = useStyles()
  const { c } = useTheme()
  const { toast } = useStore()
  const { data: conversations, loading } = useQuery(() => listConversations(), [])
  const { data: support } = useQuery(() => shareSupport(), [])
  const [q, setQ] = useState('')
  const [people, setPeople] = useState<unknown[]>([])
  const [searching, setSearching] = useState(false)
  const [picked, setPicked] = useState<Target[]>([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const noteRef = useRef<TextInput>(null)

  useEffect(() => {
    const term = q.trim()
    if (!term) {
      setPeople([])
      return undefined
    }
    let live = true
    setSearching(true)
    const t = setTimeout(() => {
      searchPeople(term)
        .then((r) => live && setPeople(r))
        .catch((e: unknown) => {
          console.warn(e)
          if (live) setPeople([])
        })
        .finally(() => live && setSearching(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  const targets = useMemo(() => mergeShareTargets((conversations || []) as any, people as any, q), [conversations, people, q])
  const pickedKeys = new Set(picked.map((t) => t.key))
  const shown = [...picked.filter((t) => !targets.some((x) => x.key === t.key)), ...targets]
  const toggle = (t: Target) => {
    if (pickedKeys.has(t.key)) setPicked(picked.filter((x) => x.key !== t.key))
    else if (picked.length < MAX_PICK) setPicked([...picked, t])
  }

  const send = async () => {
    if (!picked.length || busy) return
    setBusy(true)
    try {
      const { sent, failed } = await shareToChats({ ...shareRecipients(picked), kind: item.kind as 'post', id: item.id, text: note, link: item.link || shareLink(item) } as any)
      const who = sent.length === 1 ? picked.find((t) => t.conversationId === sent[0])?.name || '1 chat' : `${sent.length} chats`
      toast(failed.length ? `Sent to ${who} · ${failed.length} couldn’t be sent` : `Sent to ${who}`)
      onDone()
    } catch (e) {
      console.warn(e)
      toast(messageError(e))
      setBusy(false)
    }
  }

  if (support && item.kind === 'event' && !support.event) {
    return (
      <>
        <Text variant="small" muted style={s.note}>Sending events in chat needs a database update. You can still share the link.</Text>
        <View style={s.footer}>{actions}</View>
      </>
    )
  }

  return (
    <>
      <TextField icon={Search} placeholder="Search" value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} clearable returnKeyType="search" />
      <ScrollView style={s.list} contentContainerStyle={s.grid} keyboardShouldPersistTaps="handled">
        {loading && !conversations ? (
          <Loading inline />
        ) : !shown.length ? (
          <Text variant="small" muted style={s.note}>
            {q.trim() ? (searching ? 'Searching…' : `No one found for “${q.trim()}”.`) : 'No chats yet. Search for someone to send this to.'}
          </Text>
        ) : (
          shown.map((t) => {
            const on = pickedKeys.has(t.key)
            const stack = t.isGroup && t.avatars.length > 1
            return (
              <Pressable
                key={t.key}
                onPress={() => toggle(t)}
                style={s.target}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }} aria-checked={on}
                accessibilityLabel={t.name}
              >
                <View style={[s.av, on && s.avOn]}>
                  {stack ? (
                    <>
                      <View style={s.stackA}><Avatar uri={t.avatars[0]} name={t.name} size={40} ring /></View>
                      <View style={s.stackB}><Avatar uri={t.avatars[1]} name={t.name} size={40} ring /></View>
                    </>
                  ) : (
                    <Avatar uri={t.avatar} name={t.name} size={58} />
                  )}
                  {t.isGroup && !stack && <View style={s.groupBadge}><Users size={10} color={c.onInk} /></View>}
                  {on && <View style={[s.check, s.checkOn]}><Check size={12} strokeWidth={3} color={c.onAccent} /></View>}
                </View>
                <Text variant="tiny" weight={on ? '600' : '400'} numberOfLines={2} center>{t.name}</Text>
              </Pressable>
            )
          })
        )}
      </ScrollView>
      <View style={s.footer}>
        {picked.length ? (
          <>
            <TextInput
              ref={noteRef}
              style={s.noteInput}
              placeholder="Write a message…"
              placeholderTextColor={c.faint}
              accessibilityLabel="Message to send with it"
              maxFontSizeMultiplier={2}
              maxLength={2000}
              value={note}
              onChangeText={setNote}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Button block title={busy ? 'Sending…' : picked.length > 1 ? `Send separately (${picked.length})` : 'Send'} loading={busy} onPress={send} />
          </>
        ) : (
          actions
        )}
      </View>
    </>
  )
}

const useStyles = makeStyles((t) => ({
  grow: { flex: 1, minWidth: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.md, marginBottom: t.space.md },
  itemThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: t.c.soft },
  note: { paddingVertical: t.space.md },
  list: { maxHeight: 330, marginTop: t.space.sm, flexGrow: 0 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingVertical: t.space.xs, rowGap: 14 },
  target: { width: '25%', alignItems: 'center', gap: 6, paddingHorizontal: 3 },
  av: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  avOn: { transform: [{ scale: 0.94 }] },
  stackA: { position: 'absolute', top: 0, left: 0 },
  stackB: { position: 'absolute', right: 0, bottom: 0 },
  groupBadge: { position: 'absolute', left: -2, bottom: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: t.c.ink, borderWidth: 2, borderColor: t.c.bg, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: t.c.bg, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: t.c.accent },
  footer: { borderTopWidth: 1, borderTopColor: t.c.line, marginTop: t.space.sm, marginHorizontal: -20, paddingHorizontal: 20, paddingTop: t.space.md, gap: t.space.sm },
  noteInput: { borderWidth: 1, borderColor: t.c.line, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14, fontSize: t.font.size.md, color: t.c.ink, backgroundColor: t.c.soft },
  actions: { flexDirection: 'row', gap: 18 },
  action: { alignItems: 'center', gap: 6, minWidth: 64 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
}))
