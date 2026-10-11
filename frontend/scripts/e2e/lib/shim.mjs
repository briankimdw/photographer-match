// Make the browser-flavoured app modules importable from Node:
//   - module hooks (hooks.mjs): import.meta.env + the per-user Supabase client
//   - tiny stand-ins for browser globals the API files touch: localStorage /
//     sessionStorage (events.js remembers planner briefs), location (planner.js),
//     XMLHttpRequest (portfolio.js uploads with XHR for progress; here it's fetch).
import module from 'node:module'
import { loadHook, resolveHook } from './hooks.mjs'

class MemoryStorage {
  #m = new Map()
  get length() {
    return this.#m.size
  }
  key(i) {
    return [...this.#m.keys()][i] ?? null
  }
  getItem(k) {
    return this.#m.has(String(k)) ? this.#m.get(String(k)) : null
  }
  setItem(k, v) {
    this.#m.set(String(k), String(v))
  }
  removeItem(k) {
    this.#m.delete(String(k))
  }
  clear() {
    this.#m.clear()
  }
}

/** XMLHttpRequest, just enough for portfolio.js uploadFile(): POST a Blob, report status. */
export class FetchXHR {
  constructor() {
    this.upload = { onprogress: null }
    this.onload = null
    this.onerror = null
    this.status = 0
    this.responseText = ''
    this._headers = {}
  }
  open(method, url) {
    this._method = method
    this._url = url
  }
  setRequestHeader(k, v) {
    this._headers[k] = v
  }
  send(body) {
    fetch(this._url, { method: this._method, headers: this._headers, body })
      .then(async (res) => {
        const size = body?.size ?? 0
        this.upload.onprogress?.({ lengthComputable: true, loaded: size, total: size })
        this.status = res.status
        this.responseText = await res.text()
        this.onload?.()
      })
      .catch(() => this.onerror?.())
  }
}

let installed = false
export function installShim(env) {
  globalThis.__E2E_VITE_ENV__ = env
  if (installed) return
  installed = true
  if (typeof module.registerHooks !== 'function') {
    throw new Error(`Node ${process.versions.node} is too old: the e2e test needs Node 22.15+ (module.registerHooks).`)
  }
  module.registerHooks({ resolve: resolveHook, load: loadHook })
  if (!globalThis.localStorage) globalThis.localStorage = new MemoryStorage()
  if (!globalThis.sessionStorage) globalThis.sessionStorage = new MemoryStorage()
  if (!globalThis.location) globalThis.location = { hostname: 'localhost', origin: 'http://localhost:5173', search: '', href: 'http://localhost:5173/' }
  if (!globalThis.XMLHttpRequest) globalThis.XMLHttpRequest = FetchXHR
}

/** Import the app's data layer (after installShim). */
export async function loadApp() {
  const [shim, catalog, bookings, discover, social, messages, events, portfolio, provider, planner, format] = await Promise.all([
    import('./supabase-shim.mjs'),
    import('../../../src/api/catalog.js'),
    import('../../../src/api/bookings.js'),
    import('../../../src/api/discover.js'),
    import('../../../src/api/social.js'),
    import('../../../src/api/messages.js'),
    import('../../../src/api/events.js'),
    import('../../../src/api/portfolio.js'),
    import('../../../src/api/provider.js'),
    import('../../../src/api/planner.js'),
    import('../../../src/lib/format.js'),
  ])
  const verticals = await import('../../../src/verticals/index.js')
  return { shim, catalog, bookings, discover, social, messages, events, portfolio, provider, planner, format, verticals }
}
