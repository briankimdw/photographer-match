// Shared formatting + small lookups used across screens (no data fetching here).
import { supabase } from './supabase.js'
import { priceSuffix } from '../verticals/index.js'

// ---- money ------------------------------------------------------------------
export const dollars = (cents) => (cents == null ? null : cents / 100)
// "$1,200", or "$112.50" when there are cents.
export const money = (n) => {
  if (n == null) return 'Quote'
  const cents = Math.round(Number(n) * 100) % 100 !== 0
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`
}
// A package's price with its unit: "$1,200", "$150/hr", "$65 / person", "$85 each"
// (or "$85 / centerpiece" when the package names its unit), "$3,500 / day", "Custom quote".
export const priceLabel = (pkg) =>
  pkg.priceType === 'quote' || pkg.price == null ? 'Custom quote' : `${money(pkg.price)}${priceSuffix(pkg.priceType, pkg)}`
// The lowest package price (dollars), or null. Units may differ between packages; see startingPackage.
export const startingPrice = (provider) => {
  const priced = (provider.packages || []).filter((x) => x.price != null)
  return priced.length ? Math.min(...priced.map((x) => x.price)) : provider.startingPrice ?? null
}
// The cheapest priced package (so its unit can be shown), or null.
export const startingPackage = (provider) =>
  (provider.packages || []).filter((x) => x.price != null && x.priceType !== 'quote').sort((a, b) => a.price - b.price)[0] ?? null
// "from $65 / person", "from $1,200", or null when nothing is priced.
export const fromPriceLabel = (provider) => {
  const pkg = startingPackage(provider)
  if (pkg) return `from ${priceLabel(pkg)}`
  const n = startingPrice(provider)
  return n == null ? null : `from ${money(n)}`
}

// ---- images -----------------------------------------------------------------
export const publicUrl = (bucket, path) => supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
export const photoUrl = (path) => (!path ? null : /^https?:/.test(path) ? path : publicUrl('portfolio', path))

// Avatar for a profile: an uploaded file, an external URL, or a generated initials badge.
// How to address a vendor in a sentence ("Book Maya", "Message The Glasshouse DTLA"):
// the first name when the listing is under the owner's own name, else the whole
// business name (first words like "The" or "DJ" make no sense on their own).
export const callName = (name = '', ownerName = '') => {
  const n = (name || '').trim()
  if (!n) return ''
  const owner = (ownerName || '').trim().toLowerCase()
  return owner && n.toLowerCase() === owner ? n.split(/\s+/)[0] : n
}

export const avatarUrl = (path, name = '') => {
  if (path) return /^https?:/.test(path) ? path : publicUrl('avatars', path)
  // Initials from words that start with a letter or digit ("Petal & Stem" -> "PS"), so
  // symbols like & or < never end up inside the SVG markup.
  const initials = name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?'
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="hsl(${h},35%,42%)"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="38" fill="#fff">${initials}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// ---- bookings ---------------------------------------------------------------
export const bookingSteps = ['requested', 'confirmed', 'in_progress', 'delivered', 'completed']

export const statusLabels = {
  requested: 'Requested',
  countered: 'Counter offer',
  accepted: 'Accepted · pay deposit',
  confirmed: 'Confirmed',
  in_progress: 'In progress',
  delivered: 'Delivered',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  cancelled_by_client: 'Cancelled by client',
  cancelled_by_provider: 'Cancelled by provider',
  disputed: 'Disputed',
  refunded: 'Refunded',
}

// Statuses that hold the photographer's time (and can still change).
export const ACTIVE_STATUSES = ['requested', 'countered', 'accepted', 'confirmed', 'in_progress']
// Statuses where the deposit has been paid.
export const PAID_STATUSES = ['confirmed', 'in_progress', 'delivered', 'completed', 'disputed']

// Cancellation policy rules ([{ min_days_before, refund_pct }], any order) as a
// display table: { label, tiers: [{ when, refund }], rules }.
const POLICY_NAMES = { 7: 'Flexible', 30: 'Moderate', 90: 'Strict' }
export function policyFromRules(rules, name) {
  const sorted = [...(rules || [])].sort((a, b) => b.min_days_before - a.min_days_before)
  const tiers = sorted.map((r, i) => {
    const prev = sorted[i - 1]?.min_days_before
    const when =
      r.min_days_before === 0
        ? prev != null ? `Under ${prev} days` : 'Any time'
        : prev != null ? `${r.min_days_before}–${prev} days before` : `${r.min_days_before}+ days before`
    return { when, refund: r.refund_pct }
  })
  return { label: name || POLICY_NAMES[sorted[0]?.min_days_before] || 'Custom', tiers, rules: sorted }
}

// ---- packages ---------------------------------------------------------------
// A packages row (or a booking's package_snapshot) in the shape screens use.
export function toPackage(p) {
  if (!p) return null
  const a = p.attributes || {}
  return {
    id: p.id,
    providerId: p.provider_id,
    categoryId: p.category_id,
    category: p.category?.name ?? null,
    name: p.name,
    description: p.description ?? null,
    priceType: p.price_type,
    price: dollars(p.price_cents),
    hours: p.duration_minutes ? p.duration_minutes / 60 : null,
    editedPhotos: a.edited_photos ?? null,
    editingLevel: a.editing_level ?? null,
    turnaroundDays: a.turnaround_days ?? null,
    deliverables: a.deliverables || [],
    secondShooter: !!a.second_shooter_included,
    // Guest / piece limits (packages.min_quantity / max_quantity, from the all-verticals migration).
    minQuantity: p.min_quantity ?? null,
    maxQuantity: p.max_quantity ?? null,
    // Every custom field (cuisines, courses...) plus the limits under their column names,
    // so field configs (verticals/) can show and edit them alike.
    attributes: { ...a, ...(p.min_quantity != null && { min_quantity: p.min_quantity }), ...(p.max_quantity != null && { max_quantity: p.max_quantity }) },
    depositPct: p.deposit_pct,
    isActive: p.is_active !== false,
  }
}

// Camera settings as one line: "Sony A7 IV · 85mm · f/1.8 · 1/500s · ISO 100"
export const exifLine = (e = {}) => [e.body, e.focal, e.aperture, e.shutter, e.iso && `ISO ${e.iso}`].filter(Boolean).join(' · ')
