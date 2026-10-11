// Bookings: totals for every price type, the vendor side (see the request, counter,
// accept, decline), payment-gated steps (deliver, complete, reviews, ratings) and
// capacity (several events at once for caterers; never two for a photographer).
import { assert, eq, errorText, expectError, skip, waitFor } from '../lib/harness.mjs'
import { amountsOf, diffAmounts, expectedBooking, pickQuantity } from '../lib/pricing.mjs'

const ACTIVE = ['requested', 'countered', 'accepted', 'confirmed', 'in_progress']
const roleVendorIds = (ctx) => ['photographer', 'unverified', 'caterer'].map((k) => ctx.state[`${k}Listing`]?.id).filter(Boolean)

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

function priceStep(type, { dateCount = 1, hours = null } = {}) {
  return {
    name: `requestBooking ${type}${dateCount > 1 ? ` x${dateCount} dates` : ''}: totals + cancel`,
    soft: true,
    run: async (ctx) => {
      const { app } = ctx
      const hit = await ctx.findPackage(type, { exclude: roleVendorIds(ctx) })
      if (!hit) skip(`no test vendor has a ${type} package`)
      const { provider, pkg } = hit
      const quantity = type === 'per_person' || type === 'per_item' ? pickQuantity(pkg) : null
      const h = type === 'hourly' ? hours ?? Math.max(2, (pkg.hours || 0) + 1) : null
      const expected = expectedBooking(pkg, { hours: h, quantity })
      const { rows } = await ctx.book('clientA', { packageId: pkg.id, hours: h, quantity }, { label: `${type} booking`, dateCount })
      eq(rows.length, dateCount, 'bookings created (one per date)')
      for (const row of rows) {
        const diff = diffAmounts(expected, amountsOf(row))
        assert(!diff, `${provider.slug} "${pkg.name}": ${diff}`)
        eq(row.status, 'requested', 'status')
        if (type === 'hourly') {
          const [a, b] = row.time_range.replace(/[[\]()"]/g, '').split(',').map((s) => new Date(s.trim().replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')))
          eq(Math.round((b - a) / 60000), expected.minutes, 'booked minutes')
        }
      }
      // The app's view of the same booking (as the client).
      await ctx.as('clientA')
      const b = await app.bookings.getBooking(rows[0].id)
      eq(b.role, 'client', 'role')
      eq(b.total, expected.total == null ? null : expected.total / 100, 'getBooking total ($)')
      eq(b.quantity, expected.quantity, 'getBooking quantity')
      eq(b.vertical, provider.vertical, 'getBooking vertical')
      for (const row of rows) {
        const res = await app.bookings.cancelBooking(row.id)
        eq(res.status, 'cancelled_by_client', 'cancel status')
        eq(res.refund_pct, 0, 'refund % (nothing paid yet)')
      }
      eq((await app.bookings.getBooking(rows[0].id)).isActive, false, 'still active after cancel')
      const total = expected.total == null ? 'quote (no total)' : `$${(expected.total / 100).toFixed(2)}`
      return `${provider.slug} "${pkg.name}"${quantity ? ` x${quantity}` : ''}${h ? ` ${h}h` : ''}: ${total}, deposit ${expected.deposit == null ? '-' : `$${(expected.deposit / 100).toFixed(2)}`}; cancelled`
    },
  }
}

export const pricing = {
  id: 'pricing',
  title: 'Booking totals for every price type',
  roles: ['clientA'],
  steps: [
    priceStep('fixed'),
    priceStep('hourly'),
    priceStep('per_person'),
    priceStep('per_item'),
    priceStep('daily', { dateCount: 2 }),
    priceStep('quote'),
    {
      name: 'per_person below the minimum is refused',
      soft: true,
      run: async (ctx) => {
        const hit = await ctx.findPackage('per_person', { exclude: roleVendorIds(ctx) })
        if (!hit || !(hit.pkg.minQuantity > 1)) skip('no per-person package with a minimum above 1')
        await ctx.as('clientA')
        const msg = await expectError(
          ctx.app.bookings.requestBooking({ packageId: hit.pkg.id, dates: [ctx.dates.next()], startTime: '10:00', quantity: hit.pkg.minQuantity - 1, notes: ctx.tag('too few guests') }),
          /at least/i,
          'request below minimum',
        )
        return `"${ctx.app.bookings.bookingError({ message: msg })}"`
      },
    },
  ],
}

// ---------------------------------------------------------------------------
// Vendor lifecycle
// ---------------------------------------------------------------------------

export const lifecycle = {
  id: 'lifecycle',
  title: 'Request -> counter -> accept -> (pay) -> deliver -> review',
  roles: ['clientA', 'photographer', 'unverified'],
  steps: [
    {
      name: 'client requests the photographer',
      run: async (ctx) => {
        const p = ctx.state.photographerListing
        const pkg = p.packages.find((k) => k.priceType === 'fixed' && k.price != null)
        const { rows } = await ctx.book('clientA', { packageId: pkg.id }, { label: 'lifecycle booking' })
        ctx.state.life = { id: rows[0].id, pkg, expected: expectedBooking(pkg) }
        eq(rows[0].total_cents, ctx.state.life.expected.total, 'total')
        return `${p.name} "${pkg.name}" on ${rows[0].time_range.slice(2, 12)}: $${rows[0].total_cents / 100}`
      },
    },
    {
      name: 'vendor sees the request (listProviderBookings)',
      run: async (ctx) => {
        const { app, state } = ctx
        const vendor = await ctx.as('photographer')
        const mine = await app.portfolio.getMyProviders(vendor.uid)
        assert(mine.some((m) => m.id === state.photographerListing.id), 'getMyProviders misses the listing')
        const list = await app.bookings.listProviderBookings(state.photographerListing.id)
        const b = list.find((x) => x.id === state.life.id)
        assert(b, 'the new request is not in the vendor\'s list')
        eq(b.role, 'provider', 'role')
        eq(b.status, 'requested', 'status')
        eq(b.client.username, ctx.roles.clientA.username, 'client username')
        assert(b.expiresIn, 'no expiry countdown on a request')
        assert(ctx.isTagged(b.note), 'notes not carried over')
        return `${list.length} bookings visible to the vendor; request expires in ${b.expiresIn}`
      },
    },
    {
      name: 'vendor counters, client accepts the offer',
      run: async (ctx) => {
        const { app, state } = ctx
        const counter = state.life.expected.total / 100 + 50
        await ctx.as('photographer')
        const row = await app.bookings.respondToBooking(state.life.id, 'counter', { total: counter, message: ctx.tag('counter offer') })
        eq(row.status, 'countered', 'status after counter')
        await ctx.as('clientA')
        const b = await app.bookings.getBooking(state.life.id)
        assert(b.offer, 'client sees no open offer')
        eq(b.offer.total, counter, 'offer total ($)')
        const accepted = await app.bookings.respondToOffer(b.offer.id, true)
        eq(accepted.status, 'accepted', 'status after accepting the offer')
        eq(accepted.total_cents, Math.round(counter * 100), 'total after offer')
        eq(accepted.deposit_cents, Math.round((Math.round(counter * 100) * state.life.pkg.depositPct) / 100), 'deposit after offer')
        state.life.total = counter
        return `$${state.life.expected.total / 100} -> countered $${counter} -> accepted (deposit $${accepted.deposit_cents / 100})`
      },
    },
    {
      name: 'vendor accepts a second request directly',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        const { rows } = await ctx.book('clientA', { packageId: state.life.pkg.id }, { label: 'direct accept' })
        await ctx.as('photographer')
        const row = await app.bookings.respondToBooking(rows[0].id, 'accept')
        eq(row.status, 'accepted', 'status')
        await ctx.as('clientA')
        const b = await app.bookings.getBooking(rows[0].id)
        eq(b.history.map((h) => h.status).join('>'), 'requested>accepted', 'history')
        const c = await app.bookings.cancelBooking(rows[0].id)
        eq(c.status, 'cancelled_by_client', 'client cancels an accepted booking')
        return 'requested > accepted > cancelled_by_client'
      },
    },
    {
      name: 'unverified vendor can\'t accept, can decline',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        const p = state.unverifiedListing
        const pkg = p.packages.find((k) => k.price != null && k.priceType !== 'quote')
        const quantity = pkg.priceType === 'per_person' || pkg.priceType === 'per_item' ? pickQuantity(pkg) : null
        const { rows } = await ctx.book('clientA', { packageId: pkg.id, quantity, hours: pkg.priceType === 'hourly' ? 2 : null }, { label: 'unverified vendor' })
        await ctx.as('unverified')
        await expectError(app.bookings.respondToBooking(rows[0].id, 'accept'), /verify your identity/i, 'unverified accept')
        const row = await app.bookings.respondToBooking(rows[0].id, 'decline')
        eq(row.status, 'declined', 'status after decline')
        return `${p.name}: accept refused, decline ok`
      },
    },
    {
      name: 'guards: no delivery / completion / review before payment',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('photographer')
        await expectError(app.bookings.markDelivered(state.life.id), /only confirmed/i, 'mark_delivered on an accepted booking')
        await ctx.as('clientA')
        await expectError(app.bookings.acceptDelivery(state.life.id), /no delivery/i, 'accept_delivery before delivery')
        await expectError(app.bookings.submitReview(state.life.id, 5, ctx.tag('too early')), /reviews open/i, 'review before completion')
        return 'mark_delivered, accept_delivery and submit_review all refused'
      },
    },
    {
      name: 'payment (status confirmed)',
      timeoutMs: 12 * 60_000,
      run: async (ctx) => {
        const { app, state, opts } = ctx
        state.life.confirmed = false
        if (!opts.pauseForPayment) {
          skip('"confirmed" is set only by the payment webhook (server code); rerun with --pause-for-payment to test deliver, complete, reviews and ratings')
        }
        ctx.log.prompt(
          [
            '',
            'PAUSED: the next steps need a paid booking. Stripe isn\'t wired up yet, so simulate the payment webhook:',
            'paste this into the Supabase SQL editor and run it (only this [e2e] booking changes):',
            '',
            `  update public.bookings set status = 'confirmed' where id = '${state.life.id}' and status = 'accepted';`,
            '',
            'Waiting up to 10 minutes for the booking to show as confirmed...',
            '',
          ].join('\n'),
        )
        await ctx.as('clientA')
        const ok = await waitFor(async () => (await app.bookings.getBooking(state.life.id))?.status === 'confirmed', { timeoutMs: 10 * 60_000, intervalMs: 3000 })
        assert(ok, 'the booking never became confirmed')
        state.life.confirmed = true
        return 'booking confirmed'
      },
    },
    {
      name: 'vendor marks delivered, client accepts delivery',
      run: async (ctx) => {
        const { app, state } = ctx
        if (!state.life.confirmed) skip('needs --pause-for-payment')
        await ctx.as('photographer')
        eq((await app.bookings.markDelivered(state.life.id)).status, 'delivered', 'after mark_delivered')
        await ctx.as('clientA')
        const b = await app.bookings.getBooking(state.life.id)
        eq(b.deliveryExpiresDays, 7, 'days until the delivery auto-completes')
        eq((await app.bookings.acceptDelivery(state.life.id)).status, 'completed', 'after accept_delivery')
        eq((await app.bookings.getBooking(state.life.id)).reviewWindowOpen, true, 'review window open')
        return 'delivered > completed'
      },
    },
    {
      name: 'double-blind reviews, ratings update',
      run: async (ctx) => {
        const { app, state } = ctx
        if (!state.life.confirmed) skip('needs --pause-for-payment')
        const client = await ctx.as('clientA')
        const { client: anon } = ctx.anon()
        const ratingOf = async () => {
          const { data: p } = await anon.from('providers').select('rating_count').eq('id', state.photographerListing.id).single()
          const { data: c } = await anon.from('profiles').select('client_rating_count').eq('id', client.uid).single()
          return { provider: p.rating_count ?? 0, client: c.client_rating_count ?? 0 }
        }
        const before = await ratingOf()
        ctx.cleanup.touchRatings({ providerId: state.photographerListing.id, profileId: client.uid })
        await ctx.as('clientA')
        const mine = await app.bookings.submitReview(state.life.id, 5, ctx.tag('great to work with'))
        eq(mine.revealed_at, null, 'first review hidden until the other side reviews')
        ctx.anon()
        assert(!(await app.catalog.listReviews(state.photographerListing.id, 50)).some((r) => r.bookingId === state.life.id), 'review public before reveal')
        await ctx.as('photographer')
        const theirs = await app.bookings.submitReview(state.life.id, 5, ctx.tag('lovely client'))
        assert(theirs.revealed_at, 'second review should reveal both')
        const after = await ratingOf()
        eq(after.provider, before.provider + 1, 'provider rating_count')
        eq(after.client, before.client + 1, 'client rating_count')
        ctx.anon()
        assert((await app.catalog.listReviews(state.photographerListing.id, 50)).some((r) => r.bookingId === state.life.id), 'revealed review not listed')
        return `provider reviews ${before.provider} -> ${after.provider}, client reviews ${before.client} -> ${after.client}`
      },
    },
    {
      name: 'vendor cancels the accepted booking',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        if (state.life.confirmed) skip('booking was completed (reviews test); nothing to cancel')
        await ctx.as('photographer')
        const res = await app.bookings.cancelBooking(state.life.id)
        eq(res.status, 'cancelled_by_provider', 'status')
        return `cancelled_by_provider, refund ${res.refund_pct}%`
      },
    },
  ],
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export const capacity = {
  id: 'capacity',
  title: 'Capacity: overlapping bookings',
  roles: ['clientA', 'clientB'],
  steps: [
    {
      name: 'caterer takes several overlapping events, then is full',
      run: async (ctx) => {
        const { app, state } = ctx
        const p = state.catererListing
        const cap = state.catererCapacity
        const pkg = p.packages.find((k) => k.priceType === 'per_person' && k.price != null)
        const quantity = pickQuantity(pkg)
        // Find a day where the first booking fits, then pile more onto the same slot.
        const { rows, dates } = await ctx.book('clientA', { packageId: pkg.id, quantity }, { label: 'capacity 1' })
        const day = dates[0]
        const ids = [rows[0].id]
        let refused = null
        for (let i = 2; i <= cap + 1; i++) {
          await ctx.as(i % 2 ? 'clientA' : 'clientB')
          try {
            const more = await app.bookings.requestBooking({ packageId: pkg.id, dates: [day], startTime: '10:00', quantity, notes: ctx.tag(`capacity ${i}`) })
            ctx.trackBooking(i % 2 ? 'clientA' : 'clientB', more[0].id, `capacity ${i}`)
            ids.push(more[0].id)
          } catch (e) {
            refused = errorText(e)
            break
          }
        }
        assert(ids.length >= 2, `only ${ids.length} overlapping booking(s) fit (capacity ${cap}); refused with: ${refused}`)
        assert(ids.length <= cap, `${ids.length} overlapping bookings exceed capacity ${cap}`)
        assert(refused && /fully booked/i.test(refused), `booking #${ids.length + 1} should be refused as fully booked, got: ${refused ?? 'accepted'}`)
        state.capacity = { ids, day, pkg, quantity }
        const { data } = await (await ctx.as('clientA')).client.from('bookings').select('slot').in('id', ids)
        return `${ids.length}/${cap} at once on ${day} (slots ${data.map((r) => r.slot).sort().join(',')}); next refused: "${app.bookings.bookingError({ message: refused })}"`
      },
    },
    {
      name: 'cancelling frees the slot',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        const { ids, day, pkg, quantity } = state.capacity
        await ctx.as('clientA')
        const first = await app.bookings.getBooking(ids[0])
        await app.bookings.cancelBooking(ids[0])
        await ctx.as('clientB')
        const again = await app.bookings.requestBooking({ packageId: pkg.id, dates: [day], startTime: '10:00', quantity, notes: ctx.tag('capacity refill') })
        ctx.trackBooking('clientB', again[0].id, 'capacity refill')
        eq(again[0].status, 'requested', 'refill status')
        // Tidy: cancel everything now (the cleanup would too).
        for (const id of [...ids.slice(1), again[0].id]) {
          for (const key of ['clientA', 'clientB']) {
            await ctx.as(key)
            const b = await app.bookings.getBooking(id)
            if (b && b.role === 'client' && ACTIVE.includes(b.status)) await app.bookings.cancelBooking(id)
          }
        }
        return `slot ${first ? 'freed' : '?'} and re-booked by another client; all cancelled`
      },
    },
    {
      name: 'photographer can\'t be double-booked',
      run: async (ctx) => {
        const { app, state } = ctx
        const pkg = state.photographerListing.packages.find((k) => k.priceType === 'fixed' && k.price != null)
        const { rows, dates } = await ctx.book('clientA', { packageId: pkg.id }, { label: 'overlap A' })
        await ctx.as('clientB')
        const msg = await expectError(
          app.bookings.requestBooking({ packageId: pkg.id, dates, startTime: '10:00', notes: ctx.tag('overlap B') }),
          /already booked/i,
          'overlapping request from another client',
        )
        await ctx.as('clientA')
        await app.bookings.cancelBooking(rows[0].id)
        return `second request on ${dates[0]} refused: "${app.bookings.bookingError({ message: msg })}"`
      },
    },
  ],
}
