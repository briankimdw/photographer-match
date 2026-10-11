// Stand-in for frontend/src/lib/supabase.js while the e2e test runs (see hooks.mjs).
//
// The app has one browser client per tab. The test needs several signed-in users at
// once (a client, a vendor, an outsider...), so each user gets their own client and
// the `supabase` export below forwards every property access to the *active* one.
// Switching users is synchronous (setActive), and the test runs its steps one at a
// time, so the app's modules always talk to the user the step says they should.
import { createClient } from '@supabase/supabase-js'

let active = null
const clients = new Set()

/** A fresh client with the publishable key; sessions live in memory only (never written to disk). */
export function makeClient() {
  const env = globalThis.__E2E_VITE_ENV__ || {}
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing (frontend/.env.local)')
  }
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  clients.add(client)
  return client
}

export function setActive(client) {
  active = client
}
export const getActive = () => active

/** Close every realtime socket so the process can exit. */
export async function closeAll() {
  for (const c of clients) {
    try {
      await c.removeAllChannels()
    } catch {
      /* already closed */
    }
  }
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!active) throw new Error('e2e: no active Supabase client (call setActive first)')
      const value = active[prop]
      return typeof value === 'function' ? value.bind(active) : value
    },
  },
)
