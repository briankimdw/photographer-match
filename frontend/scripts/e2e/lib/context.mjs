// The state every section shares: who's signed in, the app's modules, the
// cleanup registry, a date allocator and a few anon lookups (fixtures).
import { addDays, toKey } from '../../../src/lib/dates.js' // the app's own date helpers (no browser APIs)
import { assert, errorText, skip } from './harness.mjs'
import { findUser, maskEmail } from './env.mjs'

// Which test user plays which part. All are throwaway logins from docs/test-users.json.
export const ROLES = {
  clientA: { username: 'jordanlee', why: 'client: books, follows, swipes, owns the [e2e] event and chats' },
  clientB: { username: 'taylorb', why: 'second client: DMs, co-planner, competing booking' },
  outsider: { username: 'kai.film', why: 'client who must NOT see anyone else\'s data (RLS)' },
  photographer: { username: 'mayachen', why: 'identity-verified photographer (capacity 1): answers requests' },
  unverified: { username: 'sofia.wild', why: 'photographer without identity verification: can\'t accept' },
  caterer: { username: 'goldenspoon', why: 'caterer (capacity > 1): posts, second listing, capacity test' },
}

/** A short id for this run, used in every [e2e] tag: base36 time + 2 random chars. */
export const makeRunId = (now = Date.now(), rand = Math.random) =>
  `${Math.floor(now / 1000).toString(36).slice(-5)}${Math.floor(rand() * 1296).toString(36).padStart(2, '0')}`

/**
 * Hands out future dates ('YYYY-MM-DD') far beyond the demo data (which stops at
 * about +250 days), shifted per run so reruns don't collide with each other.
 */
export function dateAllocator(runId, { from = new Date(), base = 320, spread = 200 } = {}) {
  let h = 0
  for (const ch of runId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  let offset = base + (h % spread)
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  return { next: () => toKey(addDays(start, offset++)), peek: () => toKey(addDays(start, offset)) }
}

export function createContext({ app, env, users, cleanup, runId, opts, log, secrets }) {
  const { shim, catalog } = app
  const sessions = new Map()
  const anonClient = shim.makeClient()
  shim.setActive(anonClient)

  const roles = Object.fromEntries(Object.entries(ROLES).map(([key, r]) => [key, { ...r, key, user: findUser(users, r.username) }]))

  const ctx = {
    app,
    env,
    users,
    roles,
    cleanup,
    runId,
    opts,
    log,
    secrets,
    state: {},
    dates: dateAllocator(runId),
    tag: (text) => `[e2e ${runId}] ${text}`,
    isTagged: (text) => typeof text === 'string' && text.includes(`[e2e ${runId}]`),

    /** Act as nobody (the publishable key only). */
    anon() {
      shim.setActive(anonClient)
      catalog.invalidate('')
      return { client: anonClient, uid: null }
    },

    /** Act as a role, signing in on first use. Returns { client, uid, user, key }. */
    async as(key) {
      if (opts.dryRun) throw new Error('dry run: no sign-in')
      let s = sessions.get(key)
      if (!s) {
        const role = roles[key]
        if (!role) throw new Error(`Unknown role ${key}`)
        const client = shim.makeClient()
        const { data, error } = await client.auth.signInWithPassword({ email: role.user.email, password: role.user.password })
        if (error || !data?.session) {
          throw new Error(`Sign-in failed for ${role.username} (${maskEmail(role.user.email)}): ${error?.message || 'no session'}. Did you create the test users (docs/test-users.md)?`)
        }
        s = { key, client, uid: data.user.id, user: role.user, username: role.username }
        sessions.set(key, s)
        log.debug?.(`signed in as ${role.username} (${maskEmail(role.user.email)})`)
      }
      shim.setActive(s.client)
      catalog.invalidate('') // per-user caches (taste matches, owner-visible listings)
      return s
    },

    /** Already signed in as this role? (never signs in) */
    session: (key) => sessions.get(key) || null,

    async signOutAll() {
      for (const s of sessions.values()) {
        try {
          await s.client.removeAllChannels()
          await s.client.auth.signOut({ scope: 'local' })
        } catch {
          /* best effort */
        }
      }
    },

    // ---- fixtures (anon-readable lookups) ------------------------------------

    /** A role's listing (by the slug in test-users.json), or null. Optionally a vertical other than their main one. */
    async listingOf(key) {
      const u = roles[key].user
      if (!u.slug) return null
      ctx.anon()
      return catalog.getProvider(u.slug)
    },

    /** Every active provider owned by a test user (so the matching vendor could log in). */
    async testProviders() {
      ctx.anon()
      const slugs = new Set(users.map((u) => u.slug).filter(Boolean))
      return (await catalog.listProviders()).filter((p) => slugs.has(p.slug))
    },

    /**
     * A package of a price type on a test user's listing: { provider, pkg }.
     * exclude: provider ids to avoid (e.g. the role vendors, so pricing bookings don't block them).
     */
    async findPackage(priceType, { exclude = [], vertical = null } = {}) {
      const providers = await ctx.testProviders()
      for (const p of providers) {
        if (exclude.includes(p.id) || (vertical && p.vertical !== vertical)) continue
        const pkg = p.packages.find((k) => k.priceType === priceType && k.isActive && (priceType === 'quote' || k.price != null))
        if (pkg) return { provider: p, pkg }
      }
      return null
    },

    /**
     * request_booking through the app's requestBooking(), trying later dates when a
     * day is taken (by demo data or a leftover booking). Registers cancel + leftover.
     * Returns { rows, dates }.
     */
    async book(key, args, { label = 'booking', tries = 6, dateCount = 1, register = true } = {}) {
      let lastErr = null
      for (let i = 0; i < tries; i++) {
        const dates = Array.from({ length: dateCount }, () => ctx.dates.next())
        await ctx.as(key)
        try {
          const rows = await app.bookings.requestBooking({ startTime: '10:00', notes: ctx.tag(label), ...args, dates })
          if (register) for (const r of rows) ctx.trackBooking(key, r.id, label)
          return { rows, dates }
        } catch (e) {
          lastErr = e
          if (!/already booked|fully booked|isn.t available|in the past/i.test(errorText(e))) throw e
        }
      }
      throw lastErr
    },

    /** Cancel at cleanup (if still active) and list the row for the leftover SQL. Returns the cleanup handle. */
    trackBooking(key, id, label = 'booking') {
      cleanup.leave('bookings', id)
      return cleanup.add('bookings', `cancel ${label} ${id.slice(0, 8)}`, async () => {
        await ctx.as(key)
        const b = await app.bookings.getBooking(id)
        if (b && ['requested', 'countered', 'accepted', 'confirmed'].includes(b.status)) await app.bookings.cancelBooking(id)
      })
    },

    need(cond, reason) {
      if (!cond) skip(reason)
    },
    assert,
  }
  return ctx
}
