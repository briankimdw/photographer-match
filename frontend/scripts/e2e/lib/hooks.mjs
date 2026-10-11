// Node module hooks that let the app's own data layer (frontend/src/api/*.js) run
// under plain Node, unchanged:
//   1. `import.meta.env` (a Vite feature) is rewritten to `globalThis.__E2E_VITE_ENV__`
//      in files under frontend/src/.
//   2. `frontend/src/lib/supabase.js` (the browser's singleton client) is redirected to
//      ./supabase-shim.mjs, whose `supabase` export forwards to whichever test user is
//      "active". So `listMyBookings()` runs as the client, `listProviderBookings()` as
//      the vendor, and so on, through the exact same query code the screens use.
//
// Installed by ./shim.mjs with module.registerHooks (Node >= 22.15 / 23.5).
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const SRC_DIR_URL = pathToFileURL(resolve(here, '..', '..', '..', 'src')).href + '/'
export const SHIM_URL = pathToFileURL(resolve(here, 'supabase-shim.mjs')).href
const CLIENT_URL = `${SRC_DIR_URL}lib/supabase.js`

const sameUrl = (a, b) => a.toLowerCase() === b.toLowerCase() // Windows drive letters may differ in case

export function resolveHook(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context)
  if (result?.url && sameUrl(result.url, CLIENT_URL)) return { url: SHIM_URL, format: 'module', shortCircuit: true }
  return result
}

/** The source rewrite, exported for the unit tests. */
export const rewriteEnv = (source) => source.replaceAll('import.meta.env', 'globalThis.__E2E_VITE_ENV__')

export function loadHook(url, context, nextLoad) {
  const result = nextLoad(url, context)
  if (!url.toLowerCase().startsWith(SRC_DIR_URL.toLowerCase()) || result.source == null) return result
  const text = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8')
  if (!text.includes('import.meta.env')) return result
  return { ...result, format: result.format || 'module', source: rewriteEnv(text) }
}
