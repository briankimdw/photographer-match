// What a booking request should cost, mirroring public.request_booking()
// (supabase/migrations/20261010000000_all_verticals.sql):
//   fixed  -> price               daily       -> price (each booked date is one day)
//   hourly -> price x hours        per_person  -> price x guests
//   quote  -> null (vendor counters)  per_item -> price x pieces
// plus add-ons; deposit = round(total x deposit_pct / 100).
//
// `pkg` is the app's package object (lib/format.js toPackage): price in dollars,
// hours, priceType, minQuantity, maxQuantity, depositPct.

const cents = (dollars) => (dollars == null ? null : Math.round(Number(dollars) * 100))

// Postgres round() on numeric rounds halves away from zero; all amounts here are >= 0.
const pgRound = (x) => Math.sign(x) * Math.round(Math.abs(x))

export class QuantityError extends Error {}

/**
 * Expected booking amounts (all in cents).
 * opts: { hours (hourly only), quantity (guests / pieces), addonCents: number[] }
 * Returns { minutes, quantity, subtotal, addons, total, deposit }.
 */
export function expectedBooking(pkg, { hours = null, quantity = null, addonCents = [] } = {}) {
  const type = pkg.priceType
  const price = cents(pkg.price)
  let q = quantity
  if (q != null && q < 1) throw new QuantityError('Quantity must be at least 1')
  if (type === 'per_person' || type === 'per_item') {
    q = q ?? pkg.minQuantity ?? null
    if (q == null) throw new QuantityError(type === 'per_person' ? 'How many guests?' : 'How many pieces?')
  }
  if (q != null && pkg.minQuantity != null && q < pkg.minQuantity) throw new QuantityError(`at least ${pkg.minQuantity}`)
  if (q != null && pkg.maxQuantity != null && q > pkg.maxQuantity) throw new QuantityError(`at most ${pkg.maxQuantity}`)

  const pkgMinutes = pkg.hours ? Math.round(pkg.hours * 60) : null
  const minutes =
    type === 'hourly' ? pgRound((hours ?? (pkgMinutes != null ? pkgMinutes / 60 : 1)) * 60)
      : type === 'daily' ? pkgMinutes ?? 12 * 60
        : pkgMinutes ?? 120

  let subtotal
  switch (type) {
    case 'fixed':
    case 'daily':
      subtotal = price
      break
    case 'hourly':
      subtotal = pgRound((price * minutes) / 60)
      break
    case 'per_person':
    case 'per_item':
      subtotal = price * q
      break
    default:
      subtotal = null // quote
  }
  const addons = addonCents.reduce((s, c) => s + c, 0)
  const total = subtotal == null ? null : subtotal + addons
  const deposit = total == null ? null : pgRound((total * (pkg.depositPct ?? 30)) / 100)
  return { minutes, quantity: q ?? null, subtotal, addons, total, deposit }
}

/** A quantity to book that the package accepts: a little above its minimum, never above its maximum. */
export function pickQuantity(pkg, bump = 5) {
  const min = pkg.minQuantity ?? 1
  const want = min + bump
  return pkg.maxQuantity != null ? Math.min(want, pkg.maxQuantity) : want
}

/** Booking row amounts in the same shape as expectedBooking (for comparing). */
export const amountsOf = (row) => ({
  subtotal: row.subtotal_cents ?? null,
  addons: row.addons_cents ?? 0,
  total: row.total_cents ?? null,
  deposit: row.deposit_cents ?? null,
  quantity: row.quantity ?? null,
})

/** Human diff of expected vs actual amounts, or '' when they match. */
export function diffAmounts(expected, actual) {
  const keys = ['subtotal', 'addons', 'total', 'deposit', 'quantity']
  return keys
    .filter((k) => (expected[k] ?? null) !== (actual[k] ?? null))
    .map((k) => `${k}: expected ${expected[k]}, got ${actual[k]}`)
    .join('; ')
}
