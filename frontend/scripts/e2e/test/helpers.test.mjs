// Unit tests for the e2e helpers. No network, no sign-in.
//   cd frontend && node --test scripts/e2e/test/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { QuantityError, amountsOf, diffAmounts, expectedBooking, pickQuantity } from '../lib/pricing.mjs'
import { maskEmail, parseDotenv, redact, E2E_DIR } from '../lib/env.mjs'
import { Cleanup, PHASES } from '../lib/cleanup.mjs'
import { jpegSize, solidJpeg } from '../lib/jpeg.mjs'
import { Skip, createRunner, expectError, formatTable, summarize } from '../lib/harness.mjs'
import { ROLES, dateAllocator, makeRunId } from '../lib/context.mjs'
import { SHIM_URL, SRC_DIR_URL, resolveHook, rewriteEnv } from '../lib/hooks.mjs'
import { SECTIONS, parseArgs, selectSections } from '../run.mjs'

const pkg = (o) => ({ priceType: 'fixed', price: 100, hours: null, minQuantity: null, maxQuantity: null, depositPct: 30, ...o })

// ---- pricing (mirrors request_booking) -----------------------------------------

test('fixed: price + add-ons, deposit rounded', () => {
  const e = expectedBooking(pkg({ price: 1200, depositPct: 30 }), { addonCents: [15000, 2500] })
  assert.deepEqual(e, { minutes: 120, quantity: null, subtotal: 120000, addons: 17500, total: 137500, deposit: 41250 })
})

test('fixed: package duration is used for the time range', () => {
  assert.equal(expectedBooking(pkg({ hours: 6 })).minutes, 360)
})

test('hourly: price x hours, hours from the request, else the package, else 1', () => {
  assert.equal(expectedBooking(pkg({ priceType: 'hourly', price: 150 }), { hours: 3 }).subtotal, 45000)
  assert.equal(expectedBooking(pkg({ priceType: 'hourly', price: 150, hours: 2 })).subtotal, 30000)
  assert.equal(expectedBooking(pkg({ priceType: 'hourly', price: 150 })).subtotal, 15000)
  assert.equal(expectedBooking(pkg({ priceType: 'hourly', price: 150 }), { hours: 1.5 }).minutes, 90)
})

test('hourly: fractional cents round like Postgres', () => {
  // 10.01/h for 50 minutes = 834.1666 cents -> 834
  assert.equal(expectedBooking(pkg({ priceType: 'hourly', price: 10.01 }), { hours: 50 / 60 }).subtotal, 834)
})

test('per_person: price x guests; defaults to the minimum', () => {
  const p = pkg({ priceType: 'per_person', price: 65, minQuantity: 40, maxQuantity: 400, depositPct: 25 })
  assert.deepEqual(expectedBooking(p, { quantity: 45 }), { minutes: 120, quantity: 45, subtotal: 292500, addons: 0, total: 292500, deposit: 73125 })
  assert.equal(expectedBooking(p).quantity, 40)
  assert.throws(() => expectedBooking(p, { quantity: 39 }), QuantityError)
  assert.throws(() => expectedBooking(p, { quantity: 401 }), QuantityError)
  assert.throws(() => expectedBooking(p, { quantity: 0 }), QuantityError)
})

test('per_item without a minimum needs a quantity', () => {
  assert.throws(() => expectedBooking(pkg({ priceType: 'per_item', price: 8 })), /pieces/)
  assert.equal(expectedBooking(pkg({ priceType: 'per_item', price: 8.5 }), { quantity: 3 }).total, 2550)
})

test('daily: one price per booked day, 12h by default', () => {
  const e = expectedBooking(pkg({ priceType: 'daily', price: 3500 }))
  assert.equal(e.total, 350000)
  assert.equal(e.minutes, 720)
})

test('quote: no amounts', () => {
  const e = expectedBooking(pkg({ priceType: 'quote', price: null }), { addonCents: [5000] })
  assert.equal(e.subtotal, null)
  assert.equal(e.total, null)
  assert.equal(e.deposit, null)
})

test('deposit rounds half up (round(1005 x 30 / 100) = 302)', () => {
  assert.equal(expectedBooking(pkg({ price: 10.05, depositPct: 30 })).deposit, 302)
})

test('pickQuantity stays within the package limits', () => {
  assert.equal(pickQuantity(pkg({ minQuantity: 40 })), 45)
  assert.equal(pickQuantity(pkg({ minQuantity: 40, maxQuantity: 42 })), 42)
  assert.equal(pickQuantity(pkg({})), 6)
})

