// Discover -> "For you": the SigLIP-ranked swipe deck for one vertical at a time
// (photography by default), filtered by that vertical's services. Native port of
// frontend/src/components/discover/SwipeDeck.jsx with the same data flow:
//   getFeed() in small batches (topped up as the deck runs low), logSwipe / undoSwipe,
//   getMatches() for % match, "Not into this" corrections, the session history in the store.
// The card itself (drag, fly-out, taps) is SwipeCard.tsx; the sheets are DeckSheets.tsx.
import { useRouter } from 'expo-router'
import { Bookmark, Compass, Heart, Info, RotateCcw, Sparkles, X, type LucideIcon } from 'lucide-react-native'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import { SafeAreaView } from 'react-native-safe-area-context'

import { countProvidersByVertical, getMatches } from '@shared/api/catalog.js'
import { getFeed, logSwipe, undoSwipe } from '@shared/api/discover.js'
import { deckVerticals, verticalsWithPosts } from '@shared/api/home.js'
import { startInquiry } from '@shared/api/messages.js'
import { getVertical } from '@shared/verticals/catalog.js'
import { Button, Chip, EmptyState, ErrorState, Loading } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { announce } from '@/lib/a11y'
import { makeStyles, useTheme } from '@/theme'
import { CorrectSheet, DetailsSheet, MatchOverlay, ShortlistSheet, TasteSheet } from './DeckSheets'
import { DiscoverHeader, PillButton } from './DiscoverHeader'
import { BehindCard, SwipeCard, type TapZone } from './SwipeCard'
import type { DeckCard, HistoryEntry, SwipeAction } from './types'
import { VerticalPickerChip, VerticalPickerSheet, type PickableVertical } from './VerticalPicker'

const BATCH = 20 // cards per feed request (signed in: small batches so ranking keeps up with swipes)
const BATCH_SIGNED_OUT = 50 // signed out the feed doesn't change, so take as much as it gives
const LOW_WATER = 3 // fetch more when fewer cards than this are left

type SheetName = null | 'details' | 'correct' | 'taste' | 'shortlist' | 'vertical'

