// Me tab: native port of frontend/src/screens/Me.jsx. Profile header with edit,
// the Hiring / Business switch, and either the client view (bookings, shortlist,
// following, taste, collections) or the business view: listing switcher (one
// listing per vertical, "Add a service"), the get-ready checklist (identity,
// payouts, package, portfolio, service area), stat tiles and the Dashboard tabs.
// ?tab=packages|calendar|requests|portfolio opens that Dashboard tab.
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { Check, ChevronRight, CreditCard, Images, LogOut, MapPin, Package, Plus, Settings, ShieldCheck, SquarePlus, Store } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

import { listMyBookings, listProviderBookings } from '@shared/api/bookings.js'
import { getProvider, invalidate } from '@shared/api/catalog.js'
import { fromKey, today, toKey } from '@shared/lib/dates.js'
import { verticalMeta } from '@shared/verticals/index.js'
import { Button, Chip, EmptyState, IconButton, Loading, Text, VerticalIcon } from '@/components'
import useQuery, { type QueryState } from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { TOGGLE_ROLE } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'
import { ClientView, ProfileHero, RoleSwitch, SignedOut, StatTile, rating } from './account/MeParts'
import { Callout, Group, ListRow } from './account/ui'
import Dashboard, { BOOKED, type DashTab } from './provider/Dashboard'

const TABS: DashTab[] = ['requests', 'calendar', 'packages', 'portfolio']

