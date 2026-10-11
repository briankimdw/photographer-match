// AI event planner: native version of frontend/src/screens/Planner.jsx (+ components/planner/*).
// A chat with the planner service (services/ml, POST /plan via the shared api/planner.js):
// describe the event, get a brief ("What I understood", editable chips), a budget split,
// per-category vendor recommendations, and "Save as event" (api/events.js).
// /plan?q=... (from Home's planner card) sends that message once on open.
// The service needs a signed-in user (401 otherwise): signed out shows a sign-in prompt.
// TODO(port): the web's dev-only ?mock=1 fixture mode is off natively (DEV=false in the env shim).
import { listProviders } from '@shared/api/catalog.js'
import { createEvent, listMyEvents, titleFor, updateEvent } from '@shared/api/events.js'
import { planEvent, plannerHealth } from '@shared/api/planner.js'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  BookmarkCheck, BookmarkPlus, Cake, CalendarHeart, Clock, FolderOpen, GraduationCap, Heart, MessageCircleQuestion, PlugZap, SquarePen, UserPlus, UserSquare,
  type LucideIcon,
} from 'lucide-react-native'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { Button, IconButton, KeyboardView, Loading, Screen, Sheet, SignInPrompt, Text } from '@/components'
import useQuery from '@/hooks/useQuery'
import { useAuth } from '@/state/auth'
import { useStore } from '@/state/store'
import { SharePlanButton } from '@/components/share/SharePlanButton'
import { makeStyles, useTheme } from '@/theme'
import type { Provider } from '@/types'
import { AiMark } from './AiMark'
import BriefChips from './BriefChips'
import BudgetBreakdown, { type BudgetLine } from './BudgetBreakdown'
import Composer from './Composer'
import MyEvents, { type SavedEvent } from './MyEvents'
import PlanError, { type PlanErr } from './PlanError'
import PlanningState from './PlanningState'
import Recommendations, { type PlanRec } from './Recommendations'
import { followUpFor, type Brief } from './brief'

type Plan = {
  engine: string | null
  reply: string
  brief: Brief | null
  questions: string[]
  budget: BudgetLine[]
  recommendations: PlanRec[]
  coming_soon: { category?: string; label: string }[]
}
type Turn = { id: number; role: 'user' | 'assistant' | 'note'; text: string; plan?: Plan; failed?: boolean }
type SendOpts = { previous?: Brief | null; note?: string | null; syncSaved?: boolean; fresh?: boolean }

const INTRO = 'Tell me the occasion, dates, place and budget. I’ll draft a budget and find vendors who are free and fit. You approve every booking.'

// Example prompts on the empty screen (dates computed so they're always ahead).
function examples(): { icon: LucideIcon; text: string }[] {
  const now = new Date()
  const juneYear = now.getMonth() >= 5 ? now.getFullYear() + 1 : now.getFullYear()
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'long' })
  return [
    { icon: Heart, text: `A wedding in Napa, June 11–13 ${juneYear}, about $15k all in, 120 guests` },
    { icon: GraduationCap, text: `Grad photos at UCLA the first week of June ${juneYear}, under $400` },
    { icon: UserSquare, text: `Team headshots for 12 people at our SF office in ${next}, $1,500` },
    { icon: Cake, text: 'A backyard birthday for 40 in Pasadena next month, with catering and a DJ, $3,000' },
  ]
}

let turnId = 0
const nextId = () => ++turnId

export default function Planner() {
  const s = useStyles()
  const { user, loading } = useAuth()
  if (loading) return <Screen title="Plan with AI" back><Loading /></Screen>
  if (!user) {
    return (
      <Screen title="Plan with AI" back>
        <View style={s.intro}>
          <AiMark size={56} />
          <Text variant="h1" style={s.introTitle}>Plan your event in a sentence</Text>
          <Text variant="small" muted style={s.introText}>{INTRO}</Text>
        </View>
        <SignInPrompt title="Sign in to plan with AI" text="Plans are saved to your account so you can come back to them." />
      </Screen>
    )
  }
  return <PlannerChat userId={user.id} />
}

