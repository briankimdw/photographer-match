// Configuration: the publishable Supabase key from frontend/.env.local and the
// throwaway test logins from docs/test-users.json. Nothing here is ever printed
// except masked emails and usernames.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const FRONTEND_DIR = resolve(here, '..', '..', '..')
export const REPO_DIR = resolve(FRONTEND_DIR, '..')
export const E2E_DIR = resolve(here, '..')

/** KEY=value lines of a dotenv file (no expansion, no quotes handling beyond trimming). */
export function parseDotenv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

export function loadEnv() {
  const path = resolve(FRONTEND_DIR, '.env.local')
  const file = existsSync(path) ? parseDotenv(readFileSync(path, 'utf8')) : {}
  const env = {
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || file.VITE_SUPABASE_URL || '',
    VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY || file.VITE_SUPABASE_PUBLISHABLE_KEY || '',
    VITE_ML_URL: process.env.VITE_ML_URL || file.VITE_ML_URL || 'http://localhost:8000',
    DEV: false, // the planner's dev mock stays off: the test talks to the real service
    PROD: true,
    MODE: 'e2e',
  }
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('frontend/.env.local needs VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (see frontend/.env.example).')
  }
  if (/service_role|sb_secret_/i.test(env.VITE_SUPABASE_PUBLISHABLE_KEY) || isServiceRoleJwt(env.VITE_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error('The key in frontend/.env.local looks like a SERVICE ROLE / secret key. The e2e test only runs with the publishable key.')
  }
  return env
}

function isServiceRoleJwt(key) {
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'service_role'
  } catch {
    return false
  }
}

/** "ktjvbajrfrbwpndforcy" from https://ktjvbajrfrbwpndforcy.supabase.co */
export const projectRef = (url) => {
  try {
    return new URL(url).hostname.split('.')[0]
  } catch {
    return '?'
  }
}

export function loadTestUsers(path = resolve(REPO_DIR, 'docs', 'test-users.json')) {
  if (!existsSync(path)) throw new Error('docs/test-users.json is missing (see docs/test-users.md).')
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const all = []
  for (const list of ['photographers', 'vendors', 'clients']) {
    for (const p of data[list] || []) all.push({ ...p, list, vertical: p.vertical || (list === 'photographers' ? 'photography' : null) })
  }
  return all
}

/** Find a test user by username; throws a readable error if it isn't in the file. */
export function findUser(users, username) {
  const u = users.find((x) => x.username === username)
  if (!u) throw new Error(`Test user "${username}" is not in docs/test-users.json`)
  if (!u.email || !u.password) throw new Error(`Test user "${username}" has no email/password in docs/test-users.json`)
  return u
}

/**
 * Mask an email for logs: "jordanlee.test@example.com" -> "jor…@example.com".
 * Short local parts (4 chars or fewer) stay as they are.
 */
export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return '***'
  const [local, domain] = [email.slice(0, email.lastIndexOf('@')), email.slice(email.lastIndexOf('@') + 1)]
  return local.length <= 4 ? `${local}@${domain}` : `${local.slice(0, 3)}…@${domain}`
}

/** Remove anything that looks like a secret from a string before it is printed or saved. */
export function redact(text, secrets = []) {
  let out = String(text ?? '')
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]')
  // JWTs (access tokens) and bearer headers.
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[token]')
  out = out.replace(/(Bearer\s+)[^\s"']+/gi, '$1[token]')
  // Emails.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m))
  return out
}
