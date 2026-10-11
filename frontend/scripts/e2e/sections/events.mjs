// Events with friends: create (with its chat), invite, the "Who we're hiring"
// board (add / vote / status), bookings linked to the event, leaving, and
// outsiders being kept out.
import { assert, eq, expectError, waitFor } from '../lib/harness.mjs'
import { pickQuantity } from '../lib/pricing.mjs'

export default {
  id: 'events',
  title: 'Events with friends',
  roles: ['clientA', 'clientB', 'outsider'],
  steps: [
    {
      name: 'create_event_with_chat',
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('clientA')
        const date = ctx.dates.next()
        const res = await app.events.createEventFromForm({ title: ctx.tag('birthday'), type: 'birthday', date, locationText: 'Los Angeles, CA', guestCount: 40, budget: 5000 })
        eq(res.setup, true, 'event-groups migration applied (setup)')
        assert(res.conversationId, 'no chat created')
        const undo = ctx.cleanup.add('events', `delete event ${res.id.slice(0, 8)}`, async () => {
          await ctx.as('clientA')
          await app.events.deleteEvent(res.id)
        })
        state.ev = { ...res, date, undo }
        const board = await app.events.getEventBoard(res.id)
        eq(board.setup, true, 'board setup')
        eq(board.chatId, res.conversationId, 'board chat id')
        eq(board.event.members.length, 1, 'members')
        eq(board.event.isOwner, true, 'isOwner')
        eq(board.event.budgetCents, 500000, 'budget cents')
        assert(board.groups.some((g) => g.needed), 'no needed verticals for a birthday')
        return `event ${res.id.slice(0, 8)} on ${date}; needs ${board.groups.filter((g) => g.needed).map((g) => g.vertical.slug).join(', ')}`
      },
    },
    {
      name: 'invite a friend: co-planner + chat member',
      run: async (ctx) => {
        const { app, state } = ctx
        const b = await ctx.as('clientB')
        await ctx.as('clientA')
        eq(await app.events.inviteToEvent(state.ev.id, [b.uid]), 1, 'invited')
        eq(await app.events.inviteToEvent(state.ev.id, [b.uid]), 0, 'inviting twice adds nobody')
        await ctx.as('clientB')
        const list = await app.events.listEvents()
        const mine = list.find((e) => e.id === state.ev.id)
        assert(mine, 'invitee doesn\'t see the event')
        eq(mine.members.length, 2, 'members seen by the invitee')
        const chat = (await app.messages.listConversations()).find((c) => c.id === state.ev.conversationId)
        assert(chat && chat.kind === 'event', 'invitee isn\'t in the event chat')
        const msgs = await app.messages.listMessages(state.ev.conversationId)
        assert(msgs.some((m) => /added .* to the planning/.test(m.text)), 'no "added to the planning" note in the chat')
        return `invitee sees event + chat "${chat.title}"`
      },
    },
    {
      name: 'board: add a vendor, vote, shortlist',
      run: async (ctx) => {
        const { app, state } = ctx
        const vendor = state.catererListing
        await ctx.as('clientA')
        const row = await app.events.addCandidate(state.ev.id, vendor.id)
        eq(row.vertical_slug, vendor.vertical, 'candidate vertical')
        await ctx.as('clientB')
        await app.events.setVote(state.ev.id, vendor.id, true)
        await app.events.setVote(state.ev.id, vendor.id, true) // twice is fine
        await ctx.as('clientA')
        await app.events.setVote(state.ev.id, vendor.id, true)
        await app.events.setCandidateStatus(state.ev.id, vendor.id, 'shortlisted')
        let c = (await app.events.getEventBoard(state.ev.id)).groups.flatMap((g) => g.items).find((x) => x.providerId === vendor.id)
        eq(c.votes, 2, 'votes')
        eq(c.votedByMe, true, 'votedByMe')
        eq(c.stage, 'shortlisted', 'stage')
        await ctx.as('clientB')
        await app.events.setVote(state.ev.id, vendor.id, false)
        c = (await app.events.getEventBoard(state.ev.id)).groups.flatMap((g) => g.items).find((x) => x.providerId === vendor.id)
        eq(c.votes, 1, 'votes after taking one back')
        eq(c.votedByMe, false, 'votedByMe after taking it back')
        return `${vendor.name}: 2 votes -> 1, shortlisted`
      },
    },
    {
      name: 'booking from the event shows on everyone\'s board',
      run: async (ctx) => {
        const { app, state } = ctx
        const vendor = state.catererListing
        const pkg = vendor.packages.find((k) => k.priceType === 'per_person' && k.price != null)
        const { rows } = await ctx.book('clientA', { packageId: pkg.id, quantity: pickQuantity(pkg), eventId: state.ev.id }, { label: 'event booking' })
        state.ev.booking = rows[0]
        eq(rows[0].event_id, state.ev.id, 'booking event_id')
        await ctx.as('clientB')
        const board = await app.events.getEventBoard(state.ev.id)
        const c = board.groups.flatMap((g) => g.items).find((x) => x.providerId === vendor.id)
        eq(c.stage, 'requested', 'stage for the co-planner')
        eq(c.booking?.mine, false, 'booking.mine for the co-planner')
        eq(board.budget.pending, rows[0].total_cents, 'pending budget')
        eq(await app.bookings.getBooking(rows[0].id), null, 'co-planner reading the booking row itself')
        return `co-planner sees "requested", $${rows[0].total_cents / 100} pending, but not the booking row`
      },
    },
    {
      name: 'outsiders are kept out',
      soft: true,
      run: async (ctx) => {
        const { app, state } = ctx
        const o = await ctx.as('outsider')
        eq(await app.events.getEvent(state.ev.id), null, 'getEvent')
        eq(await app.events.getEventBoard(state.ev.id), null, 'getEventBoard')
        assert(!(await app.events.listEvents()).some((e) => e.id === state.ev.id), 'listed in listEvents')
        const { data: eb, error } = await o.client.rpc('event_bookings', { p_event_id: state.ev.id })
        if (error) throw error
        eq(eb.length, 0, 'event_bookings rows')
        await expectError(app.events.inviteToEvent(state.ev.id, [o.uid]), /event not found/i, 'outsider inviting themselves')
        await expectError(app.events.addCandidate(state.ev.id, state.photographerListing.id), /event not found/i, 'outsider adding a candidate')
        eq((await app.messages.listMessages(state.ev.conversationId)).length, 0, 'event chat messages visible')
        await expectError(app.messages.sendMessage(state.ev.conversationId, { text: ctx.tag('intruder') }), null, 'outsider posting in the event chat')
        const { data: upd } = await o.client.from('events').update({ title: 'hacked' }).eq('id', state.ev.id).select('id')
        eq(upd?.length ?? 0, 0, 'rows the outsider could update')
        return 'event, board, bookings, chat and invites all refused'
      },
    },
    {
      name: 'rename follows into the chat; co-planner leaves',
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('clientA')
        const title = ctx.tag('birthday (renamed)')
        const ev = await app.events.editEvent(state.ev.id, { title })
        eq(ev.title, title, 'event title')
        eq((await app.messages.getConversation(state.ev.conversationId)).title, title, 'chat title')
        await expectError(app.events.leaveEvent(state.ev.id), /own this event/i, 'owner leaving')
        await ctx.as('clientB')
        await app.events.leaveEvent(state.ev.id)
        eq(await app.events.getEvent(state.ev.id), null, 'left co-planner still sees the event')
        eq(await app.messages.getConversation(state.ev.conversationId), null, 'left co-planner still in the chat')
        return 'renamed; co-planner left event + chat'
      },
    },
    {
      name: 'cancel the event booking, delete the event (chat goes too)',
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('clientA')
        await app.bookings.cancelBooking(state.ev.booking.id)
        await app.events.deleteEvent(state.ev.id)
        state.ev.undo.cancel()
        eq(await app.events.getEvent(state.ev.id), null, 'event after delete')
        const gone = await waitFor(async () => (await app.messages.getConversation(state.ev.conversationId)) === null, { timeoutMs: 3000 })
        assert(gone, 'event chat still there')
        const b = await app.bookings.getBooking(state.ev.booking.id)
        eq(b?.status, 'cancelled_by_client', 'booking kept (cancelled), unlinked from the event')
        return 'event, board and chat deleted'
      },
    },
  ],
}
