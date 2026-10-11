// Messaging (DMs, groups, unread, realtime) and sharing cards in chat.
import { assert, eq, expectError, skip, sleep, waitFor } from '../lib/harness.mjs'

/** Wait until the realtime channel for this topic fragment is joined on that client. */
async function joined(client, fragment, timeoutMs = 8000) {
  return waitFor(() => client.getChannels().some((ch) => ch.topic.includes(fragment) && ch.state === 'joined'), { timeoutMs, intervalMs: 100 })
}

/** Open (or reuse) the DM between A and B; records whether this run created it. */
async function directThread(ctx) {
  if (ctx.state.dm) return ctx.state.dm
  const { app } = ctx
  const b = await ctx.as('clientB')
  await ctx.as('clientA')
  const existing = (await app.messages.listConversations()).find((c) => c.kind === 'direct' && c.members.length === 1 && c.members[0].profileId === b.uid)
  const id = await app.messages.startDirectMessage(b.uid)
  if (existing) eq(id, existing.id, 'start_direct_message reuses the existing thread')
  else ctx.cleanup.leave('conversations', id) // new: the whole thread can go
  ctx.state.dm = { id, isNew: !existing }
  return ctx.state.dm
}

/** Send as A in a thread and record the message for the leftover SQL. */
async function sendAs(ctx, key, conversationId, payload) {
  await ctx.as(key)
  const m = await ctx.app.messages.sendMessage(conversationId, payload)
  ctx.cleanup.leave('messages', m.id)
  return m
}