export function SwipeDeck({ tabs, initialVertical = 'photography' }: { tabs: ReactNode; initialVertical?: string }) {
  const s = useStyles()
  const router = useRouter()
  const { user } = useAuth()
  const uid = user?.id ?? null
  const store = useStore()
  const { toast, corrections, addCorrections, removeCorrection, shortlist, toggleShortlist } = store
  const history = store.discoverHistory as HistoryEntry[]
  const setHistory = store.setDiscoverHistory as unknown as React.Dispatch<React.SetStateAction<HistoryEntry[]>>
  const signIn = () => router.push({ pathname: '/sign-in', params: { next: '/discover' } })

  const [vertical, setVertical] = useState(() => (getVertical(initialVertical)?.visual ? initialVertical : 'photography'))
  const [category, setCategory] = useState<string | null>(null)
  const [shot, setShot] = useState(0)
  const [tappedSides, setTappedSides] = useState(false)
  const [exit, setExit] = useState<SwipeAction | null>(null)
  const [sheet, setSheet] = useState<SheetName>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [match, setMatch] = useState<string | null>(null)
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const busy = useRef(false)
  const dragProgress = useSharedValue(0)

  useEffect(() => {
    if (initialVertical && getVertical(initialVertical)?.visual) setVertical(initialVertical)
  }, [initialVertical])

  const verticalInfo = getVertical(vertical)!
  const categories = verticalInfo.services.filter((x: { slug: string }) => x.slug !== 'meetups')
  const categoryName = categories.find((x: { slug: string }) => x.slug === category)?.name
  const feedCategory = category || vertical
  const verticalCounts = useQuery<Record<string, number>>(() => countProvidersByVertical(), [])
  const postVerticals = useQuery(() => verticalsWithPosts(), [])
  const pickable = deckVerticals(verticalCounts.data, postVerticals.data as any) as PickableVertical[]
  const matches = useQuery<Map<string, number>>(uid ? () => getMatches() : null, [uid])
  const matchOf = (providerId: string) => matches.data?.get(providerId) ?? null

  // ---- the feed ------------------------------------------------------------
  const [cards, setCards] = useState<DeckCard[]>([])
  const [feed, setFeed] = useState<{ loading: boolean; error: any; done: boolean }>({ loading: false, error: null, done: false })
  const [restartKey, setRestartKey] = useState(0)
  const generation = useRef(0)

  const seen = new Set(history.map((h) => h.id))
  const hidden = (c: DeckCard) => c.tags.some((t: string) => corrections.includes(t))
  const deck = cards.filter((c) => !seen.has(c.id) && !hidden(c))
  const card = deck[0]
  const next = deck[1]

  const latest = useRef({ cards, seen, hidden })
  latest.current = { cards, seen, hidden }

  useEffect(() => {
    generation.current++
    setCards([])
    setFeed({ loading: false, error: null, done: false })
  }, [feedCategory, uid, restartKey])

  const needMore = deck.length < LOW_WATER && !feed.loading && !feed.done && !feed.error
  useEffect(() => {
    if (!needMore) return
    const gen = generation.current
    setFeed((f) => ({ ...f, loading: true }))
    getFeed({ limit: uid ? BATCH : BATCH_SIGNED_OUT, category: feedCategory } as any).then(
      (rows: DeckCard[]) => {
        if (gen !== generation.current) return
        const { cards: have, seen: swiped, hidden: isHidden } = latest.current
        const known = new Set(have.map((c) => c.id))
        const fresh = rows.filter((c) => !known.has(c.id) && !swiped.has(c.id) && !isHidden(c))
        setCards((prev) => [...prev, ...fresh.filter((c) => !prev.some((x) => x.id === c.id))])
        setFeed({ loading: false, error: null, done: fresh.length === 0 })
      },
      (error: unknown) => {
        if (gen !== generation.current) return
        console.warn(error)
        setFeed({ loading: false, error, done: false })
      },
    )
  }, [needMore, feedCategory, uid, restartKey])

  // How long each card was on screen (a taste signal).
  const shownAt = useRef(Date.now())
  useEffect(() => {
    shownAt.current = Date.now()
    dragProgress.value = 0
  }, [card?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const pendingSwipes = useRef(new Map<string, Promise<string | null>>())
  const swipeIds = useRef(new Map<string, string | null>())
  const likes = history.filter((h) => h.action === 'like' || h.action === 'save')
  const likedCardsFrom = (providerId: string) => likes.filter((h) => h.providerId === providerId).map((h) => h.card).filter(Boolean)

  // A swipe begins (button or drag past the threshold): lock the deck, close sheets.
  const begin = (action: SwipeAction) => {
    if (!card || busy.current) return false
    busy.current = true
    setSheet(null)
    setExit(action)
    announce(action === 'like' ? `Liked ${card.provider.name}` : action === 'save' ? `Shortlisted ${card.provider.name}` : 'Passed')
    return true
  }

  // The card has left the screen: record the swipe and move on.
  const commit = (action: SwipeAction) => {
    const c = card
    if (!c) return
    const liked = action === 'like' || action === 'save'
    const likedFromAuthor = likes.filter((h) => h.providerId === c.authorId).length + (liked ? 1 : 0)

    let addedToShortlist = false
    if (action === 'save' && uid && !shortlist.has(c.authorId)) addedToShortlist = toggleShortlist(c.authorId)

    const promise: Promise<string | null> = logSwipe(c, action, { dwellMs: Date.now() - shownAt.current, position: history.length } as any)
      .then((swipeId: string | null) => {
        swipeIds.current.set(c.id, swipeId)
        if (swipeId) setHistory((h) => h.map((e) => (e.id === c.id ? { ...e, swipeId } : e)))
        if (uid && liked) matches.reload()
        return swipeId
      })
      .catch((e: unknown) => {
        console.warn(e)
        toast('Couldn’t save that swipe')
        return null
      })
    pendingSwipes.current.set(c.id, promise)

    setHistory((h) => [...h, { id: c.id, action, swipeId: swipeIds.current.get(c.id) ?? null, providerId: c.authorId, card: c, addedToShortlist }])
    setExit(null)
    setShot(0)
    busy.current = false
    if (liked && likedFromAuthor === 2 && !matched.has(c.authorId)) {
      setMatched(new Set([...matched, c.authorId]))
      setMatch(c.authorId)
    }
  }

  const decide = (action: SwipeAction) => {
    begin(action)
  }

  const undo = async () => {
    const last = history[history.length - 1]
    if (!last || busy.current) return
    setHistory(history.slice(0, -1))
    if (last.card && !cards.some((c) => c.id === last.id)) setCards((prev) => [last.card, ...prev])
    setShot(0)
    if (last.addedToShortlist && shortlist.has(last.providerId)) toggleShortlist(last.providerId)
    try {
      const swipeId = last.swipeId ?? (await pendingSwipes.current.get(last.id))
      if (swipeId) {
        await undoSwipe(swipeId)
        if (uid) matches.reload()
      }
    } catch (e) {
      console.warn(e)
      toast('Couldn’t undo that swipe')
    }
  }

  const onTap = (zone: TapZone) => {
    if (!card) return
    if (zone === 'prev') {
      setShot((x) => Math.max(0, x - 1))
      setTappedSides(true)
    } else if (zone === 'next') {
      setShot((x) => (x + 1) % card.photos.length)
      setTappedSides(true)
    } else if (zone === 'correct') setSheet('correct')
    else if (zone === 'profile') router.push(`/u/${card.provider.id}`)
    else setSheet('details')
  }

  const submitCorrection = () => {
    if (!uid) return
    addCorrections([...picked])
    toast(`Got it. You’ll see less ${[...picked].join(', ')}.`)
    setSheet(null)
    setPicked(new Set())
    setShot(0)
    setTimeout(() => setRestartKey((k) => k + 1), 600)
  }

  const message = (providerId: string) => {
    if (!uid) return signIn()
    setSheet(null)
    startInquiry(providerId)
      .then((conversationId: string) => router.push(`/inbox/${conversationId}`))
      .catch((e: unknown) => {
        console.warn(e)
        toast('Couldn’t start a conversation. Try again.')
      })
  }

  const startOver = () => {
    if (!uid) setHistory([])
    setRestartKey((k) => k + 1)
  }
  const pickCategory = (slug: string | null) => {
    setCategory(slug)
    setShot(0)
  }
  const pickVertical = (slug: string) => {
    setSheet(null)
    if (slug === vertical) return
    setVertical(slug)
    setCategory(null)
    setShot(0)
  }

  const cardMatch = card ? matchOf(card.provider.id) : null
  const matchProvider = match ? cards.find((c) => c.authorId === match)?.provider || likedCardsFrom(match)[0]?.provider : null

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <DiscoverHeader
        tabs={tabs}
        right={
          <>
            <PillButton icon={Sparkles} label="Your taste" onPress={() => setSheet('taste')} />
            <PillButton icon={Heart} label={`Shortlist, ${shortlist.size}`} text={String(shortlist.size)} onPress={() => setSheet('shortlist')} />
          </>
        }
      />

      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          <VerticalPickerChip vertical={verticalInfo} onPress={() => setSheet('vertical')} />
          <View style={s.divider} />
          <Chip label="All styles" toggle on={!category} onPress={() => pickCategory(null)} style={s.chip} />
          {categories.map((x: { slug: string; name: string }) => (
            <Chip key={x.slug} label={x.name} toggle on={category === x.slug} onPress={() => pickCategory(x.slug)} style={s.chip} />
          ))}
        </ScrollView>
      </View>

      <View style={s.deck}>
        {!card && (feed.error ? (
          <ErrorState error={feed.error} onRetry={() => setFeed((f) => ({ ...f, error: null }))} />
        ) : !feed.done ? (
          <Loading label="Finding photos for you…" />
        ) : (
          <EmptyState
            icon={Compass}
            title={`You’ve seen everything${categoryName ? ` in ${categoryName}` : ''}`}
            text={
              uid
                ? `New work shows up here as ${verticalInfo.plural.toLowerCase()} post. Check your shortlist, or try another style.`
                : 'Try another style, or start over. Sign in to save what you like and get matched.'
            }
            action={
              <View style={s.emptyActions}>
                {shortlist.size > 0 && <Button title={`See shortlist (${shortlist.size})`} size="sm" onPress={() => setSheet('shortlist')} />}
                {!!category && <Button title="All styles" variant="ghost" size="sm" onPress={() => pickCategory(null)} />}
                <Button title={uid ? 'Check again' : 'Start over'} variant="ghost" size="sm" onPress={startOver} />
              </View>
            }
          />
        ))}
        {next && <BehindCard key={`b-${next.id}`} card={next} progress={dragProgress} />}
        {card && (
          <SwipeCard
            key={card.id}
            card={card}
            shot={Math.min(shot, card.photos.length - 1)}
            showHint={!tappedSides}
            match={cardMatch}
            exit={exit}
            onTap={onTap}
            onSwipeStart={(a) => begin(a)}
            onSwiped={commit}
            progress={dragProgress}
            onAction={decide}
            focusOnMount={history.length > 0}
          />
        )}
      </View>

      <View style={s.actions}>
        <RoundButton icon={RotateCcw} label="Undo" size="small" onPress={undo} disabled={!history.length || !!exit} />
        <RoundButton icon={X} label="Pass" color="#ef4444" onPress={() => decide('pass')} disabled={!card} />
        <RoundButton icon={Bookmark} label="Shortlist" size="mid" color="#3b82f6" onPress={() => decide('save')} disabled={!card} />
        <RoundButton icon={Heart} label="Like" color="#16a34a" onPress={() => decide('like')} disabled={!card} />
        <RoundButton icon={Info} label="Details" size="small" onPress={() => setSheet('details')} disabled={!card} />
      </View>

      <DetailsSheet card={card ?? null} shot={shot} match={cardMatch} open={sheet === 'details'} onClose={() => setSheet(null)} onMessage={message} />
      <VerticalPickerSheet
        open={sheet === 'vertical'}
        onClose={() => setSheet(null)}
        verticals={pickable}
        loading={verticalCounts.loading && !verticalCounts.data}
        value={vertical}
        onPick={pickVertical}
      />
      <CorrectSheet
        open={sheet === 'correct'}
        onClose={() => setSheet(null)}
        signedIn={!!uid}
        tags={card?.tags || []}
        picked={picked}
        onToggle={(t) => {
          const n = new Set(picked)
          if (n.has(t)) n.delete(t)
          else n.add(t)
          setPicked(n)
        }}
        onSubmit={submitCorrection}
        onSignIn={() => { setSheet(null); signIn() }}
      />
      <TasteSheet open={sheet === 'taste'} onClose={() => setSheet(null)} uid={uid} corrections={corrections} removeCorrection={removeCorrection} onSignIn={() => { setSheet(null); signIn() }} />
      <ShortlistSheet
        open={sheet === 'shortlist'}
        onClose={() => setSheet(null)}
        uid={uid}
        shortlist={shortlist}
        likedCardsFrom={likedCardsFrom}
        matchOf={matchOf}
        onMessage={message}
        onRemove={toggleShortlist}
        onSignIn={() => { setSheet(null); signIn() }}
      />
      {match && (
        <MatchOverlay
          provider={matchProvider}
          cards={likedCardsFrom(match)}
          tasteMatch={matchOf(match)}
          signedIn={!!uid}
          shortlisted={shortlist.has(match)}
          onShortlist={() => toggleShortlist(match)}
          onClose={() => setMatch(null)}
          onMessage={() => { setMatch(null); message(match) }}
          onSignIn={() => { setMatch(null); signIn() }}
        />
      )}
    </SafeAreaView>
  )
}

function RoundButton({ icon: Icon, label, onPress, disabled, color, size = 'big' }: {
  icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean; color?: string; size?: 'big' | 'mid' | 'small'
}) {
  const s = useStyles()
  const { c } = useTheme()
  const px = size === 'big' ? 56 : size === 'mid' ? 46 : 40
  const icon = size === 'big' ? 28 : size === 'mid' ? 22 : 18
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={Math.max(0, (48 - px) / 2)}
      style={({ pressed }) => [s.round, { width: px, height: px, borderRadius: px / 2 }, disabled && s.disabled, pressed && s.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Icon size={icon} color={color ?? c.muted} strokeWidth={size === 'big' ? 2.4 : 2} />
    </Pressable>
  )
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.c.bg },
  chips: { flexDirection: 'row', gap: 6, paddingHorizontal: t.space.lg, paddingVertical: 4, alignItems: 'center' },
  chip: { minHeight: 34, justifyContent: 'center' },
  divider: { width: 1, alignSelf: 'stretch', marginVertical: 6, marginHorizontal: 2, backgroundColor: t.c.line },
  deck: { flex: 1, marginHorizontal: 16, marginTop: 12, justifyContent: 'center' },
  emptyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingTop: 14, paddingBottom: 12 },
  round: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: t.scheme === 'dark' ? t.c.card : '#fff',
    shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 4,
    borderWidth: t.scheme === 'dark' ? 1 : 0, borderColor: t.c.line,
  },
  disabled: { opacity: 0.4 },
  pressed: { transform: [{ scale: 0.92 }] },
}))