export default function Me() {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ tab?: string }>()
  const { mode, setMode, myProvider, refreshProvider } = useStore()
  const { user, loading, refreshProfile } = useAuth()
  const uid = user?.id ?? null
  const providerId: string | null = myProvider?.id ?? null
  const scroller = useRef<ScrollView>(null)
  const tabsY = useRef(0)
  const [tab, setTab] = useState<DashTab>(() => (TABS.includes(params.tab as DashTab) ? (params.tab as DashTab) : 'requests'))
  const [pulling, setPulling] = useState(false)

  // Arriving with ?tab= (e.g. from New listing): business mode on that tab.
  // (Waits for the user: the store resets the mode while signed out.)
  useEffect(() => {
    if (uid && params.tab && TABS.includes(params.tab as DashTab)) {
      setTab(params.tab as DashTab)
      setMode('provider')
    }
  }, [params.tab, uid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Someone may have just set up a listing elsewhere: pick it up when the tab is focused.
  useFocusEffect(useCallback(() => { if (uid) refreshProvider() }, [uid, refreshProvider]))

  const myBookings = useQuery<any[]>(uid ? listMyBookings : null, [uid])
  const providerBookings = useQuery<any[]>(uid && providerId ? () => listProviderBookings(providerId) : null, [uid, providerId])
  const providerDetail = useQuery<any>(providerId ? () => getProvider(providerId) : null, [providerId])

  const refresh = async () => {
    setPulling(true)
    invalidate('providers')
    await Promise.all([refreshProvider(), refreshProfile()])
    myBookings.reload()
    providerBookings.reload()
    providerDetail.reload()
    setTimeout(() => setPulling(false), 400)
  }

  const openTab = (t: DashTab) => {
    setTab(t)
    scroller.current?.scrollTo({ y: Math.max(0, tabsY.current - 8), animated: true })
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text variant="h1">Profile</Text>
        <View style={s.inline}>
          {user && <IconButton icon={SquarePlus} label="Post photos" onPress={() => router.push('/upload')} />}
          <IconButton icon={Settings} label="Settings" onPress={() => router.push('/settings')} />
        </View>
      </View>
      {loading ? (
        <Loading />
      ) : !user ? (
        <ScrollView><SignedOut /></ScrollView>
      ) : (
        <ScrollView
          ref={scroller}
          contentContainerStyle={s.scroll}
          refreshControl={<RefreshControl refreshing={pulling} onRefresh={refresh} tintColor={c.muted} colors={[c.ink]} progressBackgroundColor={c.card} />}
        >
          <ProfileHero provider={providerDetail.data} />
          <RoleSwitch myBookings={myBookings.data} providerBookings={providerBookings.data} />
          {mode === 'provider' ? (
            <ProviderView detail={providerDetail} bookings={providerBookings} tab={tab} onTab={setTab} openTab={openTab} onTabsLayout={(y) => (tabsY.current = y)} />
          ) : (
            <ClientView bookings={myBookings} />
          )}
          <AccountLinks />
        </ScrollView>
      )}
    </SafeAreaView>
  )
}

function ProviderView({ detail, bookings, tab, onTab, openTab, onTabsLayout }: {
  detail: QueryState<any>; bookings: QueryState<any[]>; tab: DashTab; onTab: (t: DashTab) => void; openTab: (t: DashTab) => void; onTabsLayout: (y: number) => void
}) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { myProvider, identityStatus } = useStore()

  if (!myProvider) {
    return (
      <View style={s.padX}>
        <EmptyState
          icon={Store}
          title="Take bookings for your business"
          text="Photographer, caterer, DJ, venue, florist… Set up a listing with your packages and clients can find and book you."
          action={<Button title="List your services" variant="accent" onPress={() => router.push('/new-listing')} />}
        />
      </View>
    )
  }
  const visual = verticalMeta(myProvider.vertical).visual
  const list = bookings.data || []
  const pending = list.filter((r) => r.status === 'requested').length
  const monthKey = toKey(today()).slice(0, 7)
  const bookedThisMonth = new Set(list.filter((b) => BOOKED.includes(b.status) && b.dateKey.startsWith(monthKey)).map((b) => b.dateKey)).size
  const monthName = fromKey(`${monthKey}-01`).toLocaleDateString('en-US', { month: 'short' })
  const provider = detail.data
  const packageCount: number = provider?.packages?.length ?? 0
  const albumCount: number = provider?.albumCount ?? 0

  type Step = { done: boolean; label: string; sub: string; Icon: typeof Check; to?: '/verify'; tab?: DashTab; disabled?: boolean }
  const steps = ([
    { done: identityStatus === 'verified', label: 'Verify your identity', sub: 'Required to accept paid bookings', Icon: ShieldCheck, to: '/verify' },
    // Payouts (Stripe Connect) aren't built yet, so this can't be completed.
    { done: false, label: 'Set up payouts', sub: 'Coming soon: bank payouts aren’t available yet', Icon: CreditCard, disabled: true },
    { done: packageCount > 0, label: 'Add a package', sub: 'Clients book a package', Icon: Package, tab: 'packages' },
    visual && { done: albumCount > 0, label: 'Add portfolio work', sub: 'Post at least one album', Icon: Images, tab: 'portfolio' },
    { done: !!provider?.location, label: 'Set your service area', sub: 'Where you’re based and how far you travel', Icon: MapPin, tab: 'calendar' },
  ] as (Step | false)[]).filter(Boolean) as Step[]
  const doneCount = steps.filter((x) => x.done).length

  return (
    <View>
      <ListingSwitch />
      {detail.loading && !provider ? null : doneCount < steps.length ? (
        <View style={[s.padX, s.mt]}>
          <View style={s.checklist}>
            <View style={s.between}>
              <Text weight="700">Get ready to take bookings</Text>
              <Text variant="small" muted>{doneCount} of {steps.length}</Text>
            </View>
            <View style={s.progress}><View style={[s.progressFill, { width: `${(doneCount / steps.length) * 100}%` }]} /></View>
            {steps.map(({ done, label, sub, Icon, to, disabled, tab: t }) => {
              const tappable = !done && !disabled
              return (
                <Pressable
                  key={label}
                  disabled={!tappable}
                  onPress={() => (to ? router.push(to) : t && openTab(t))}
                  style={({ pressed }) => [s.checkItem, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityState={{ checked: done, disabled: !tappable }}
                >
                  <View style={[s.checkCircle, done && s.checkDone]}>
                    {done ? <Check size={14} strokeWidth={3} color={c.onAccent} /> : <Icon size={14} color={c.ink} />}
                  </View>
                  <View style={s.grow}>
                    <Text variant="small" style={done ? s.doneText : undefined}>{label}</Text>
                    {!done && <Text variant="tiny" muted>{sub}</Text>}
                  </View>
                  {tappable && <ChevronRight size={16} color={c.muted} />}
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : (
        <View style={[s.padX, s.mt]}>
          <Callout tone="live">
            <View style={s.inline}><ShieldCheck size={16} color={c.ok} /><Text weight="700"> You’re live</Text></View>
            <Text variant="small" muted>Clients can find and book you.</Text>
          </Callout>
        </View>
      )}

      <View style={s.tiles}>
        <StatTile value={bookings.loading ? '…' : pending} label="New requests" onPress={() => openTab('requests')} highlight={pending > 0} />
        <StatTile value={bookings.loading ? '…' : bookedThisMonth} label={`Booked in ${monthName}`} onPress={() => openTab('calendar')} />
        <StatTile value={rating(provider?.rating) ?? 'New'} label="Your rating" />
      </View>

      <View onLayout={(e) => onTabsLayout(e.nativeEvent.layout.y)}>
        <Dashboard tab={tab} onTabChange={onTab} provider={provider} bookings={bookings} onProviderChanged={detail.reload} />
      </View>
    </View>
  )
}

// Your listings (one per vertical): switch between them, or add another service.
function ListingSwitch() {
  const s = useStyles()
  const router = useRouter()
  const { myProvider, myProviders, selectProvider } = useStore()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.listings} accessibilityLabel="Your listings">
      {myProviders.map((p) => {
        const meta = verticalMeta(p.vertical)
        const on = p.id === myProvider?.id
        return (
          <Pressable
            key={p.id}
            onPress={() => selectProvider(p.id)}
            style={[s.listing, on && s.listingOn]}
            accessibilityRole={TOGGLE_ROLE}
            accessibilityState={{ checked: on }}
            accessibilityLabel={p.display_name}
          >
            <VerticalIcon name={meta.icon} size={13} tint={meta.tint} />
            <Text variant="small" weight="600" numberOfLines={1} style={on ? s.listingOnText : undefined}>
              {myProviders.length > 1 ? meta.name : p.display_name}
            </Text>
          </Pressable>
        )
      })}
      <Chip label="Add a service" icon={Plus} toggle onPress={() => router.push('/new-listing')} />
    </ScrollView>
  )
}

// Shortcuts at the bottom of the tab: my work, settings, sign out.
function AccountLinks() {
  const s = useStyles()
  const router = useRouter()
  const { myProvider, toast } = useStore()
  const { signOut } = useAuth()
  return (
    <View style={[s.padX, s.links]}>
      <Group>
        {myProvider && verticalMeta(myProvider.vertical).visual ? <ListRow icon={Images} title="My work" sub="Your posts: view, edit, reorder" onPress={() => router.push('/my-work')} /> : null}
        <ListRow icon={Settings} title="Settings" sub="Appearance, password, verification, privacy" onPress={() => router.push('/settings')} />
        <ListRow icon={LogOut} title="Sign out" chevron={false} onPress={async () => { await signOut(); toast('Signed out') }} />
      </Group>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: t.space.lg, paddingTop: t.space.sm, paddingBottom: t.space.xs },
  scroll: { paddingBottom: t.space.xxl },
  inline: { flexDirection: 'row', alignItems: 'center' },
  padX: { paddingHorizontal: t.space.lg },
  mt: { marginTop: t.space.md },
  grow: { flex: 1, minWidth: 0 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  checklist: { padding: 14, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.line, gap: 4 },
  progress: { height: 6, borderRadius: 3, backgroundColor: t.c.soft, overflow: 'hidden', marginVertical: 8 },
  progressFill: { height: '100%', backgroundColor: t.c.accent },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  checkCircle: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: t.c.line, alignItems: 'center', justifyContent: 'center' },
  checkDone: { backgroundColor: t.c.ok, borderColor: t.c.ok },
  doneText: { color: t.c.muted, textDecorationLine: 'line-through' },
  tiles: { flexDirection: 'row', gap: 8, paddingHorizontal: t.space.lg, marginTop: t.space.lg },
  listings: { paddingHorizontal: t.space.lg, gap: 6, marginTop: t.space.lg },
  listing: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 11, maxWidth: 220,
    borderRadius: 999, borderWidth: 1, borderColor: t.c.line, backgroundColor: t.c.bg,
  },
  listingOn: { backgroundColor: t.c.soft, borderColor: t.c.ink },
  listingOnText: { color: t.c.ink },
  links: { marginTop: t.space.xxl },
}))
