// Checks (anonymously) that the data the signed-in sections rely on is there:
// the role accounts' listings, a verified + an unverified photographer, a caterer
// with capacity, and a package of every price type. Read-only: runs in --dry-run too.
import { assert, eq } from '../lib/harness.mjs'
import { maskEmail } from '../lib/env.mjs'

export default {
  id: 'preflight',
  title: 'Fixtures the signed-in sections need',
  roles: [],
  readOnly: true,
  steps: [
    {
      name: 'role accounts are in docs/test-users.json',
      run: ({ roles }) => Object.values(roles).map((r) => `${r.key}=${r.username} (${maskEmail(r.user.email)})`).join(', '),
    },
    {
      name: 'role listings exist and are active',
      run: async (ctx) => {
        const out = []
        for (const key of ['photographer', 'unverified', 'caterer']) {
          const p = await ctx.listingOf(key)
          assert(p, `${ctx.roles[key].username} has no active listing (slug ${ctx.roles[key].user.slug}); run the seed script + demo data`)
          assert(p.packages.length > 0, `${p.name} has no packages (run supabase/demo/demo_data.sql)`)
          ctx.state[`${key}Listing`] = p
          out.push(`${key}: ${p.name}`)
        }
        return out.join(', ')
      },
    },
    {
      name: 'verification + capacity flags',
      run: async (ctx) => {
        const { client } = ctx.anon()
        const ids = ['photographer', 'unverified', 'caterer'].map((k) => ctx.state[`${k}Listing`].id)
        const { data, error } = await client.from('providers').select('id, slug, identity_verified, max_concurrent').in('id', ids)
        if (error) throw error
        const by = Object.fromEntries(data.map((r) => [r.id, r]))
        const ph = by[ctx.state.photographerListing.id]
        const un = by[ctx.state.unverifiedListing.id]
        const ca = by[ctx.state.catererListing.id]
        eq(ph.identity_verified, true, `${ph.slug} identity_verified`)
        eq(ph.max_concurrent, 1, `${ph.slug} max_concurrent`)
        eq(un.identity_verified, false, `${un.slug} identity_verified`)
        assert(ca.max_concurrent > 1, `${ca.slug} max_concurrent is ${ca.max_concurrent}, expected > 1`)
        ctx.state.catererCapacity = ca.max_concurrent
        return `${ph.slug} verified/cap 1, ${un.slug} unverified, ${ca.slug} cap ${ca.max_concurrent}`
      },
    },
    {
      name: 'a package of every price type',
      run: async (ctx) => {
        const exclude = ['photographer', 'unverified', 'caterer'].map((k) => ctx.state[`${k}Listing`].id)
        const out = []
        const missing = []
        for (const type of ['fixed', 'hourly', 'per_person', 'per_item', 'daily', 'quote']) {
          const hit = await ctx.findPackage(type, { exclude })
          if (hit) out.push(`${type}: ${hit.provider.slug}`)
          else missing.push(type)
        }
        assert(!missing.length, `no test vendor has a ${missing.join(' / ')} package (run supabase/demo/demo_data.sql)`)
        return out.join(', ')
      },
    },
    {
      name: 'role vendors have bookable packages',
      run: async (ctx) => {
        const ph = ctx.state.photographerListing.packages.find((p) => p.priceType === 'fixed' && p.price != null)
        const un = ctx.state.unverifiedListing.packages.find((p) => p.price != null && p.priceType !== 'quote')
        const ca = ctx.state.catererListing.packages.find((p) => p.priceType === 'per_person' && p.price != null)
        assert(ph, `${ctx.state.photographerListing.slug}: no fixed-price package`)
        assert(un, `${ctx.state.unverifiedListing.slug}: no priced package`)
        assert(ca, `${ctx.state.catererListing.slug}: no per-person package`)
        return `${ph.name} ($${ph.price}), ${un.name}, ${ca.name} ($${ca.price}/person, min ${ca.minQuantity ?? '-'})`
      },
    },
  ],
}