test('amountsOf / diffAmounts compare a booking row', () => {
  const row = { subtotal_cents: 100, addons_cents: 0, total_cents: 100, deposit_cents: 30, quantity: null }
  assert.equal(diffAmounts({ subtotal: 100, addons: 0, total: 100, deposit: 30, quantity: null }, amountsOf(row)), '')
  assert.match(diffAmounts({ subtotal: 100, addons: 0, total: 101, deposit: 30, quantity: null }, amountsOf(row)), /total: expected 101, got 100/)
})

// ---- masking + secrets ------------------------------------------------------------

test('maskEmail', () => {
  assert.equal(maskEmail('jordanlee.test@example.com'), 'jor…@example.com')
  assert.equal(maskEmail('kai@example.com'), 'kai@example.com')
  assert.equal(maskEmail('not-an-email'), '***')
  assert.equal(maskEmail(undefined), '***')
})

test('redact removes passwords, tokens and full emails', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstu'
  const out = redact(`pw kXqB-hR8N-s9MS! token ${jwt} Authorization: Bearer abc.def mail jordanlee.test@example.com`, ['kXqB-hR8N-s9MS!'])
  assert.ok(!out.includes('kXqB-hR8N-s9MS!'))
  assert.ok(!out.includes(jwt))
  assert.ok(!out.includes('abc.def'))
  assert.ok(!out.includes('jordanlee.test@'))
  assert.match(out, /jor…@example\.com/)
})

test('parseDotenv', () => {
  assert.deepEqual(parseDotenv('# c\nVITE_A=1\r\nVITE_B="two"\nnot a line\n'), { VITE_A: '1', VITE_B: 'two' })
})

// ---- cleanup ordering + leftover SQL -------------------------------------------------

test('cleanup runs by phase, newest first within a phase, each once', async () => {
  const c = new Cleanup()
  const ran = []
  const add = (phase, label) => c.add(phase, label, async () => ran.push(label))
  add('social', 'unfollow')
  add('bookings', 'cancel 1')
  add('listing', 'hide listing')
  add('events', 'delete event')
  add('bookings', 'cancel 2')
  add('chats', 'leave group')
  add('content', 'delete post')
  const cancelled = add('social', 'undo swipe')
  cancelled.cancel()
  assert.deepEqual(c.ordered().map((t) => t.label), ['cancel 2', 'cancel 1', 'delete event', 'leave group', 'delete post', 'unfollow', 'hide listing'])
  await c.run()
  await c.run() // second run does nothing
  assert.deepEqual(ran, ['cancel 2', 'cancel 1', 'delete event', 'leave group', 'delete post', 'unfollow', 'hide listing'])
})

test('cleanup keeps going after a failing task and reports it', async () => {
  const c = new Cleanup()
  const ran = []
  c.add('bookings', 'boom', async () => {
    throw new Error('nope')
  })
  c.add('events', 'after', async () => ran.push('after'))
  const out = await c.run()
  assert.deepEqual(ran, ['after'])
  assert.equal(out[0].ok, false)
  assert.equal(out[0].error, 'nope')
  assert.equal(out[1].ok, true)
})

test('cleanup phases: bookings are cancelled before events are deleted, listing hidden last', () => {
  assert.ok(PHASES.bookings < PHASES.events && PHASES.events < PHASES.chats && PHASES.chats < PHASES.content && PHASES.listing > PHASES.social)
  assert.throws(() => new Cleanup().add('nope', 'x', () => {}))
})

