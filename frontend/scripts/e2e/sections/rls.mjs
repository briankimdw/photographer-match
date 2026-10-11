// Row-Level Security, from a signed-in client who has no business seeing the
// others' data. Builds its own small fixtures (a booking, a DM, an event) as client A.
import { assert, eq, expectError } from '../lib/harness.mjs'
import { pickQuantity } from '../lib/pricing.mjs'

const rows = async (q) => {
  const { data, error } = await q
  if (error) return { error }
  return { n: data?.length ?? 0 }
}

export default {
  id: 'rls',
  title: 'RLS negatives (an outsider)',
  roles: ['clientA', 'clientB', 'outsider', 'photographer'],
  steps: [
    {
      name: 'fixtures: a booking, a DM and an event (client A)',
      run: async (ctx) => {
        const { app, state } = ctx
        const pkg = state.catererListing.packages.find((k) => k.priceType === 'per_person' && k.price != null)
        const { rows: booked } = await ctx.book('clientA', { packageId: pkg.id, quantity: pickQuantity(pkg) }, { label: 'rls fixture' })
        const b = await ctx.as('clientB')
        const a = await ctx.as('clientA')
        const dm = await app.messages.startDirectMessage(b.uid)
        const m = await app.messages.sendMessage(dm, { text: ctx.tag('private note') })
        ctx.cleanup.leave('messages', m.id)
        const ev = await app.events.createEventFromForm({ title: ctx.tag('private event'), type: 'wedding', date: ctx.dates.next(), budget: 20000, guestCount: 120 })
        ctx.cleanup.add('events', `delete event ${ev.id.slice(0, 8)}`, async () => {
          await ctx.as('clientA')
          await app.events.deleteEvent(ev.id)
        })
        state.rls = { booking: booked[0].id, dm, message: m.id, event: ev.id, eventChat: ev.conversationId, a: a.uid }
        return `booking ${booked[0].id.slice(0, 8)}, DM ${dm.slice(0, 8)}, event ${ev.id.slice(0, 8)}`
      },
    },
    {
      name: 'outsider can\'t read or change the booking',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        const o = await ctx.as('outsider')
        eq((await rows(o.client.from('bookings').select('id').eq('id', state.rls.booking))).n, 0, 'bookings rows')
        eq(await app.bookings.getBooking(state.rls.booking), null, 'getBooking')
        for (const t of ['booking_events', 'booking_offers', 'booking_addons']) {
          eq((await rows(o.client.from(t).select('booking_id').eq('booking_id', state.rls.booking))).n, 0, `${t} rows`)
        }
        await expectError(app.bookings.cancelBooking(state.rls.booking), /booking not found/i, 'outsider cancel')
        await expectError(app.bookings.respondToBooking(state.rls.booking, 'accept'), /booking not found/i, 'outsider accept')
        await expectError(app.bookings.submitReview(state.rls.booking, 1, 'x'), /booking not found/i, 'outsider review')
        return 'invisible; cancel / accept / review refused'
      },
    },
    {
      name: 'another vendor can\'t see the booking',
      soft: true,
      run: async (ctx) => {
        const v = await ctx.as('photographer')
        eq((await rows(v.client.from('bookings').select('id').eq('id', ctx.state.rls.booking))).n, 0, 'bookings rows for an unrelated vendor')
        eq(await ctx.app.bookings.getBooking(ctx.state.rls.booking), null, 'getBooking')
        return 'only the client and that booking\'s vendor can read it'
      },
    },
    {
      name: 'outsider can\'t read or post in a DM',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        const o = await ctx.as('outsider')
        eq((await rows(o.client.from('messages').select('id').eq('conversation_id', state.rls.dm))).n, 0, 'messages rows')
        eq((await rows(o.client.from('conversation_members').select('profile_id').eq('conversation_id', state.rls.dm))).n, 0, 'member rows')
        eq(await app.messages.getConversation(state.rls.dm), null, 'getConversation')
        eq((await app.messages.listMessages(state.rls.dm)).length, 0, 'listMessages')
        await expectError(app.messages.sendMessage(state.rls.dm, { text: ctx.tag('intruder') }), null, 'outsider posting')
        await expectError(app.messages.addGroupMembers(state.rls.dm, [o.uid]), /group not found/i, 'outsider adding themselves')
        const { data } = await o.client.from('conversation_members').update({ last_read_at: new Date().toISOString() }).eq('conversation_id', state.rls.dm).select('profile_id')
        eq(data?.length ?? 0, 0, 'read markers the outsider could move')
        return 'messages, members and posting all refused'
      },
    },
    {
      name: 'outsider can\'t read or edit the event',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        const o = await ctx.as('outsider')
        eq((await rows(o.client.from('events').select('id').eq('id', state.rls.event))).n, 0, 'events rows')
        eq((await rows(o.client.from('event_members').select('profile_id').eq('event_id', state.rls.event))).n, 0, 'event_members rows')
        eq((await rows(o.client.from('messages').select('id').eq('conversation_id', state.rls.eventChat))).n, 0, 'event chat rows')
        const { data } = await o.client.from('events').update({ title: 'hacked' }).eq('id', state.rls.event).select('id')
        eq(data?.length ?? 0, 0, 'events the outsider could update')
        const { error } = await o.client.from('event_members').insert({ event_id: state.rls.event, profile_id: o.uid, role: 'co_planner' })
        assert(error, 'outsider added themselves as a co-planner')
        await ctx.as('clientA')
        eq((await app.events.getEvent(state.rls.event)).title, ctx.tag('private event'), 'title after the outsider\'s update')
        return 'read, update and self-invite refused'
      },
    },
    {
      name: 'outsider can\'t touch other people\'s rows',
      soft: true,
      run: async (ctx) => {
        // Every write below would be a no-op even if it got through (it sets values to
        // what they already are), and anything inserted by mistake is removed again,
        // so a broken policy shows up as a FAIL without changing the demo data.
        const { state } = ctx
        const { client: anon } = ctx.anon()
        const ph = state.photographerListing
        const { data: cur } = await anon.from('providers').select('bio, status').eq('id', ph.id).single()
        const { data: curProfile } = await anon.from('profiles').select('bio').eq('id', state.rls.a).single()
        const pkg0 = ph.packages[0]
        const o = await ctx.as('outsider')
        const problems = []
        const undoAsA = (label, fn) => ctx.cleanup.add('social', label, async () => fn(await ctx.as('clientA')))
        const upd = await o.client.from('providers').update({ bio: cur.bio }).eq('id', ph.id).select('id')
        if (upd.data?.length) problems.push('updated another vendor\'s listing')
        const pk = await o.client.from('packages').update({ price_cents: pkg0.price == null ? null : Math.round(pkg0.price * 100) }).eq('id', pkg0.id).select('id')
        if (pk.data?.length) problems.push('updated another vendor\'s packages')
        const prof = await o.client.from('profiles').update({ bio: curProfile.bio }).eq('id', state.rls.a).select('id')
        if (prof.data?.length) problems.push('updated another user\'s profile')
        const priv = await rows(o.client.from('provider_private').select('provider_id').eq('provider_id', ph.id))
        if (priv.n) problems.push('read provider_private')
        const sw = await rows(o.client.from('swipes').select('id').eq('user_id', state.rls.a))
        if (sw.n) problems.push('read another user\'s swipes')
        const sv = await rows(o.client.from('saved_providers').select('provider_id').eq('user_id', state.rls.a))
        if (sv.n) problems.push('read another user\'s shortlist')
        const ins = await o.client.from('swipes').insert({ user_id: state.rls.a, action: 'pass', provider_id: ph.id }).select('id')
        if (!ins.error) {
          problems.push('inserted a swipe as someone else')
          for (const r of ins.data || []) undoAsA('remove stray swipe', (a) => a.client.from('swipes').delete().eq('id', r.id))
        }
        // The fixture booking isn't completed, so even a successful insert would be an [e2e] row that the leftover SQL removes.
        const rv = await o.client.from('reviews').insert({ booking_id: state.rls.booking, provider_id: state.catererListing.id, author_id: o.uid, subject_profile_id: state.rls.a, direction: 'client_to_provider', rating: 1, body: ctx.tag('forged review') })
        if (!rv.error) problems.push('inserted a review directly')
        const following = await rows(anon.from('follows').select('provider_id').eq('follower_id', state.rls.a).eq('provider_id', ph.id))
        if (!following.n) {
          const fl = await o.client.from('follows').insert({ follower_id: state.rls.a, provider_id: ph.id })
          if (!fl.error) {
            problems.push('followed on someone else\'s behalf')
            undoAsA('remove stray follow', (a) => a.client.from('follows').delete().eq('follower_id', state.rls.a).eq('provider_id', ph.id))
          }
        }
        const strayPath = `${state.rls.a}/e2e-intruder-${ctx.runId}.jpg`
        const up = await o.client.storage.from('portfolio').upload(strayPath, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }))
        if (!up.error) {
          problems.push('uploaded into another user\'s storage folder')
          undoAsA('remove stray upload', (a) => a.client.storage.from('portfolio').remove([strayPath]))
        }
        const st = await o.client.from('providers').update({ status: cur.status }).eq('id', ph.id).select('id')
        if (st.data?.length) problems.push('changed another listing\'s status')
        assert(!problems.length, problems.join('; '))
        return '11 cross-user reads/writes refused'
      },
    },
    {
      name: 'tidy: cancel the fixture booking, delete the event',
      always: true,
      run: async (ctx) => {
        const { app, state } = ctx
        if (!state.rls) return 'nothing to tidy'
        await ctx.as('clientA')
        const b = await app.bookings.getBooking(state.rls.booking)
        if (b?.isActive) await app.bookings.cancelBooking(state.rls.booking)
        await app.events.deleteEvent(state.rls.event)
        return 'done'
      },
    },
  ],
}