export const messaging = {
  id: 'messaging',
  title: 'Direct messages, groups, unread, realtime',
  roles: ['clientA', 'clientB', 'photographer', 'caterer'],
  steps: [
    {
      name: 'DM: start thread + send (client -> client)',
      run: async (ctx) => {
        const dm = await directThread(ctx)
        const text = ctx.tag('hello from the e2e test')
        const m = await sendAs(ctx, 'clientA', dm.id, { text })
        eq(m.mine, true, 'mine')
        eq(m.text, text, 'text')
        ctx.state.dmText = text
        return `${dm.isNew ? 'new' : 'existing'} thread ${dm.id.slice(0, 8)}`
      },
    },
    {
      name: 'recipient: inbox shows it unread, markRead clears it',
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('clientB')
        const list = await app.messages.listConversations()
        const c = list.find((x) => x.id === state.dm.id)
        assert(c, 'thread missing from the recipient\'s inbox')
        eq(c.lastMessage?.text, state.dmText, 'last message')
        eq(c.unread, true, 'unread before reading')
        const before = await app.messages.unreadCount()
        assert(before >= 1, `unreadCount ${before}`)
        await app.messages.markRead(state.dm.id)
        const after = (await app.messages.listConversations()).find((x) => x.id === state.dm.id)
        eq(after.unread, false, 'unread after markRead')
        eq(await app.messages.unreadCount(), before - 1, 'unreadCount after markRead')
        const msgs = await app.messages.listMessages(state.dm.id)
        assert(msgs.some((m) => m.text === state.dmText && !m.mine), 'message missing from listMessages')
        return `unread chats ${before} -> ${before - 1}`
      },
    },
    {
      name: 'realtime: recipient receives a new message live',
      soft: true,
      run: async (ctx) => {
        const { app, state, opts } = ctx
        const b = await ctx.as('clientB')
        const got = []
        const live = app.messages.openChat(state.dm.id, { onMessage: (m) => got.push(m) })
        let inboxPings = 0
        const stopInbox = app.messages.subscribeToInbox(() => inboxPings++)
        try {
          assert(await joined(b.client, `chat-db:${state.dm.id}`), 'realtime channel never joined')
          await sleep(500)
          const text = ctx.tag('realtime ping')
          const t0 = Date.now()
          await sendAs(ctx, 'clientA', state.dm.id, { text })
          const hit = await waitFor(() => got.find((m) => m.text === text), { timeoutMs: opts.realtimeTimeoutMs })
          assert(hit, `no realtime message within ${opts.realtimeTimeoutMs / 1000}s`)
          const ms = Date.now() - t0
          await waitFor(() => inboxPings > 0, { timeoutMs: 3000 })
          return `delivered in ${ms}ms; inbox subscription fired ${inboxPings}x`
        } finally {
          await ctx.as('clientB')
          live.close()
          stopInbox()
        }
      },
    },
    {
      name: 'group: create with 2 others',
      run: async (ctx) => {
        const { app, state } = ctx
        const b = await ctx.as('clientB')
        const v = await ctx.as('photographer')
        await ctx.as('clientA')
        await expectError(app.messages.createGroup(ctx.tag('too small'), [b.uid]), /at least two/i, 'group with one other person')
        const id = await app.messages.createGroup(ctx.tag('group'), [b.uid, v.uid])
        ctx.cleanup.leave('conversations', id)
        for (const key of ['clientA', 'clientB', 'photographer', 'caterer']) {
          ctx.cleanup.add('chats', `${key} leaves group ${id.slice(0, 8)}`, async () => {
            await ctx.as(key)
            const c = await app.messages.getConversation(id)
            if (c) await app.messages.leaveGroup(id)
          })
        }
        const c = await app.messages.getConversation(id)
        eq(c.kind, 'group', 'kind')
        eq(c.members.length, 2, 'members besides me')
        state.group = { id }
        return `group ${id.slice(0, 8)} with ${c.members.map((m) => m.username).join(', ')}`
      },
    },
    {
      name: 'group: rename, add a member, message',
      run: async (ctx) => {
        const { app, state } = ctx
        const caterer = await ctx.as('caterer')
        await ctx.as('clientB') // any member can rename
        const title = ctx.tag('group (renamed)')
        await app.messages.renameGroup(state.group.id, title)
        await ctx.as('clientA')
        eq(await app.messages.addGroupMembers(state.group.id, [caterer.uid]), 1, 'members added')
        const c = await app.messages.getConversation(state.group.id)
        eq(c.title, title, 'title')
        eq(c.members.length, 3, 'members besides me')
        await app.messages.sendMessage(state.group.id, { text: ctx.tag('hi group') })
        await ctx.as('caterer')
        const msgs = await app.messages.listMessages(state.group.id)
        assert(msgs.some((m) => m.text === ctx.tag('hi group')), 'new member can\'t read the group')
        return `renamed; ${c.members.length + 1} people`
      },
    },
    {
      name: 'group: leave',
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('photographer')
        await app.messages.leaveGroup(state.group.id)
        eq(await app.messages.getConversation(state.group.id), null, 'left member still sees the group')
        eq((await app.messages.listMessages(state.group.id)).length, 0, 'left member still reads messages')
        await ctx.as('clientA')
        const c = await app.messages.getConversation(state.group.id)
        assert(!c.members.some((m) => m.username === ctx.roles.photographer.username), 'left member still listed')
        await expectError(app.messages.leaveGroup(state.dm.id), /group not found/i, 'leaving a DM')
        return `${c.members.length + 1} people left`
      },
    },
    {
      name: 'searchPeople finds the other client',
      soft: true,
      run: async (ctx) => {
        await ctx.as('clientA')
        const found = await ctx.app.messages.searchPeople(ctx.roles.clientB.username)
        assert(found.some((p) => p.username === ctx.roles.clientB.username), 'not found')
        return `${found.length} match(es)`
      },
    },
  ],
}

// ---------------------------------------------------------------------------

const EVENT_PREVIEW_KEYS = new Set(['kind', 'id', 'title', 'type', 'starts_at', 'ends_at', 'location_text', 'cover'])

