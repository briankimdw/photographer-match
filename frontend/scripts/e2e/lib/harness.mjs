// A small step runner: sections of named steps, pass / fail / skip, a readable
// table and a JSON-friendly result list. No dependencies.

export class Skip extends Error {
  constructor(reason) {
    super(reason)
    this.name = 'Skip'
  }
}
/** Stop the current step and record it as skipped. */
export const skip = (reason) => {
  throw new Skip(reason)
}

export class AssertionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AssertionError'
  }
}

export function assert(cond, message = 'assertion failed') {
  if (!cond) throw new AssertionError(message)
}

const show = (v) => {
  try {
    return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}
export function eq(actual, expected, label = 'value') {
  if (actual !== expected) throw new AssertionError(`${label}: expected ${show(expected)}, got ${show(actual)}`)
}

/** Expect `fn()` (or a promise) to reject; optional regex on the message. Returns the message. */
export async function expectError(fnOrPromise, pattern = null, label = 'call') {
  let error = null
  try {
    await (typeof fnOrPromise === 'function' ? fnOrPromise() : fnOrPromise)
  } catch (e) {
    error = e
  }
  if (!error) throw new AssertionError(`${label} should have failed, but it succeeded`)
  const msg = errorText(error)
  if (pattern && !pattern.test(msg)) throw new AssertionError(`${label} failed with an unexpected error: ${msg}`)
  return msg
}

/** Supabase errors are plain objects ({ message, code, details }); Errors have .message. */
export const errorText = (e) => {
  if (!e) return ''
  if (typeof e === 'string') return e
  const parts = [e.message, e.details, e.hint].filter(Boolean)
  const text = parts.join(' · ') || (() => { try { return JSON.stringify(e) } catch { return String(e) } })()
  return e.code && !text.includes(e.code) ? `${text} [${e.code}]` : text
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function withTimeout(promise, ms, label) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AssertionError(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** Poll `fn` until it returns a truthy value (returned) or the time runs out (null). */
export async function waitFor(fn, { timeoutMs = 10_000, intervalMs = 250 } = {}) {
  const until = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() >= until) return null
    await sleep(intervalMs)
  }
}

/**
 * section: { id, title, roles: [roleKey], steps: [{ name, run(ctx), soft?, always?, timeoutMs? }] }
 *   soft:   a failure doesn't block the steps after it (independent checks).
 *   always: runs even if an earlier step in the section failed (e.g. its own tidy-up).
 * Otherwise the first failure marks the rest of the section "blocked".
 */
export function createRunner({ onResult = () => {}, defaultTimeoutMs = 90_000, redact = (s) => s } = {}) {
  const results = []
  async function runSection(section, ctx) {
    let blockedBy = null
    for (const step of section.steps) {
      const base = { section: section.id, step: step.name }
      if (blockedBy && !step.always) {
        const r = { ...base, status: 'skip', ms: 0, detail: `blocked: "${blockedBy}" failed` }
        results.push(r)
        onResult(r)
        continue
      }
      const t0 = Date.now()
      let r
      try {
        const detail = await withTimeout(Promise.resolve().then(() => step.run(ctx)), step.timeoutMs ?? defaultTimeoutMs, step.name)
        r = { ...base, status: 'pass', ms: Date.now() - t0, detail: detail == null ? '' : redact(String(detail)) }
      } catch (e) {
        if (e instanceof Skip) r = { ...base, status: 'skip', ms: Date.now() - t0, detail: redact(e.message) }
        else {
          r = { ...base, status: 'fail', ms: Date.now() - t0, detail: redact(errorText(e)) }
          if (!step.soft) blockedBy = step.name
        }
      }
      results.push(r)
      onResult(r)
    }
  }
  return { results, runSection }
}

// ---- output -------------------------------------------------------------------

const color = (on) => ({
  green: (s) => (on ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s) => (on ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s) => (on ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s) => (on ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (on ? `\x1b[1m${s}\x1b[0m` : s),
})

const LABEL = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The pass/fail table as text. */
export function formatTable(results, { tty = false, width = 150, verbose = false } = {}) {
  const c = color(tty)
  const secW = Math.max(7, ...results.map((r) => r.section.length))
  const stepW = Math.min(52, Math.max(4, ...results.map((r) => r.step.length)))
  const detailW = Math.max(20, width - secW - stepW - 18)
  const lines = []
  lines.push(c.bold(`${'Section'.padEnd(secW)}  ${'Step'.padEnd(stepW)}  Result  ${'Time'.padStart(6)}  Detail`))
  lines.push('-'.repeat(Math.min(width, secW + stepW + 18 + detailW)))
  let last = null
  for (const r of results) {
    const sec = r.section === last ? ''.padEnd(secW) : r.section.padEnd(secW)
    last = r.section
    const tag = r.status === 'pass' ? c.green(LABEL.pass) : r.status === 'fail' ? c.red(LABEL.fail) : c.yellow(LABEL.skip)
    const time = r.ms >= 1000 ? `${(r.ms / 1000).toFixed(1)}s` : `${r.ms}ms`
    const detail = verbose ? r.detail || '' : truncate((r.detail || '').replace(/\s+/g, ' '), detailW)
    lines.push(`${sec}  ${truncate(r.step, stepW).padEnd(stepW)}  ${tag}    ${time.padStart(6)}  ${r.status === 'pass' ? c.dim(detail) : detail}`)
  }
  return lines.join('\n')
}

export function summarize(results) {
  const s = { pass: 0, fail: 0, skip: 0, total: results.length }
  for (const r of results) s[r.status]++
  return s
}
