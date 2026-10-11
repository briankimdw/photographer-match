// Everything the test creates is registered here as it's made, then undone at the
// end (or on failure / Ctrl+C) in a safe order:
//
//   bookings (cancel)  ->  events (delete; chats + board cascade)  ->  chats (leave groups)
//   ->  content (posts + storage, packages)  ->  social (follows, shortlist, swipes)  ->  listing (hide)
//
// Within a phase, the newest task runs first (like unwinding a stack).
//
// Some rows can't be deleted through the API at all (Row-Level Security has no
// delete rule for bookings, messages, conversations or listings). Those are recorded
// as "leftovers" and written to a SQL file with their exact ids, which the user may
// paste into the Supabase SQL editor; nothing else is ever touched by it.

export const PHASES = { bookings: 10, events: 20, chats: 30, content: 40, social: 50, listing: 60 }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class Cleanup {
  constructor() {
    this.tasks = []
    this.seq = 0
    this.leftovers = { messages: new Set(), conversations: new Set(), bookings: new Set(), providers: new Set() }
    this.ratingsTouched = { providers: new Set(), profiles: new Set() }
  }

  /** Register an undo. phase: a PHASES key. Returns { cancel() } for when the test already undid it. */
  add(phase, label, fn) {
    if (!(phase in PHASES)) throw new Error(`Unknown cleanup phase "${phase}"`)
    const task = { phase, order: PHASES[phase], label, fn, seq: this.seq++, cancelled: false }
    this.tasks.push(task)
    return { cancel: () => (task.cancelled = true) }
  }

  /** Remember a row the API can't delete (kind: messages | conversations | bookings | providers). */
  leave(kind, id) {
    if (!(kind in this.leftovers)) throw new Error(`Unknown leftover kind "${kind}"`)
    if (!UUID.test(String(id))) throw new Error(`Not a uuid: ${id}`)
    this.leftovers[kind].add(String(id))
  }

  /** Reviews were written for these: recompute their ratings when the bookings are purged. */
  touchRatings({ providerId = null, profileId = null } = {}) {
    if (providerId && UUID.test(providerId)) this.ratingsTouched.providers.add(providerId)
    if (profileId && UUID.test(profileId)) this.ratingsTouched.profiles.add(profileId)
  }

  /** Tasks in the order they'll run. */
  ordered() {
    return this.tasks.filter((t) => !t.cancelled).sort((a, b) => a.order - b.order || b.seq - a.seq)
  }

  /** Run every task (errors are collected, never thrown). Each runs once. */
  async run({ onTask = () => {} } = {}) {
    const out = []
    for (const t of this.ordered()) {
      t.cancelled = true
      const t0 = Date.now()
      try {
        await t.fn()
        out.push({ phase: t.phase, label: t.label, ok: true, ms: Date.now() - t0 })
      } catch (e) {
        out.push({ phase: t.phase, label: t.label, ok: false, ms: Date.now() - t0, error: e?.message || String(e) })
      }
      onTask(out[out.length - 1])
    }
    return out
  }

  pending() {
    return this.ordered().map((t) => ({ phase: t.phase, label: t.label }))
  }

  hasLeftovers() {
    return Object.values(this.leftovers).some((s) => s.size > 0)
  }

  /** SQL that removes the leftovers by id (and fixes ratings if reviews go with them). */
  leftoverSql({ runId = '', when = new Date().toISOString() } = {}) {
    const list = (set) => [...set].filter((id) => UUID.test(id)).map((id) => `'${id}'`).join(', ')
    const lines = [
      `-- e2e leftovers from run ${runId} (${when}).`,
      '-- Optional: paste into the Supabase SQL editor to remove the [e2e] rows the app\'s API can\'t delete',
      '-- (Row-Level Security has no delete rule for them). Only these exact ids are touched.',
    ]
    if (!this.hasLeftovers()) return `${lines.join('\n')}\n-- Nothing left over.\n`
    lines.push('begin;')
    const { messages, conversations, bookings, providers } = this.leftovers
    if (messages.size) lines.push(`delete from public.messages where id in (${list(messages)});`)
    if (conversations.size) lines.push(`delete from public.conversations where id in (${list(conversations)}); -- [e2e] groups / new DMs (their messages cascade)`)
    if (bookings.size) lines.push(`delete from public.bookings where id in (${list(bookings)}); -- history, offers, add-ons, booking chats and reviews cascade`)
    if (providers.size) {
      lines.push(`delete from public.packages where provider_id in (${list(providers)});`)
      lines.push(`delete from public.providers where id in (${list(providers)}); -- the [e2e] listing`)
    }
    if (this.ratingsTouched.providers.size) {
      lines.push(
        `update public.providers p set`,
        `  rating_avg = (select round(avg(r.rating), 2) from public.reviews r where r.provider_id = p.id and r.direction = 'client_to_provider' and r.revealed_at is not null),`,
        `  rating_count = (select count(*) from public.reviews r where r.provider_id = p.id and r.direction = 'client_to_provider' and r.revealed_at is not null)`,
        `where p.id in (${list(this.ratingsTouched.providers)});`,
      )
    }
    if (this.ratingsTouched.profiles.size) {
      lines.push(
        `update public.profiles pr set`,
        `  client_rating_avg = (select round(avg(r.rating), 2) from public.reviews r where r.subject_profile_id = pr.id and r.direction = 'provider_to_client' and r.revealed_at is not null),`,
        `  client_rating_count = (select count(*) from public.reviews r where r.subject_profile_id = pr.id and r.direction = 'provider_to_client' and r.revealed_at is not null)`,
        `where pr.id in (${list(this.ratingsTouched.profiles)});`,
      )
    }
    lines.push('commit;')
    return `${lines.join('\n')}\n`
  }
}