test('leftover SQL lists exact ids, deletes children first, recomputes ratings last', () => {
  const c = new Cleanup()
  assert.match(c.leftoverSql({ runId: 'r1' }), /Nothing left over/)
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`
  c.leave('messages', id(1))
  c.leave('conversations', id(2))
  c.leave('bookings', id(3))
  c.leave('providers', id(4))
  c.touchRatings({ providerId: id(5), profileId: id(6) })
  assert.throws(() => c.leave('bookings', "x'); drop table bookings; --"), /Not a uuid/)
  assert.throws(() => c.leave('profiles', id(1)), /Unknown leftover kind/)
  const sql = c.leftoverSql({ runId: 'r1' })
  const order = ['delete from public.messages', 'delete from public.conversations', 'delete from public.bookings', 'delete from public.packages', 'delete from public.providers', 'update public.providers', 'update public.profiles', 'commit;']
  let last = -1
  for (const s of order) {
    const at = sql.indexOf(s)
    assert.ok(at > last, `${s} out of order`)
    last = at
  }
  for (let n = 1; n <= 6; n++) assert.ok(sql.includes(id(n)))
})

// ---- JPEG -------------------------------------------------------------------------

test('solidJpeg makes a well-formed baseline JPEG', () => {
  for (const [size, gray] of [[8, 128], [16, 180], [32, 0], [24, 255]]) {
    const b = solidJpeg({ size, gray })
    assert.deepEqual([b[0], b[1]], [0xff, 0xd8], 'SOI')
    assert.deepEqual([b.at(-2), b.at(-1)], [0xff, 0xd9], 'EOI')
    assert.deepEqual(jpegSize(b), { width: size, height: size })
    // Entropy data (after the SOS header) must not contain an unstuffed 0xFF.
    const sos = b.findIndex((x, i) => x === 0xff && b[i + 1] === 0xda)
    const data = b.slice(sos + 2 + ((b[sos + 2] << 8) | b[sos + 3]), -2)
    data.forEach((x, i) => x === 0xff && assert.equal(data[i + 1], 0x00, 'stuffed 0xFF'))
  }
  assert.throws(() => solidJpeg({ size: 10 }))
})

// ---- harness -------------------------------------------------------------------------

test('runner: failure blocks the rest, soft and always steps, skips', async () => {
  const { results, runSection } = createRunner()
  await runSection(
    {
      id: 's',
      steps: [
        { name: 'ok', run: () => 'fine' },
        { name: 'soft fail', soft: true, run: () => { throw new Error('meh') } },
        { name: 'skipped', run: () => { throw new Skip('not today') } },
        { name: 'hard fail', run: () => { throw { message: 'db said no', code: '42501' } } },
        { name: 'blocked', run: () => 'never' },
        { name: 'tidy', always: true, run: () => 'tidied' },
      ],
    },
    {},
  )
  assert.deepEqual(results.map((r) => r.status), ['pass', 'fail', 'skip', 'fail', 'skip', 'pass'])
  assert.match(results[3].detail, /db said no \[42501\]/)
  assert.match(results[4].detail, /blocked: "hard fail" failed/)
  assert.deepEqual(summarize(results), { pass: 2, fail: 2, skip: 2, total: 6 })
  const table = formatTable(results)
  assert.match(table, /PASS/)
  assert.match(table, /FAIL/)
})

test('runner times out a hanging step', async () => {
  const { results, runSection } = createRunner()
  await runSection({ id: 't', steps: [{ name: 'hang', timeoutMs: 50, run: () => new Promise(() => {}) }] }, {})
  assert.equal(results[0].status, 'fail')
  assert.match(results[0].detail, /timed out/)
})

test('expectError', async () => {
  assert.match(await expectError(Promise.reject(new Error('already booked')), /booked/), /already/)
  await assert.rejects(expectError(Promise.resolve(1)), /should have failed/)
  await assert.rejects(expectError(Promise.reject(new Error('other')), /booked/), /unexpected error/)
})

// ---- context, args, hooks ---------------------------------------------------------

test('dates are far in the future, distinct, and stable per run id', () => {
  const from = new Date(2026, 9, 10)
  const a = dateAllocator('abc1234', { from })
  const b = dateAllocator('abc1234', { from })
  const first = a.next()
  assert.equal(first, b.next())
  assert.notEqual(first, a.next())
  const days = (new Date(`${first}T12:00:00`) - from) / 86400000
  assert.ok(days >= 320 && days < 521, `${days} days ahead`)
  assert.match(makeRunId(), /^[0-9a-z]{7}$/)
})

test('parseArgs + selectSections', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--only', 'events,rls', '--keep', '--realtime-timeout=5']), {
    dryRun: true, keep: true, verbose: false, pauseForPayment: false, only: ['events', 'rls'], realtimeTimeoutMs: 5000, help: false,
  })
  assert.throws(() => parseArgs(['--nope']), /Unknown option/)
  assert.throws(() => parseArgs(['--only']), /needs a value/)
  assert.deepEqual(selectSections(['rls', 'events']).map((s) => s.id), ['preflight', 'events', 'rls'])
  assert.deepEqual(selectSections(['anon']).map((s) => s.id), ['anon'])
  assert.throws(() => selectSections(['nope']), /Unknown area/)
  assert.equal(selectSections(null).length, SECTIONS.length)
})

test('sections: unique ids and step names, known roles', () => {
  const ids = new Set()
  for (const s of SECTIONS) {
    assert.ok(!ids.has(s.id), `duplicate section ${s.id}`)
    ids.add(s.id)
    const names = s.steps.map((x) => x.name)
    assert.equal(new Set(names).size, names.length, `duplicate step names in ${s.id}`)
    for (const r of s.roles) assert.ok(ROLES[r], `${s.id}: unknown role ${r}`)
    for (const step of s.steps) assert.equal(typeof step.run, 'function')
  }
})

test('sections only use roles they declare (for the dry-run plan)', () => {
  const dir = resolve(E2E_DIR, 'sections')
  for (const s of SECTIONS) {
    const used = new Set()
    for (const step of s.steps) for (const m of step.run.toString().matchAll(/(?:as|book|trackBooking)\('(\w+)'/g)) used.add(m[1])
    for (const r of used) assert.ok(s.roles.includes(r), `${s.id} signs in as ${r} but doesn't list it in roles`)
  }
  assert.ok(readdirSync(dir).length >= 8)
})

