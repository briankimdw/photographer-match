// Pieces of the Me tab (frontend/src/screens/Me.jsx): the signed-out pitch, the
// profile header (with "Edit profile"), the Hiring/Business switch and the
// client ("Hiring") view. The provider view lives in Me.tsx with the Dashboard.
import { useRouter } from 'expo-router'
import { Bookmark, Briefcase, ChevronRight, Heart, Info, Layers, MapPin, Pencil, Sparkles, Star, Store } from 'lucide-react-native'
import { useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { listProviders, withMatches } from '@shared/api/catalog.js'
import { getTasteProfile } from '@shared/api/discover.js'
import { listCollections } from '@shared/api/social.js'
import { today } from '@shared/lib/dates.js'
import { avatarUrl } from '@shared/lib/format.js'
import { nounFor, nounTitle, verticalMeta } from '@shared/verticals/index.js'
import { Avatar, Button, EmptyState, ErrorState, IdVerified, Loading, Photo, Sheet, Text, TextField, VerticalIcon } from '@/components'
import useQuery, { type QueryState } from '@/hooks/useQuery'
import { supabase } from '@/lib/supabase'
import { StatusPill } from '@/screens/bookings/parts'
import { EventsShelf } from '@/screens/events/parts'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { IMAGE_BUTTON_ROLE } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'

// Bookings that still need something from someone.
export const ACTIVE = ['requested', 'countered', 'accepted', 'confirmed', 'in_progress', 'delivered', 'disputed']
export const rating = (n: number | null | undefined) => (n == null ? null : Number(n).toFixed(1))

export function SignedOut() {
  const s = useStyles()
  const router = useRouter()
  const { data: providers } = useQuery<any[]>(listProviders, [])
  const art = (providers || []).map((p) => p.cover).filter(Boolean).slice(0, 3) as string[]
  return (
    <View style={s.signedOut}>
      {art.length === 3 && (
        <View style={s.art}>
          {art.map((src, i) => <Photo key={src} uri={src} style={[s.artImg, i === 1 && s.artMid]} />)}
        </View>
      )}
      <Text variant="h3" center>Your bookings, favorites and messages, in one place</Text>
      <Text variant="small" muted center>Sign in to request bookings, message vendors and keep your shortlist across devices.</Text>
      <Button title="Sign in or create an account" variant="accent" block onPress={() => router.push({ pathname: '/sign-in', params: { next: '/me' } })} style={s.mt} />
    </View>
  )
}

export function ProfileHero({ provider }: { provider: any }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { mode, identityStatus, myProvider, toast } = useStore()
  const { user, profile, refreshProfile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ display_name: '', city: '', bio: '' })
  const [saving, setSaving] = useState(false)
  const isProvider = mode === 'provider'

  const openEdit = () => {
    setDraft({ display_name: profile?.display_name || '', city: profile?.city || '', bio: profile?.bio || '' })
    setEditing(true)
  }
  const save = async () => {
    if (!user) return
    setSaving(true)
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: draft.display_name.trim(), city: draft.city.trim() || null, bio: draft.bio.trim() || null })
      .eq('id', user.id)
    setSaving(false)
    if (error) return toast('Couldn’t save: ' + error.message)
    await refreshProfile()
    setEditing(false)
    toast('Profile updated')
  }

  if (!profile) return null
  const name = profile.display_name || profile.username || ''
  const clientRating = rating(profile.client_rating_avg as number | null)
  const clientReviews = (profile.client_rating_count as number | null) ?? 0
  const reviewCount: number = provider?.reviewCount ?? 0

  return (
    <View style={s.hero}>
      <View style={s.row}>
        <Avatar uri={avatarUrl(profile.avatar_path, name)} name={name} size="lg" />
        <View style={s.grow}>
          <Text variant="h2" numberOfLines={2}>{name}</Text>
          <View style={s.inline}>
            <Text variant="small" muted onPress={() => router.push({ pathname: '/u/[id]', params: { id: profile.username || profile.id } })} accessibilityRole="link" accessibilityLabel="View your public profile">
              @{profile.username}
            </Text>
            {!!profile.city && (
              <>
                <Text variant="small" muted> · </Text>
                <MapPin size={12} color={c.muted} />
                <Text variant="small" muted numberOfLines={1} style={s.shrink}> {profile.city}</Text>
              </>
            )}
          </View>
          {identityStatus === 'verified' && <View style={s.mtXs}><IdVerified /></View>}
        </View>
        <Button title="Edit" icon={Pencil} size="sm" variant="ghost" onPress={openEdit} />
      </View>
      {!!profile.bio && <Text variant="small" style={s.mtSm}>{profile.bio}</Text>}

      {/* Both ratings are always visible; the one for the current role is highlighted. */}
      <View style={s.ratingPair}>
        <View style={[s.ratingCell, !isProvider && s.ratingOn]}>
          <View style={s.inline}>
            <Star size={14} color={c.star} fill={c.star} />
            <Text weight="700"> {clientRating ?? 'New'}</Text>
          </View>
          <Text variant="tiny" muted>as a client · {clientReviews} review{clientReviews === 1 ? '' : 's'}</Text>
        </View>
        {myProvider ? (
          <Pressable
            style={({ pressed }) => [s.ratingCell, isProvider && s.ratingOn, pressed && { opacity: 0.7 }]}
            onPress={() => router.push({ pathname: '/u/[id]', params: { id: myProvider.id, tab: 'reviews' } })}
            accessibilityRole="link"
            accessibilityLabel={`See the reviews on your ${nounFor(myProvider.vertical)} profile`}
          >
            <View style={s.inline}>
              <Star size={14} color={c.star} fill={c.star} />
              <Text weight="700"> {rating(provider?.rating) ?? 'New'} </Text>
              <ChevronRight size={14} color={c.muted} />
            </View>
            <Text variant="tiny" muted>as a {nounFor(myProvider.vertical)} · {reviewCount} review{reviewCount === 1 ? '' : 's'}</Text>
          </Pressable>
        ) : (
          <View style={[s.ratingCell, isProvider && s.ratingOn]}>
            <View style={s.inline}><Store size={14} color={c.ink} /><Text weight="700"> —</Text></View>
            <Text variant="tiny" muted>not taking bookings yet</Text>
          </View>
        )}
      </View>

      <Sheet open={editing} onClose={() => !saving && setEditing(false)} title="Edit profile">
        <TextField label="Name" maxLength={80} value={draft.display_name} onChangeText={(v) => setDraft({ ...draft, display_name: v })} />
        <TextField label="City" maxLength={80} value={draft.city} onChangeText={(v) => setDraft({ ...draft, city: v })} containerStyle={s.mtSm} />
        <TextField label="Bio" multiline maxLength={500} value={draft.bio} onChangeText={(v) => setDraft({ ...draft, bio: v })} style={s.textarea} containerStyle={s.mtSm} />
        <Button title={saving ? 'Saving…' : 'Save'} block disabled={saving || !draft.display_name.trim()} onPress={save} style={s.mt} />
      </Sheet>
    </View>
  )
}