export const sharing = {
  id: 'sharing',
  title: 'Sharing posts, vendors and events to chats',
  roles: ['clientA', 'clientB'],
  steps: [
    {
      name: 'database supports every card (shareSupport)',
      run: async (ctx) => {
        await ctx.as('clientA')
        const s = await ctx.app.messages.shareSupport()
        assert(s.post && s.provider && s.event, `share cards not set up: ${JSON.stringify(s)}`)
        return JSON.stringify(s)
      },
    },
    {
      name: 'shareToChats: post, vendor and event cards',
      run: async (ctx) => {
        const { app, state } = ctx
        const b = await ctx.as('clientB')
        const dm = await directThread(ctx)
        // A private event with a budget and guest count that must NOT leak into the card.
        await ctx.as('clientA')
        const ev = await app.events.createEventFromForm({ title: ctx.tag('share test'), type: 'birthday', date: ctx.dates.next(), locationText: 'Los Angeles, CA', guestCount: 42, budget: 4321 })
        ctx.cleanup.add('events', `delete event ${ev.id.slice(0, 8)}`, async () => {
          await ctx.as('clientA')
          await app.events.deleteEvent(ev.id)
        })
        const photographer = state.photographerListing
        const albums = (await app.portfolio.listAlbums(photographer.id)).filter((a) => a.status === 'published')
        if (!albums.length) skip(`${photographer.slug} has no published post to share`)
        const items = [
          { kind: 'post', id: albums[0].id },
          { kind: 'provider', id: photographer.id },
          { kind: 'event', id: ev.id },
        ]
        for (const it of items) {
          await ctx.as('clientA')
          const res = await app.messages.shareToChats({ profileIds: [b.uid], kind: it.kind, id: it.id, text: ctx.tag(`shared ${it.kind}`) })
          eq(res.sent.length, 1, `${it.kind} sent`)
          eq(res.sent[0], dm.id, `${it.kind} went to the existing DM`)
        }
        await ctx.as('clientA')
        for (const m of await app.messages.listMessages(dm.id)) if (ctx.isTagged(m.text) && m.mine) ctx.cleanup.leave('messages', m.id)
        state.share = { dm: dm.id, event: ev, album: albums[0], provider: photographer }
        return `post "${albums[0].title}", ${photographer.name}, event "${ev.id.slice(0, 8)}"`
      },
    },
    {
      name: 'recipient sees the cards; previews come from the server',
      run: async (ctx) => {
        const { app, state } = ctx
        const b = await ctx.as('clientB')
        const msgs = (await app.messages.listMessages(state.share.dm)).filter((m) => ctx.isTagged(m.text) && m.shared)
        const byKind = Object.fromEntries(msgs.map((m) => [m.shared.kind, m]))
        assert(byKind.post && byKind.provider && byKind.event, `cards received: ${Object.keys(byKind).join(', ') || 'none'}`)
        eq(byKind.post.shared.id, state.share.album.id, 'post card id')
        eq(byKind.provider.shared.name, state.share.provider.name, 'vendor card name')
        assert(byKind.provider.shared.fromPrice, 'vendor card has no "from $" price')
        eq(byKind.event.shared.title, ctx.tag('share test'), 'event card title (from the snapshot)')
        const { data, error } = await b.client.from('messages').select('id, share_preview').in('id', msgs.map((m) => m.id))
        if (error) throw error
        for (const row of data) assert(row.share_preview?.kind, `message ${row.id} has no server-filled share_preview`)
        const eventPreview = data.find((r) => r.share_preview.kind === 'event').share_preview
        const extra = Object.keys(eventPreview).filter((k) => !EVENT_PREVIEW_KEYS.has(k))
        assert(!extra.length, `event preview leaks: ${extra.join(', ')}`)
        // The budget ($4,321 = 432100 cents) and guest count (42) must not appear as values either.
        const leakedValues = Object.entries(eventPreview).filter(([, v]) => [42, 4321, 432100, '42', '4321', '432100'].includes(v))
        assert(!leakedValues.length, `event preview leaks private values: ${JSON.stringify(leakedValues)}`)
        return `event preview keys: ${Object.keys(eventPreview).join(', ')}`
      },
    },
    {
      name: 'recipient can\'t open the private event itself',
      soft: true,
      run: async (ctx) => {
        await ctx.as('clientB')
        eq(await ctx.app.events.getEvent(ctx.state.share.event.id), null, 'non-member reading the event')
        return 'getEvent -> null for a non-member'
      },
    },
    {
      name: 'a client-supplied preview is ignored',
      soft: true,
      run: async (ctx) => {
        const a = await ctx.as('clientA')
        const { data, error } = await a.client
          .from('messages')
          .insert({ conversation_id: ctx.state.share.dm, body: ctx.tag('forged preview'), share_preview: { kind: 'event', title: 'forged', budget_cents: 999 } })
          .select('id, share_preview')
          .single()
        if (error) throw error
        ctx.cleanup.leave('messages', data.id)
        eq(data.share_preview, null, 'stored preview')
        return 'server set share_preview to null'
      },
    },
    {
      name: 'non-members can\'t share someone else\'s event',
      soft: true,
      run: async (ctx) => {
        const a = await ctx.as('clientA')
        await ctx.as('clientB')
        await expectError(
          ctx.app.messages.shareToChats({ profileIds: [a.uid], kind: 'event', id: ctx.state.share.event.id }),
          /only share events you.re part of/i,
          'sharing a foreign event',
        )
        return 'refused'
      },
    },
  ],
}
