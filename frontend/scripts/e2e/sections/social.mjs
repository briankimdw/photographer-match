// Client: follow / unfollow, shortlist, Discover swipes (like / pass / undo),
// taste profile and "% match" (provider_matches).
import { assert, eq, skip } from '../lib/harness.mjs'

export const social = {
  id: 'social',
  title: 'Follows and shortlist',
  roles: ['clientA'],
  steps: [
    {
      name: 'sign in as client',
      run: async (ctx) => {
        const s = await ctx.as('clientA')
        return `${s.username} (${s.uid.slice(0, 8)})`
      },
    },
    {
      name: 'follow a vendor (follows + follower list)',
      run: async (ctx) => {
        const { app } = ctx
        const me = await ctx.as('clientA')
        const following = new Set(await app.social.listFollowing())
        const target = (await ctx.testProviders()).find((p) => !following.has(p.id) && p.profileId !== me.uid)
        if (!target) skip('client already follows every test vendor')
        ctx.state.followTarget = target
        await ctx.as('clientA')
        await app.social.follow(target.id)
        const undo = ctx.cleanup.add('social', `unfollow ${target.slug}`, async () => {
          await ctx.as('clientA')
          await app.social.unfollow(target.id)
        })
        ctx.state.unfollowTask = undo
        assert((await app.social.listFollowing()).includes(target.id), 'listFollowing misses the new follow')
        const followers = await app.social.listFollowers(target.id)
        assert(followers.some((f) => f.id === me.uid), 'listFollowers misses the client')
        ctx.anon()
        const fresh = await app.catalog.getProvider(target.id)
        eq(fresh.followers, target.followers + 1, `${target.slug} follower count`)
        return `${target.name}: ${target.followers} -> ${fresh.followers} followers`
      },
    },
    {
      name: 'unfollow',
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('clientA')
        await app.social.unfollow(state.followTarget.id)
        state.unfollowTask.cancel()
        assert(!(await app.social.listFollowing()).includes(state.followTarget.id), 'still following after unfollow')
        ctx.anon()
        eq((await app.catalog.getProvider(state.followTarget.id)).followers, state.followTarget.followers, 'follower count after unfollow')
        return 'back to the original count'
      },
    },
    {
      name: 'shortlist add + remove',
      run: async (ctx) => {
        const { app } = ctx
        await ctx.as('clientA')
        const saved = new Set(await app.social.listShortlist())
        const target = (await ctx.testProviders()).find((p) => !saved.has(p.id))
        if (!target) skip('everything is already shortlisted')
        await ctx.as('clientA')
        await app.social.addToShortlist(target.id)
        const undo = ctx.cleanup.add('social', `unsave ${target.slug}`, async () => {
          await ctx.as('clientA')
          await app.social.removeFromShortlist(target.id)
        })
        eq((await app.social.listShortlist())[0], target.id, 'newest shortlist entry')
        await app.social.removeFromShortlist(target.id)
        undo.cancel()
        assert(!(await app.social.listShortlist()).includes(target.id), 'still shortlisted after remove')
        return target.name
      },
    },
  ],
}

export const discover = {
  id: 'discover',
  title: 'Discover swipes, taste profile, % match',
  roles: ['clientA'],
  steps: [
    {
      name: 'personal feed (getFeed)',
      run: async (ctx) => {
        await ctx.as('clientA')
        const cards = await ctx.app.discover.getFeed({ limit: 12 })
        assert(cards.length >= 4, `only ${cards.length} cards (need 4; are photos analysed?)`)
        ctx.state.cards = cards
        ctx.state.tasteBefore = await ctx.app.discover.getTasteProfile()
        return `${cards.length} cards; ${cards.filter((c) => c.exploration).length} exploration; profile had ${ctx.state.tasteBefore.likes} likes`
      },
    },
    {
      name: 'swipe like x3 + pass x1 (logSwipe)',
      run: async (ctx) => {
        const { app, state } = ctx
        await ctx.as('clientA')
        state.swipes = []
        const actions = ['like', 'like', 'like', 'pass']
        for (let i = 0; i < actions.length; i++) {
          const id = await app.discover.logSwipe(state.cards[i], actions[i], { dwellMs: 1200, position: i })
          assert(id != null, `logSwipe(${actions[i]}) returned no id`)
          const task = ctx.cleanup.add('social', `undo swipe ${id}`, async () => {
            await ctx.as('clientA')
            await app.discover.undoSwipe(id)
          })
          state.swipes.push({ id, action: actions[i], task })
        }
        return state.swipes.map((s) => `${s.action}#${s.id}`).join(' ')
      },
    },
    {
      name: 'undo the pass (undoSwipe)',
      run: async (ctx) => {
        const { app, state } = ctx
        const me = await ctx.as('clientA')
        const pass = state.swipes.find((s) => s.action === 'pass')
        await app.discover.undoSwipe(pass.id)
        pass.task.cancel()
        const { data, error } = await me.client.from('swipes').select('id').eq('id', pass.id)
        if (error) throw error
        eq(data.length, 0, 'undone swipe rows')
        return `swipe ${pass.id} removed`
      },
    },
    {
      name: 'taste profile counts the likes',
      run: async (ctx) => {
        await ctx.as('clientA')
        const t = await ctx.app.discover.getTasteProfile()
        const before = ctx.state.tasteBefore
        // The profile reads the newest 300 swipes, so a long history can cap the count.
        assert(t.likes >= Math.min(before.likes + 3, 300) || t.swipes >= 300, `likes ${before.likes} -> ${t.likes}, expected +3`)
        return `${t.swipes} swipes, ${t.likes} likes, top styles: ${t.styles.slice(0, 3).map((s) => s.tag).join(', ') || '(no auto-tags yet)'}`
      },
    },
    {
      name: '% match (provider_matches)',
      soft: true,
      run: async (ctx) => {
        const { app } = ctx
        await ctx.as('clientA')
        app.catalog.invalidate('matches')
        const matches = await app.catalog.getMatches()
        if (!matches.size) skip('no matches: needs 3+ likes on photos that have SigLIP embeddings (services/ml worker)')
        for (const [id, pct] of matches) assert(pct >= 55 && pct <= 100, `match ${pct}% for ${id} out of range`)
        const withM = await app.catalog.withMatches(await app.catalog.listProviders())
        const rated = withM.filter((p) => p.tasteMatch != null)
        assert(rated.length > 0, 'withMatches filled in nothing')
        const top = rated.sort((a, b) => b.tasteMatch - a.tasteMatch)[0]
        return `${matches.size} providers matched; top ${top.name} ${top.tasteMatch}%`
      },
    },
  ],
}
