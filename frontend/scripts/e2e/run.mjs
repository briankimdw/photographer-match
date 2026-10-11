#!/usr/bin/env node
// End-to-end test of every backend feature, against the real Supabase project,
// signed in as the throwaway test users from docs/test-users.json, through the
// app's own data layer (frontend/src/api/*.js). See README.md next to this file.
//
//   cd frontend
//   node scripts/e2e/run.mjs                  # everything
//   node scripts/e2e/run.mjs --dry-run        # anon checks for real + the plan (no sign-in)
//   node scripts/e2e/run.mjs --only messaging,events
//   node scripts/e2e/run.mjs --keep           # leave the [e2e] data in place
//   node scripts/e2e/run.mjs --pause-for-payment   # also test deliver / complete / reviews
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { E2E_DIR, loadEnv, loadTestUsers, maskEmail, projectRef, redact } from './lib/env.mjs'
import { installShim, loadApp } from './lib/shim.mjs'
import { createRunner, formatTable, summarize } from './lib/harness.mjs'
import { Cleanup } from './lib/cleanup.mjs'
import { ROLES, createContext, makeRunId } from './lib/context.mjs'
import anon from './sections/anon.mjs'
import preflight from './sections/preflight.mjs'
import { discover, social } from './sections/social.mjs'
import { capacity, lifecycle, pricing } from './sections/bookings.mjs'
import { messaging, sharing } from './sections/messaging.mjs'
import events from './sections/events.mjs'
import { listing, posting } from './sections/posting.mjs'
import planner from './sections/planner.mjs'
import rls from './sections/rls.mjs'

export const SECTIONS = [anon, preflight, social, discover, pricing, lifecycle, capacity, messaging, sharing, events, posting, listing, planner, rls]
const REPORT_PATH = resolve(E2E_DIR, 'last-report.json')
const SQL_PATH = resolve(E2E_DIR, 'last-cleanup.sql')

const HELP = `Usage: node scripts/e2e/run.mjs [options]

  --dry-run              run the signed-out checks for real, print the signed-in plan; no sign-in
  --only <a,b,...>       only these areas: ${SECTIONS.map((s) => s.id).join(', ')}
  --keep                 skip cleanup (the [e2e] data stays; ids go to last-cleanup.sql)
  --verbose              full error details and progress
  --pause-for-payment    pause after "accepted" so you can mark the booking paid in the SQL editor,
                         then test deliver, complete, double-blind reviews and ratings
  --realtime-timeout <s> seconds to wait for a realtime message (default 10)
  --help`

export function parseArgs(argv) {
  const opts = { dryRun: false, keep: false, verbose: false, pauseForPayment: false, only: null, realtimeTimeoutMs: 10_000, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]
      if (v == null || v.startsWith('--')) throw new Error(`${a.split('=')[0]} needs a value`)
      return v
    }
    if (a === '--dry-run') opts.dryRun = true
    else if (a === '--keep') opts.keep = true
    else if (a === '--verbose' || a === '-v') opts.verbose = true
    else if (a === '--pause-for-payment') opts.pauseForPayment = true
    else if (a === '--help' || a === '-h') opts.help = true
    else if (a.startsWith('--only')) opts.only = value().split(',').map((s) => s.trim()).filter(Boolean)
    else if (a.startsWith('--realtime-timeout')) opts.realtimeTimeoutMs = Math.max(1, Number(value())) * 1000
    else throw new Error(`Unknown option ${a}`)
  }
  return opts
}