// One switch for both sides of the account. Each side shows what's waiting there.
export function RoleSwitch({ myBookings, providerBookings }: { myBookings?: any[]; providerBookings?: any[] }) {
  const s = useStyles()
  const { c } = useTheme()
  const { mode, setMode, myProvider, myProviders } = useStore()
  const activeBookings = (myBookings || []).filter((b) => ACTIVE.includes(b.status)).length
  const pending = (providerBookings || []).filter((r) => r.status === 'requested').length
  const isProvider = mode === 'provider'
  const side = (on: boolean, onPress: () => void, icon: ReactNode, title: string, sub: string, badge?: number) => (
    <Pressable onPress={onPress} style={[s.role, on && s.roleOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
      {icon}
      <View style={s.grow}>
        <Text weight="700" numberOfLines={1}>{title}</Text>
        <Text variant="tiny" muted numberOfLines={1}>{sub}</Text>
      </View>
      {!!badge && <View style={s.roleDot}><Text variant="caption" style={{ color: c.onAccent }}>{badge}</Text></View>}
    </Pressable>
  )
  return (
    <View style={s.roleSwitch} accessibilityRole="tablist">
      {side(!isProvider, () => setMode('client'), <Briefcase size={18} color={c.ink} />, 'Hiring',
        myBookings ? `${activeBookings} active booking${activeBookings === 1 ? '' : 's'}` : 'Your bookings')}
      {side(isProvider, () => setMode('provider'),
        myProvider ? <VerticalIcon name={verticalMeta(myProvider.vertical).icon} size={18} /> : <Store size={18} color={c.ink} />,
        myProviders.length > 1 ? 'My business' : myProvider ? nounTitle(myProvider.vertical) : 'Vendor',
        !myProvider ? 'Start taking bookings' : pending ? `${pending} new request${pending === 1 ? '' : 's'}` : 'Your business',
        pending > 0 && !isProvider ? pending : undefined)}
    </View>
  )
}

export function StatTile({ value, label, onPress, highlight }: { value: ReactNode; label: string; onPress?: () => void; highlight?: boolean }) {
  const s = useStyles()
  const inner = (
    <>
      <Text variant="h2" color={highlight ? 'accent' : undefined}>{value}</Text>
      <Text variant="tiny" muted numberOfLines={2}>{label}</Text>
    </>
  )
  if (!onPress) return <View style={[s.tile, highlight && s.tileHi]}>{inner}</View>
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.tile, highlight && s.tileHi, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={`${value} ${label}`}>
      {inner}
    </Pressable>
  )
}

function EmptyCard({ icon: Icon, title, text, onPress }: { icon: typeof Layers; title: string; text: string; onPress: () => void }) {
  const s = useStyles()
  const { c } = useTheme()
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.emptyCard, pressed && { opacity: 0.7 }]} accessibilityRole="button">
      <Icon size={20} color={c.muted} />
      <View style={s.grow}>
        <Text variant="small" weight="700">{title}</Text>
        <Text variant="tiny" muted>{text}</Text>
      </View>
      <ChevronRight size={16} color={c.muted} />
    </Pressable>
  )
}