function PlannerChat({ userId }: { userId: string }) {
  const s = useStyles()
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ q?: string }>()
  const { toast } = useStore()

  const [turns, setTurns] = useState<Turn[]>([])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [pending, setPending] = useState<{ refining: boolean } | null>(null)
  const [error, setError] = useState<PlanErr | null>(null)
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: string; briefJson: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [eventsOpen, setEventsOpen] = useState(false)
  const [health, setHealth] = useState<{ ok: boolean; claude?: boolean } | null | undefined>(undefined)
  const abortRef = useRef<AbortController | null>(null)
  const lastReq = useRef<{ message: string; opts: SendOpts } | null>(null)
  const scrollRef = useRef<ScrollView>(null)
  const anchorY = useRef(0)

  const providers = useQuery<Provider[]>(() => listProviders() as Promise<Provider[]>, [])
  const providerMap = useMemo(() => new Map((providers.data || []).map((p) => [p.id, p])), [providers.data])
  const events = useQuery<SavedEvent[]>(() => listMyEvents(), [userId])

  useEffect(() => {
    let live = true
    plannerHealth().then((h: any) => live && setHealth(h))
    return () => {
      live = false
      abortRef.current?.abort()
    }
  }, [])

  // Keep the newest thing the user did in view: right after sending, the end (the
  // thinking state); once the plan arrives, the user's message at the top.
  useEffect(() => {
    if (!turns.length) return
    const t = setTimeout(() => {
      if (pending) scrollRef.current?.scrollToEnd({ animated: true })
      else scrollRef.current?.scrollTo({ y: Math.max(0, anchorY.current - 12), animated: true })
    }, 80)
    return () => clearTimeout(t)
  }, [turns.length, !!pending, !!error])

  async function send(message: string, { previous = plan?.brief ?? null, note = null, syncSaved = false, fresh = false }: SendOpts = {}) {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    lastReq.current = { message, opts: { previous, note, syncSaved, fresh } }

    const history = fresh ? [] : turns.filter((t) => t.role !== 'note' && !t.failed).slice(-12).map(({ role, text }) => ({ role, text }))
    if (replyTo && !fresh) history.push({ role: 'assistant', text: replyTo })
    setTurns((ts) => [...ts, note ? { id: nextId(), role: 'note', text: note } : { id: nextId(), role: 'user', text: message }])
    setDraft('')
    setReplyTo(null)
    setError(null)
    setPending({ refining: !!previous })
    try {
      const result = (await planEvent({ message, previous, history, signal: ctrl.signal } as any)) as Plan
      if (ctrl.signal.aborted) return
      const next = { ...result, brief: result.brief ?? previous }
      setPlan(next)
      setTurns((ts) => [...ts, { id: nextId(), role: 'assistant', text: next.reply, plan: next }])
      if (syncSaved && next.brief) setSaved((x) => (x ? { ...x, briefJson: JSON.stringify(next.brief) } : x))
    } catch (err: any) {
      if (err?.name === 'AbortError' || ctrl.signal.aborted) return
      console.warn(err)
      setError(err)
      setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 && t.role !== 'assistant' ? { ...t, failed: true } : t)))
    } finally {
      if (abortRef.current === ctrl) setPending(null)
    }
  }

  const retry = () => {
    const req = lastReq.current
    if (!req) return
    setTurns((ts) => (ts[ts.length - 1]?.failed ? ts.slice(0, -1) : ts))
    send(req.message, req.opts)
  }

  // Open with a message from Home (/plan?q=...), once.
  const startedFromQuery = useRef(false)
  useEffect(() => {
    const q = typeof params.q === 'string' ? params.q.trim() : ''
    if (!q || startedFromQuery.current) return
    startedFromQuery.current = true
    router.setParams({ q: undefined })
    send(q, { previous: null, fresh: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editField = (field: string, brief: Brief) => send(followUpFor(field, brief), { previous: brief })

  const reset = () => {
    abortRef.current?.abort()
    setTurns([])
    setPlan(null)
    setPending(null)
    setError(null)
    setSaved(null)
    setReplyTo(null)
    setDraft('')
  }

  const openEvent = (ev: SavedEvent) => {
    setEventsOpen(false)
    reset()
    setSaved({ id: ev.id, briefJson: JSON.stringify(ev.brief) })
    send('Show me the plan for this event.', { previous: ev.brief as Brief, note: `Opened “${ev.title}”`, syncSaved: true, fresh: true })
  }

  const brief = plan?.brief ?? null
  const dirty = !!saved && !!brief && JSON.stringify(brief) !== saved.briefJson
  async function save() {
    if (!brief || saving) return
    setSaving(true)
    try {
      const ev = saved ? await updateEvent(saved.id, { brief } as any) : await createEvent(brief as any)
      setSaved({ id: ev.id, briefJson: JSON.stringify(brief) })
      events.reload()
      toast(saved ? 'Saved your changes' : 'Saved to My events')
    } catch (err) {
      console.warn(err)
      toast('Couldn’t save this plan. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const started = turns.length > 0
  const lastAssistant = [...turns].reverse().find((t) => t.role === 'assistant')
  const anchorIndex = turns.reduce((last, t, i) => (t.role === 'assistant' ? last : i), -1)

  const right = (
    <>
      {started && <IconButton icon={SquarePen} size={19} label="New plan" onPress={reset} />}
      <IconButton icon={FolderOpen} size={19} label="My events" onPress={() => setEventsOpen(true)} />
    </>
  )

  return (
    <Screen title="Plan with AI" subtitle={brief ? titleFor(brief as any) : undefined} back right={right} scroll={false} edges={['top']}>
      {/* KeyboardView, not KeyboardAvoidingView: on Android edge-to-edge (SDK 57) the window
          doesn't resize for the keyboard, so behavior={undefined} left the composer under it. */}
      <KeyboardView style={s.flex}>
        {!started ? (
          <ScrollView contentContainerStyle={[s.intro, { paddingBottom: insets.bottom + 28 }]} keyboardShouldPersistTaps="handled">
            <AiMark size={56} />
            <Text variant="h1" style={s.introTitle}>What are you planning?</Text>
            <Text variant="small" muted style={s.introText}>{INTRO}</Text>
            <Composer hero value={draft} onChange={setDraft} onSubmit={(text) => send(text, { previous: null, fresh: true })} placeholder="Describe your event…" />
            {health === null && (
              <View style={[s.note, s.mtSm]}>
                <PlugZap size={14} color={c.muted} />
                <Text variant="small" style={s.noteText}>
                  The planner isn’t running{__DEV__ ? '. Start services/ml on port 8000 and set EXPO_PUBLIC_PLANNER_URL to your computer’s LAN address.' : '.'}
                </Text>
              </View>
            )}

            <Text variant="label" style={s.sectionLabel}>Try one of these</Text>
            <View style={s.examples}>
              {examples().map(({ icon: Icon, text }) => (
                <Pressable
                  key={text}
                  onPress={() => send(text, { previous: null, fresh: true })}
                  style={({ pressed }) => [s.example, pressed && { backgroundColor: c.soft }]}
                  accessibilityRole="button"
                >
                  <Icon size={16} color={c.accent} style={s.exampleIcon} />
                  <Text variant="small" style={s.grow}>{text}</Text>
                </Pressable>
              ))}
            </View>

            <Text variant="label" style={s.sectionLabel}>My events</Text>
            <MyEvents query={events} onOpen={openEvent} />
            {!!health && <EngineTag engine={health.claude ? 'claude' : 'rules'} center />}
          </ScrollView>
        ) : (
          <>
            <ScrollView ref={scrollRef} style={s.flex} contentContainerStyle={s.thread} keyboardShouldPersistTaps="handled">
              {turns.map((t, i) => {
                const onLayout = i === anchorIndex ? (e: any) => { anchorY.current = e.nativeEvent.layout.y } : undefined
                if (t.role === 'note') {
                  return (
                    <View key={t.id} onLayout={onLayout} style={s.divider}>
                      <View style={s.dividerLine} />
                      <Text variant="tiny" muted>{t.text}</Text>
                      <View style={s.dividerLine} />
                    </View>
                  )
                }
                if (t.role === 'user') {
                  return (
                    <View key={t.id} onLayout={onLayout} style={[s.msg, s.msgUser, t.failed && s.msgFailed]}>
                      <Text variant="body" style={{ color: c.onInk }}>{t.text}</Text>
                      {t.failed && <Text style={s.failedText}>Not sent</Text>}
                    </View>
                  )
                }
                if (t === lastAssistant && t.plan) {
                  return (
                    <PlanResult
                      key={t.id}
                      plan={t.plan}
                      busy={!!pending}
                      providers={providerMap}
                      providersLoading={providers.loading && !providers.data}
                      onEdit={editField}
                      onAnswer={setReplyTo}
                      save={{ onSave: save, saving, saved: !!saved, dirty, eventId: saved?.id }}
                    />
                  )
                }
                return (
                  <View key={t.id} style={[s.msg, s.msgAi]}>
                    <Text variant="body">{t.text || 'Updated the plan.'}</Text>
                  </View>
                )
              })}
              {pending && <PlanningState refining={pending.refining} />}
              {error && <PlanError error={error} onRetry={retry} />}
            </ScrollView>
            <View style={[s.dock, { paddingBottom: Math.max(insets.bottom, 12) }]}>
              <Composer
                value={draft}
                onChange={setDraft}
                onSubmit={(text) => send(text)}
                busy={!!pending}
                replyTo={replyTo}
                onClearReply={() => setReplyTo(null)}
                placeholder={replyTo ? 'Your answer…' : brief ? 'Refine it: “make it cheaper”, “what about July?”' : 'Describe your event…'}
              />
            </View>
          </>
        )}
      </KeyboardView>

      <Sheet open={eventsOpen} onClose={() => setEventsOpen(false)} title="My events">
        {started && (
          <Button title="Start a new plan" icon={SquarePen} variant="ghost" block onPress={() => { reset(); setEventsOpen(false) }} />
        )}
        <View style={s.mtSm}>
          <MyEvents query={events} onOpen={openEvent} activeId={saved?.id} />
        </View>
      </Sheet>
    </Screen>
  )
}

type ResultProps = {
  plan: Plan
  busy: boolean
  providers: Map<string, Provider>
  providersLoading: boolean
  onEdit: (field: string, brief: Brief) => void
  onAnswer: (q: string) => void
  save: { onSave: () => void; saving: boolean; saved: boolean; dirty: boolean; eventId?: string | null }
}

function PlanResult({ plan, busy, providers, providersLoading, onEdit, onAnswer, save }: ResultProps) {
  const router = useRouter()
  const s = useStyles()
  const { c } = useTheme()
  const { brief, questions, budget, recommendations, coming_soon: comingSoon } = plan
  return (
    <View style={s.result}>
      <View style={s.reply}>
        <AiMark />
        <View style={s.grow}>
          <Text variant="body" style={s.replyText}>{plan.reply || 'Here’s what I put together.'}</Text>
          <EngineTag engine={plan.engine} />
        </View>
      </View>

      <BriefChips brief={brief} onEdit={onEdit} disabled={busy} />

      {questions.length > 0 && (
        <View>
          <Text variant="label" style={s.label}>To sharpen the plan</Text>
          <View style={s.chips}>
            {questions.map((q) => (
              <Pressable
                key={q}
                onPress={() => onAnswer(q)}
                disabled={busy}
                style={({ pressed }) => [s.question, busy && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.97 }] }]}
                accessibilityRole="button"
                accessibilityLabel={`Answer: ${q}`}
              >
                <MessageCircleQuestion size={14} color={s.questionText.color as string} />
                <Text variant="small" style={[s.questionText, s.shrink]}>{q}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <BudgetBreakdown budget={budget} total={brief?.budget_total_cents} />

      {providersLoading ? (
        <Loading inline label="Loading vendors…" />
      ) : (
        <Recommendations recommendations={recommendations} providers={providers} brief={brief} />
      )}

      {comingSoon.length > 0 && (
        <View style={s.soon}>
          <Clock size={16} color={c.muted} />
          <View style={s.grow}>
            <Text variant="small" weight="700">Not bookable here yet: {comingSoon.map((x) => x.label).join(', ')}</Text>
            <Text variant="tiny" muted>Their share stays in the budget so the numbers add up. Know someone great? Invite them from Search.</Text>
          </View>
        </View>
      )}

      {!!brief && (
        <View style={s.save}>
          {save.saved && !save.dirty ? (
            <View style={s.saved}>
              <BookmarkCheck size={16} color={c.ok} />
              <Text variant="body" weight="600" style={{ color: c.ok }}>Saved to My events</Text>
              <SharePlanButton eventId={save.eventId} title={titleFor(brief as any)} subtitle="Event plan" />
            </View>
          ) : null}
          {save.saved && !save.dirty ? (
            !!save.eventId && (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Button title="Invite friends" icon={UserPlus} grow onPress={() => router.push({ pathname: '/events/[id]', params: { id: save.eventId!, invite: '1' } })} />
                <Button title="Open event" icon={CalendarHeart} variant="ghost" grow onPress={() => router.push({ pathname: '/events/[id]', params: { id: save.eventId! } })} />
              </View>
            )
          ) : (
            <Button
              title={save.saving ? 'Saving…' : save.saved ? 'Save changes to this event' : 'Save as event'}
              icon={BookmarkPlus}
              block
              disabled={save.saving || busy}
              onPress={save.onSave}
            />
          )}
          <Text variant="tiny" muted center style={s.fineprint}>The planner only drafts. Nothing is booked until you send a request and the vendor accepts.</Text>
        </View>
      )}
    </View>
  )
}

// Which engine answered (small dev aid, as on the web).
function EngineTag({ engine, center }: { engine: string | null; center?: boolean }) {
  const s = useStyles()
  if (!engine) return null
  return (
    <View style={[s.engine, center && s.engineCenter]}>
      <View style={[s.engineDot, engine === 'claude' && { backgroundColor: '#d97757' }]} />
      <Text style={s.engineText}>{engine === 'claude' ? 'Claude' : 'Rules engine'}</Text>
    </View>
  )
}

const useStyles = makeStyles((t) => {
  const dark = t.scheme === 'dark'
  return {
    flex: { flex: 1 },
    grow: { flex: 1, minWidth: 0 },
    shrink: { flexShrink: 1 },
    mtSm: { marginTop: 8 },
    intro: { paddingHorizontal: t.space.lg, paddingTop: 22, paddingBottom: 28 },
    introTitle: { marginTop: 14 },
    introText: { marginTop: 6, marginBottom: 16, lineHeight: 19 },
    note: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: t.radius.md, backgroundColor: t.c.soft },
    noteText: { flex: 1, fontSize: 12.5, color: dark ? t.c.muted : '#444' },
    sectionLabel: { marginTop: 24, marginBottom: 8 },
    label: { marginBottom: 8 },
    examples: { gap: 8 },
    example: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1, borderColor: t.c.line, borderRadius: 14 },
    exampleIcon: { marginTop: 1 },
    thread: { paddingHorizontal: t.space.lg, paddingTop: 16, paddingBottom: 16, gap: 14 },
    msg: { maxWidth: '85%', paddingVertical: 9, paddingHorizontal: 13, borderRadius: 18 },
    msgUser: { alignSelf: 'flex-end', backgroundColor: t.c.ink, borderBottomRightRadius: 6 },
    msgFailed: { opacity: 0.75 },
    failedText: { marginTop: 2, fontSize: 10.5, color: '#fca5a5', textAlign: 'right' },
    msgAi: { alignSelf: 'flex-start', backgroundColor: t.c.soft, borderBottomLeftRadius: 6 },
    divider: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dividerLine: { flex: 1, height: 1, backgroundColor: t.c.line },
    dock: { paddingHorizontal: 12, paddingTop: 8, backgroundColor: t.c.bg, borderTopWidth: 1, borderTopColor: t.c.line },
    result: { gap: 16 },
    reply: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
    replyText: { fontSize: 14.5, lineHeight: 21, paddingTop: 4 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    question: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: t.c.accentSoft, maxWidth: '100%' },
    questionText: { color: dark ? '#ffb39e' : '#b13a1c' },
    soon: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 16, backgroundColor: t.c.soft },
    save: { gap: 8, paddingBottom: 4 },
    saved: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, padding: 11, borderRadius: 12, backgroundColor: dark ? '#0f2e1a' : '#ecfdf3' },
    fineprint: { paddingHorizontal: 12 },
    engine: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8 },
    engineCenter: { justifyContent: 'center', marginTop: 24 },
    engineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#c4c4c4' },
    engineText: { fontSize: 10.5, color: '#a3a3a3', letterSpacing: 0.2 },
  }
})