/** Which sections run, in order. preflight joins whenever a signed-in section is picked. */
export function selectSections(only, all = SECTIONS) {
  if (!only) return all
  const unknown = only.filter((id) => !all.some((s) => s.id === id))
  if (unknown.length) throw new Error(`Unknown area(s): ${unknown.join(', ')}. Pick from: ${all.map((s) => s.id).join(', ')}`)
  const wanted = new Set(only)
  if (all.some((s) => wanted.has(s.id) && !s.readOnly)) wanted.add('preflight')
  return all.filter((s) => wanted.has(s.id))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log(HELP)
    return 0
  }
  const tty = process.stdout.isTTY
  const env = loadEnv()
  const users = loadTestUsers()
  const secrets = [env.VITE_SUPABASE_PUBLISHABLE_KEY, ...users.map((u) => u.password)]
  const clean = (s) => redact(s, secrets)
  const log = {
    info: (s) => console.log(clean(s)),
    debug: (s) => opts.verbose && console.log(clean(`  · ${s}`)),
    prompt: (s) => console.log(s),
    warn: (s) => console.warn(clean(s)),
  }

  installShim(env)
  const app = await loadApp()
  const runId = makeRunId()
  const cleanup = new Cleanup()
  const ctx = createContext({ app, env, users, cleanup, runId, opts, log, secrets })
  const sections = selectSections(opts.only)
  const runnable = opts.dryRun ? sections.filter((s) => s.readOnly) : sections
  const planned = opts.dryRun ? sections.filter((s) => !s.readOnly) : []
  const startedAt = new Date()

  log.info(`e2e ${opts.dryRun ? 'DRY RUN' : 'run'} ${runId} against project ${projectRef(env.VITE_SUPABASE_URL)} (publishable key; Node ${process.versions.node})`)
  if (!opts.dryRun) {
    const used = new Set(runnable.flatMap((s) => s.roles))
    log.info(`Signing in as: ${[...used].map((k) => `${ROLES[k].username} (${maskEmail(ctx.roles[k].user.email)})`).join(', ') || 'nobody'}`)
  }
  log.info('')

  const symbols = { pass: tty ? '\x1b[32m✓\x1b[0m' : 'PASS', fail: tty ? '\x1b[31m✗\x1b[0m' : 'FAIL', skip: tty ? '\x1b[33m-\x1b[0m' : 'SKIP' }
  const runner = createRunner({
    redact: clean,
    onResult: (r) => log.info(`  ${symbols[r.status]} ${r.section} › ${r.step}${r.status === 'pass' ? '' : `: ${r.detail}`}`),
  })

  let finished = false
  let cleanupResults = []
  const finish = async (reason) => {
    if (finished) return
    finished = true
    if (!opts.keep && !opts.dryRun && cleanup.ordered().length) {
      log.info(`\nCleaning up (${reason}): ${cleanup.ordered().length} task(s)`)
      cleanupResults = await cleanup.run({ onTask: (t) => (t.ok ? log.debug(`cleanup ok: ${t.label}`) : log.warn(`  cleanup FAILED: ${t.label}: ${clean(t.error)}`)) })
    }
    await ctx.signOutAll()
    await app.shim.closeAll()
  }

  process.on('unhandledRejection', (e) => log.debug(`unhandled rejection: ${e?.message || e}`))
  process.on('SIGINT', async () => {
    log.warn('\nInterrupted: cleaning up before exit...')
    await finish('interrupted').catch(() => {})
    writeReport({ interrupted: true })
    process.exit(130)
  })

  const writeReport = (extra = {}) => {
    const summary = summarize(runner.results)
    const cleanupFailed = cleanupResults.filter((t) => !t.ok)
    const leftovers = Object.fromEntries(Object.entries(cleanup.leftovers).map(([k, v]) => [k, [...v]]))
    const sql = cleanup.leftoverSql({ runId, when: startedAt.toISOString() })
    if (!opts.dryRun) writeFileSync(SQL_PATH, sql)
    const report = {
      tool: 'photographer-match e2e',
      runId,
      mode: opts.dryRun ? 'dry-run' : 'full',
      project: projectRef(env.VITE_SUPABASE_URL),
      node: process.versions.node,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt.getTime(),
      options: { only: opts.only, keep: opts.keep, pauseForPayment: opts.pauseForPayment, realtimeTimeoutMs: opts.realtimeTimeoutMs },
      roles: Object.fromEntries(Object.entries(ctx.roles).map(([k, r]) => [k, r.username])),
      summary: { ...summary, cleanupFailed: cleanupFailed.length },
      results: runner.results,
      cleanup: { skipped: opts.keep || opts.dryRun, tasks: cleanupResults.map((t) => ({ ...t, error: t.error && clean(t.error) })), pending: cleanup.pending() },
      leftovers: { ...leftovers, sqlFile: opts.dryRun ? null : 'frontend/scripts/e2e/last-cleanup.sql' },
      planned: planned.map((s) => ({ section: s.id, title: s.title, roles: s.roles.map((k) => ROLES[k].username), steps: s.steps.map((x) => x.name) })),
      ...extra,
    }
    writeFileSync(REPORT_PATH, `${clean(JSON.stringify(report, null, 2))}\n`)
    return { summary, cleanupFailed }
  }

  try {
    for (const section of runnable) {
      log.info(`${section.title} [${section.id}]`)
      await runner.runSection(section, ctx)
    }
  } finally {
    await finish('end of run')
  }

  const { summary, cleanupFailed } = writeReport()
  log.info(`\n${formatTable(runner.results, { tty, verbose: opts.verbose, width: Math.max(100, process.stdout.columns || 150) })}`)

  if (planned.length) {
    log.info('\nPlanned signed-in steps (not run in --dry-run):')
    for (const s of planned) {
      log.info(`\n  ${s.title} [${s.id}]  as ${s.roles.map((k) => ROLES[k].username).join(', ')}`)
      for (const step of s.steps) log.info(`    - ${step.name}`)
    }
  }

  log.info(`\n${summary.pass} passed, ${summary.fail} failed, ${summary.skip} skipped (${summary.total} steps, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)
  if (!opts.dryRun) {
    if (opts.keep) log.info(`--keep: nothing was cleaned up. ${cleanup.pending().length} undo task(s) skipped.`)
    else log.info(`Cleanup: ${cleanupResults.length - cleanupFailed.length}/${cleanupResults.length} tasks ok.`)
    if (cleanup.hasLeftovers()) {
      const n = Object.values(cleanup.leftovers).reduce((s, v) => s + v.size, 0)
      log.info(`${n} [e2e] row(s) the API can't delete (cancelled bookings, chat messages, the hidden 2nd listing) are listed in`)
      log.info('frontend/scripts/e2e/last-cleanup.sql: paste it into the Supabase SQL editor to remove them (optional).')
    }
  }
  log.info('Report: frontend/scripts/e2e/last-report.json')
  return summary.fail > 0 || cleanupFailed.length > 0 ? 1 : 0
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(E2E_DIR, 'run.mjs')
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`e2e: ${e?.message || e}`)
      process.exit(2)
    })
}