export function ClientView({ bookings }: { bookings: QueryState<any[]> }) {
  const s = useStyles()
  const { c } = useTheme()
  const router = useRouter()
  const { shortlist, following } = useStore()
  const { user } = useAuth()
  const { data: providers } = useQuery<any[]>(() => listProviders().then(withMatches), [user?.id])
  const collections = useQuery<any[]>(listCollections, [user?.id])
  const taste = useQuery<any>(getTasteProfile, [user?.id])
  const [openCollection, setOpenCollection] = useState<any | null>(null)

  const all = bookings.data || []
  const active = all.filter((b) => ACTIVE.includes(b.status))
  // Soonest upcoming confirmed booking, else the soonest active one.
  const upcoming = [...active].sort((a, b) => a.start - b.start)
  const next = upcoming.find((b) => b.status === 'confirmed' && b.day >= today()) || upcoming.find((b) => b.day >= today()) || upcoming[0]

  const byId = new Map((providers || []).map((p) => [p.id, p]))
  const shortlisted = [...shortlist].map((id) => byId.get(id)).filter(Boolean)
  const followed = [...following].map((id) => byId.get(id)).filter(Boolean)

  return (
    <View>
      <View style={s.tiles}>
        <StatTile value={bookings.loading ? '…' : active.length} label="Active bookings" onPress={() => router.push('/bookings')} />
        <StatTile value={shortlist.size} label="Shortlisted" onPress={() => router.push('/discover')} />
        <StatTile value={collections.data ? collections.data.length : '…'} label="Collections" />
      </View>

      {bookings.error && <ErrorState error={bookings.error} onRetry={bookings.reload} />}
      {next && (
        <>
          <Text variant="h4" style={s.section}>Next up</Text>
          <Pressable onPress={() => router.push({ pathname: '/bookings/[id]', params: { id: next.id } })} style={({ pressed }) => [s.bookingCard, pressed && { opacity: 0.8 }]} accessibilityRole="button">
            <Avatar uri={next.provider.avatar} name={next.provider.name} />
            <View style={s.grow}>
              <Text variant="small" weight="700" numberOfLines={1}>{next.packageName}</Text>
              <Text variant="tiny" muted numberOfLines={1}>{next.provider.name} · {next.date}</Text>
              <View style={s.mtXs}><StatusPill status={next.status} /></View>
            </View>
            <ChevronRight size={16} color={c.muted} />
          </Pressable>
        </>
      )}

      <EventsShelf showEmpty title="Events" />
      <Text variant="h4" style={s.section}>Shortlisted</Text>
      {shortlisted.length ? (
        <PeopleRow people={shortlisted} />
      ) : (
        <View style={s.padX}>
          <EmptyCard icon={Layers} title={providers || !shortlist.size ? 'No one shortlisted yet' : 'Loading…'} text="Swipe right in Discover on work you love." onPress={() => router.push('/discover')} />
        </View>
      )}

      <Text variant="h4" style={s.section}>Following</Text>
      {followed.length ? (
        <PeopleRow people={followed} />
      ) : (
        <View style={s.padX}>
          <EmptyCard icon={Heart} title={providers || !following.size ? 'Not following anyone yet' : 'Loading…'} text="Follow vendors to see their new work first." onPress={() => router.push('/search')} />
        </View>
      )}

      <Text variant="h4" style={s.section}>Your taste</Text>
      <View style={s.padX}>
        {taste.loading ? <Loading inline /> : taste.error ? <ErrorState error={taste.error} onRetry={taste.reload} /> : !taste.data?.styles?.length ? (
          <EmptyCard icon={Sparkles} title={taste.data?.swipes ? 'Still learning your taste' : 'We don’t know your taste yet'}
            text="Like a few photos in Discover and we’ll match you with vendors whose style fits." onPress={() => router.push('/discover')} />
        ) : (
          <View style={s.infoCard}>
            <Text variant="tiny" muted>Learned from {taste.data.swipes} swipe{taste.data.swipes === 1 ? '' : 's'} ({taste.data.likes} liked)</Text>
            {taste.data.styles.slice(0, 5).map((st: { tag: string; weight: number }) => (
              <View key={st.tag} style={s.tasteRow}>
                <Text variant="small" style={s.tasteTag} numberOfLines={1}>{st.tag}</Text>
                <View style={s.tasteBar}><View style={[s.tasteFill, { width: `${st.weight * 100}%` }]} /></View>
              </View>
            ))}
            {taste.data.corrections.length > 0 && <Text variant="tiny" muted>Hidden: {taste.data.corrections.join(', ')}</Text>}
          </View>
        )}
      </View>

      <Text variant="h4" style={s.section}>Saved collections</Text>
      <View style={s.padX}>
        {collections.loading ? <Loading inline /> : collections.error ? <ErrorState error={collections.error} onRetry={collections.reload} /> : collections.data?.length ? (
          <View style={s.grid2}>
            {collections.data.map((col) => (
              <Pressable key={col.id} style={s.collection} onPress={() => setOpenCollection(col)} accessibilityRole="button" accessibilityLabel={`Open ${col.name}, ${col.count} saved`}>
                {col.cover ? <Photo uri={col.cover} style={s.collectionImg} /> : <View style={[s.collectionImg, s.collectionEmpty]}><Bookmark size={20} color={c.muted} /></View>}
                <Text variant="small" weight="700" numberOfLines={1}>{col.name}</Text>
                <Text variant="tiny" muted>{col.count} saved</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <EmptyState compact icon={Bookmark} title="No collections yet" text="Tap the bookmark on any photo to save it here." />
        )}
      </View>

      <Sheet open={!!openCollection} onClose={() => setOpenCollection(null)} title={openCollection?.name}>
        {openCollection?.photos.length === 0 && <EmptyState compact icon={Bookmark} title="Nothing saved here yet" text="Tap the bookmark on any photo to save it here." />}
        <View style={s.collectionGrid}>
          {openCollection?.photos.map((ph: any) => (
            <Pressable
              key={ph.id}
              style={s.collectionCell}
              disabled={!(ph.providerId && ph.albumId)}
              onPress={() => {
                setOpenCollection(null)
                router.push({ pathname: '/gallery/[personId]', params: { personId: ph.providerId, post: ph.albumId, photo: ph.id } })
              }}
              accessibilityRole={IMAGE_BUTTON_ROLE}
              accessibilityLabel="Saved photo, open in the gallery"
              accessibilityState={{ disabled: !(ph.providerId && ph.albumId) }}
            >
              <Photo uri={ph.src} style={s.fill} />
            </Pressable>
          ))}
        </View>
      </Sheet>

      <View style={[s.padX, s.inline, s.mt]}>
        <Info size={12} color={c.muted} />
        <Text variant="tiny" muted> Vendors see your client rating when you send a request.</Text>
      </View>
    </View>
  )
}

function PeopleRow({ people }: { people: any[] }) {
  const s = useStyles()
  const router = useRouter()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.peopleRow}>
      {people.map((p) => (
        <Pressable key={p.id} style={s.person} onPress={() => router.push({ pathname: '/u/[id]', params: { id: p.id } })} accessibilityRole="button" accessibilityLabel={p.name}>
          <Avatar uri={p.avatar} name={p.name} size={56} />
          <Text variant="tiny" numberOfLines={1}>{p.name.split(' ')[0]}</Text>
          {p.tasteMatch != null && <Text variant="tiny" muted>{p.tasteMatch}%</Text>}
        </Pressable>
      ))}
    </ScrollView>
  )
}

const useStyles = makeStyles((t) => ({
  mt: { marginTop: t.space.lg },
  mtSm: { marginTop: t.space.sm },
  mtXs: { marginTop: t.space.xs },
  padX: { paddingHorizontal: t.space.lg },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center' },
  signedOut: { padding: t.space.lg, gap: 10, alignItems: 'center' },
  art: { flexDirection: 'row', gap: 6, marginBottom: t.space.md, alignItems: 'center' },
  artImg: { width: 92, height: 120, borderRadius: t.radius.lg },
  artMid: { height: 140 },
  hero: { paddingHorizontal: t.space.lg, paddingTop: t.space.sm },
  ratingPair: { flexDirection: 'row', gap: 8, marginTop: t.space.md },
  ratingCell: { flex: 1, padding: 10, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.line, gap: 2 },
  ratingOn: { borderColor: t.c.ink, backgroundColor: t.c.soft },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  roleSwitch: { flexDirection: 'row', gap: 6, marginHorizontal: t.space.lg, marginTop: t.space.lg, padding: 4, borderRadius: t.radius.lg, backgroundColor: t.c.soft },
  role: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: t.radius.md },
  roleOn: {
    backgroundColor: t.scheme === 'dark' ? t.c.line : '#fff',
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  roleDot: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, backgroundColor: t.c.accent, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: 8, paddingHorizontal: t.space.lg, marginTop: t.space.lg },
  tile: { flex: 1, padding: 12, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.line, gap: 2 },
  tileHi: { borderColor: t.c.accent, backgroundColor: t.c.accentSoft },
  section: { paddingHorizontal: t.space.lg, marginTop: t.space.xl, marginBottom: t.space.sm },
  bookingCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: t.space.lg, padding: 12, borderWidth: 1, borderColor: t.c.line, borderRadius: t.radius.lg },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: t.radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.c.line },
  infoCard: { padding: 12, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.line, gap: 6 },
  tasteRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tasteTag: { width: 110 },
  tasteBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: t.c.soft, overflow: 'hidden' },
  tasteFill: { height: '100%', backgroundColor: t.c.accent, borderRadius: 3 },
  grid2: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  collection: { width: '48%', gap: 2 },
  collectionImg: { width: '100%', aspectRatio: 1, borderRadius: t.radius.lg, marginBottom: 4 },
  collectionEmpty: { backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  collectionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  collectionCell: { width: '32.5%', aspectRatio: 1, borderRadius: 8, overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
  peopleRow: { paddingHorizontal: t.space.lg, gap: 14 },
  person: { alignItems: 'center', width: 64, gap: 2 },
}))
