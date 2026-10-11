// "Add to event" (the web's components/events/EventParts.jsx AddToEventSheet / AddToEventButton):
// pick one of my upcoming events and add a vendor to its board; the event chat gets
// "Brian added DJ Nova to DJs & live music". Also the calendar-style EventDate tile.
// Imports primitives from their files (not '@/components') because components/ProviderCard
// uses AddToEventButton, and the index would make an import cycle.
import { usePathname, useRouter } from 'expo-router'
import { CalendarPlus, Check, DatabaseZap, Plus } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, View } from 'react-native'

import { SETUP_MESSAGE, addCandidate, eventError, eventsWithCandidate, isSetupError, listUpcomingEvents, whenLabel } from '@shared/api/events.js'
import { fromKey } from '@shared/lib/dates.js'
import { Button } from '@/components/Button'
import { Sheet } from '@/components/Sheet'
import { Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { VerticalIcon } from '@/components/VerticalIcon'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { makeStyles, readableTint, useTheme } from '@/theme'

export type EventItem = Awaited<ReturnType<typeof listUpcomingEvents>>[number]
type Vendor = { id: string; name: string; vertical: string; profileId?: string | null }

// Month + day tile in the event's tint (an icon when there's no date yet).
export function EventDate({ ev, size = 46 }: { ev: Pick<EventItem, 'startDate' | 'tint' | 'icon'>; size?: number }) {
  const s = useStyles()
  const { scheme } = useTheme()
  const tint = ev.tint || '#6366f1'
  if (!ev.startDate) {
    return (
      <View style={[s.date, { width: size, height: size + 4, backgroundColor: `${tint}1f`, justifyContent: 'center' }]}>
        <VerticalIcon name={ev.icon} size={20} color={tint} />
      </View>
    )
  }
  const d = fromKey(ev.startDate)
  return (
    <View style={[s.date, { width: size, backgroundColor: `${tint}1f` }]}>
      <Text variant="caption" style={{ color: readableTint(tint, scheme, 5), textTransform: 'uppercase', marginTop: 5 }}>{d.toLocaleDateString('en-US', { month: 'short' })}</Text>
      <Text variant="h3" weight="700" style={{ marginBottom: 4 }}>{d.getDate()}</Text>
    </View>
  )
}

export function SetupNote({ text = 'Invites, the shared board and the group chat turn on once it’s applied.' }: { text?: string }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <View style={s.note}>
      <DatabaseZap size={15} color={c.muted} />
      <Text variant="small" style={s.grow}><Text variant="small" weight="700">{SETUP_MESSAGE}</Text> {text}</Text>
    </View>
  )
}

export function AddToEventSheet({ open, onClose, provider }: { open: boolean; onClose: () => void; provider: Vendor | null }) {
  const s = useStyles()
  const router = useRouter()
  const { toast } = useStore()
  const events = useQuery<EventItem[]>(open ? () => listUpcomingEvents(20) : null, [open])
  const already = useQuery<Set<string>>(open && provider ? () => eventsWithCandidate(provider.id) : null, [open, provider?.id])
  const [added, setAdded] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const has = (id: string) => added.has(id) || !!already.data?.has(id)

  const add = async (ev: EventItem) => {
    if (!provider) return
    setBusy(ev.id)
    try {
      await addCandidate(ev.id, provider.id, { vertical: provider.vertical } as any)
      setAdded((x) => new Set(x).add(ev.id))
      toast(`Added ${provider.name} to ${ev.title}`)
    } catch (e) {
      console.warn(e)
      toast(eventError(e))
    } finally {
      setBusy(null)
    }
  }
  const startNew = () => {
    onClose()
    router.push({ pathname: '/events/new', params: provider ? { add: provider.id } : {} })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add to event">
      {!!provider && <Text variant="small" muted>Add {provider.name} to an event’s board. Everyone planning gets a note in the chat.</Text>}
      {events.loading && !events.data ? (
        <Loading inline />
      ) : events.error ? (
        isSetupError(events.error) ? <SetupNote /> : <Text variant="small" muted>{eventError(events.error)}</Text>
      ) : (
        <View style={s.list}>
          {(events.data || []).map((ev, i) => (
            <View key={ev.id} style={[s.row, i > 0 && s.rowLine]}>
              <EventDate ev={ev} size={40} />
              <View style={s.grow}>
                <Text variant="small" weight="700" numberOfLines={1}>{ev.title}</Text>
                <Text variant="tiny" muted numberOfLines={1}>
                  {[whenLabel(ev as any), ev.members.length > 1 && `${ev.members.length} planning`].filter(Boolean).join(' · ') || ev.typeName}
                </Text>
              </View>
              {has(ev.id) ? (
                <View style={s.added}><Check size={14} color={s.addedText.color as string} /><Text variant="small" weight="600" style={s.addedText}>Added</Text></View>
              ) : (
                <Button title={busy === ev.id ? 'Adding…' : 'Add'} size="sm" disabled={busy === ev.id} onPress={() => add(ev)} />
              )}
            </View>
          ))}
          {!events.data?.length && <Text variant="small" muted>You don’t have any upcoming events yet.</Text>}
        </View>
      )}
      <Button title={`New event${provider ? ` with ${provider.name}` : ''}`} icon={Plus} variant="ghost" block onPress={startNew} style={{ marginTop: 16 }} />
    </Sheet>
  )
}

// variant 'icon' (round button over a photo) or 'button' (a ghost button).
export function AddToEventButton({ provider, variant = 'icon' }: { provider: Vendor | null | undefined; variant?: 'icon' | 'button' }) {
  const s = useStyles()
  const { c } = useTheme()
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  if (!provider || (user && provider.profileId === user.id)) return null
  const press = () => {
    if (!user) return router.push({ pathname: '/sign-in', params: { next: pathname } })
    setOpen(true)
  }
  return (
    <>
      {variant === 'button' ? (
        <Button title="Add to event" icon={CalendarPlus} variant="ghost" grow onPress={press} />
      ) : (
        <Pressable onPress={press} hitSlop={6} style={({ pressed }) => [s.fab, pressed && { opacity: 0.8 }]} accessibilityRole="button" accessibilityLabel={`Add ${provider.name} to an event`}>
          <CalendarPlus size={16} color={c.ink} />
        </Pressable>
      )}
      <AddToEventSheet open={open} onClose={() => setOpen(false)} provider={provider} />
    </>
  )
}

const useStyles = makeStyles((t) => ({
  date: { borderRadius: t.radius.md, alignItems: 'center', overflow: 'hidden' },
  note: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: t.radius.md, backgroundColor: t.c.soft, alignItems: 'flex-start' },
  grow: { flex: 1, minWidth: 0 },
  list: { marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: t.c.line },
  added: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addedText: { color: t.c.ok },
  fab: {
    position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.c.card, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
}))