test('hooks: env rewrite and client redirect', () => {
  assert.equal(rewriteEnv('const u = import.meta.env.VITE_X'), 'const u = globalThis.__E2E_VITE_ENV__.VITE_X')
  const next = () => ({ url: `${SRC_DIR_URL}lib/supabase.js`, format: 'module' })
  assert.equal(resolveHook('../lib/supabase.js', {}, next).url, SHIM_URL)
  const other = () => ({ url: `${SRC_DIR_URL}lib/format.js`, format: 'module' })
  assert.equal(resolveHook('../lib/format.js', {}, other).url, `${SRC_DIR_URL}lib/format.js`)
})

test('FetchXHR posts a Blob like portfolio.js expects (headers, progress, status)', async () => {
  const { createServer } = await import('node:http')
  const { FetchXHR } = await import('../lib/shim.mjs')
  let seen = null
  const server = createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen = { method: req.method, url: req.url, type: req.headers['content-type'], auth: req.headers.authorization, body: Buffer.concat(chunks) }
      res.writeHead(req.url.includes('fail') ? 403 : 200, { 'content-type': 'application/json' })
      res.end(req.url.includes('fail') ? '{"message":"new row violates row-level security policy"}' : '{"Key":"ok"}')
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const send = (path) =>
    new Promise((resolve) => {
      const xhr = new FetchXHR()
      const progress = []
      xhr.open('POST', `${base}${path}`)
      xhr.setRequestHeader('authorization', 'Bearer t')
      xhr.setRequestHeader('content-type', 'image/jpeg')
      xhr.upload.onprogress = (e) => progress.push(e.loaded)
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText, progress })
      xhr.onerror = () => resolve({ error: true })
      xhr.send(new Blob([solidJpeg({ size: 8 })], { type: 'image/jpeg' }))
    })
  try {
    const ok = await send('/object/portfolio/u/a/p.jpg')
    assert.equal(ok.status, 200)
    assert.equal(seen.method, 'POST')
    assert.equal(seen.type, 'image/jpeg')
    assert.equal(seen.auth, 'Bearer t')
    assert.deepEqual([seen.body[0], seen.body[1]], [0xff, 0xd8])
    assert.equal(ok.progress.at(-1), seen.body.length)
    const denied = await send('/object/fail')
    assert.equal(denied.status, 403)
    assert.match(denied.text, /row-level security/)
  } finally {
    server.close()
  }
  const unreachable = await new Promise((resolve) => {
    const xhr = new FetchXHR()
    xhr.open('POST', 'http://127.0.0.1:9/x')
    xhr.onload = () => resolve('load')
    xhr.onerror = () => resolve('error')
    xhr.send(new Blob(['x']))
  })
  assert.equal(unreachable, 'error')
})

test('every app API function the sections call exists', async () => {
  const { installShim, loadApp } = await import('../lib/shim.mjs')
  installShim({ VITE_SUPABASE_URL: 'http://127.0.0.1:9', VITE_SUPABASE_PUBLISHABLE_KEY: 'test-key', VITE_ML_URL: 'http://127.0.0.1:9', DEV: false, PROD: true, MODE: 'test' })
  const app = await loadApp()
  const dir = resolve(E2E_DIR, 'sections')
  const missing = []
  for (const f of readdirSync(dir)) {
    const src = readFileSync(resolve(dir, f), 'utf8')
    for (const m of src.matchAll(/app\.(\w+)\.(\w+)/g)) {
      const [, mod, fn] = m
      if (!app[mod]) missing.push(`${f}: app.${mod}`)
      else if (!(fn in app[mod])) missing.push(`${f}: app.${mod}.${fn}`)
    }
  }
  assert.deepEqual([...new Set(missing)], [])
})
