# Frontend data layer

All data shown in the app comes from Supabase. Screens never build queries themselves: they call functions in `frontend/src/api/` and get plain objects back.

## Where things live

| File | What it does |
|---|---|
| `src/lib/supabase.js` | The browser client (publishable key; Row-Level Security decides what each user sees). |
| `src/lib/useQuery.js` | `const { data, loading, error, reload, setData } = useQuery(() => fn(args), [deps])`. Pass `null` instead of a function to skip loading (e.g. while signed out). |
| `src/lib/format.js` | `money`, `priceLabel`, `startingPrice`, `avatarUrl`, `photoUrl`, `statusLabels`, `bookingSteps`, `policyFromRules`, `toPackage`, `exifLine`, `ACTIVE_STATUSES`, `PAID_STATUSES`. |
| `src/lib/dates.js` | `today()`, `TODAY`, `toKey`/`fromKey` (`YYYY-MM-DD`), `parseDates`, `addDays`, `fmtBooking`, `fmtChip`, `fmtMonth`, `fmtTime`, `ago`, `isPast`. |
| `src/components/States.jsx` | `<Loading/>`, `<EmptyState icon title text action compact/>`, `<ErrorState error onRetry/>`, `<SignInPrompt title text/>`. Use these for every loading, empty and signed-out state. |
| `src/api/catalog.js` | Providers in every vertical, categories, reviews, availability, search, "% match". |
| `src/verticals/` | `catalog.js` (the shared list of verticals, services, occasions) and `index.js`, the registry: `verticalMeta`, `verticalConfig` (package/provider fields, filters, price types, booking quantity), `priceSuffix`, `quantityFor`, `attributeLines`, `cleanAttributes`, `nounFor`/`countLabel`. Plain JS (shared with mobile). |
| `src/components/verticals/` | Web pieces: `VerticalIcon` (lucide name → icon), `PackageFields` (form from a field config), `AttributeList` (display). |
| `src/api/portfolio.js` | Albums (read and post), photographer onboarding. |
| `src/api/discover.js` | Swipe feed, swipe logging and undo, taste profile, "Not into this". |
| `src/api/bookings.js` | Bookings as client and as photographer, plus every booking action. |
| `src/api/messages.js` | Conversations, messages, realtime, inquiries. |
| `src/api/social.js` | Follows, shortlist (saved photographers), collections (saved photos). |
| `src/store.jsx` | Signed-in user's app-wide state: `myProvider`, `following`, `shortlist`, `liked`, `saved`, `corrections`, toggles, `toast`, `mode`. |
| `src/auth.jsx` | `useAuth()`: `user`, `profile` (the `profiles` row), `session`, `loading`, `signOut`, `refreshProfile`. |

## The objects screens get

### Verticals (all event services)

Every provider belongs to one **vertical** (photography, catering, venue... slugs from `verticals/catalog.js`). Until the all-verticals migration is applied, the database only has photography; other verticals show empty or "coming soon" states and nothing errors.

| Function | Returns |
|---|---|
| `getCategories()` | Every vertical in catalog order, merged with the database: `[{ id\|null, slug, name, noun, plural, icon, tint, group, priceUnit, visual, tagline, live, services: [{ id\|null, slug, name, vertical, live }] }]`. `live` = the database has it. Database rows missing from the catalog are appended with fallbacks. (It used to return photography's services; those are now `getServices('photography')`.) |
| `getVerticalInfo(slug)` | One entry of `getCategories()`, or null. |
| `getServices(vertical = 'photography')` | Live services of one vertical, for pickers: `[{ id, slug, name, vertical }]`. |
| `listProviders({ vertical })` | Active providers; all verticals when `vertical` is omitted. |
| `searchProviders({ vertical, service, dates, maxPrice, minRating, proOnly })` | `service` is a service or vertical slug (`category` still works as the old name). |
| `countProvidersByVertical()` | `{ photography: 7 }`: active providers per vertical (cached a minute; verticals with none are absent). |
| `getMyProviders(userId)` / `getMyProvider(userId, pick)` (`api/portfolio.js`) | A user's listings (one per vertical); `pick` is a provider id or vertical slug. The store exposes `myProviders`, `myProvider` (the selected one) and `selectProvider(id)`. |
| `becomeProvider({ displayName, slug, city, serviceIds, vertical })` | Creates a listing in a vertical. |
| `updateProviderAttributes(providerId, attrs)` (`api/provider.js`) | Saves a listing's custom fields. |
| `requestBooking({ ..., quantity })` | `quantity` (guests / items / days) is sent only when set, for per-person, per-item and daily packages. |

Field configs (`verticals/<slug>/config.js`) use the exact keys of the JSON Schemas in `supabase/seed.sql` (they reject unknown keys). Enum options are `{ value, label }` (e.g. `gluten-free` / "Gluten-free"). `min_quantity` / `max_quantity` look like package fields in the configs and in `pkg.attributes`, but they are **columns** on `packages`: `api/provider.js` writes them as columns, and only when the form has them, so photography packages still save on the old database. `daily` packages are charged once per booked day (each date picked is one day), so only `per_person` / `per_item` ask for a quantity. `deliversMedia(vertical)` is true for photography and videography; other bookings are "marked done" instead of "delivered" with a gallery.

Onboarding: `/new-listing?v=catering` ("What do you offer?" grid, then name, link, city and services). Verticals that aren't in the database yet show "coming soon". `/upload` uses the same form (photography) the first time someone posts.

Prices: `priceLabel(pkg)` gives "$1,200", "$150/hr", "$65 / person", "$85 each" (or "$85 / centerpiece" with a `unit_label` attribute), "$3,500 / day", "Custom quote". `fromPriceLabel(provider)` gives "from $65 / person".

**Provider** (`listProviders()`, `getProvider(id)`, `searchProviders()`):
`{ id, kind: 'provider', vertical ('catering'), verticalInfo { slug, name, noun, plural, icon, tint, group, priceUnit, visual, concurrent }, attributes {}, profileId, slug, name, shortName ("Maya" when the listing uses the owner's name, else the whole business name; use it in sentences like "Book …"), username, avatar, cover, covers[], albumCount, city, serviceArea, travelFee, specialties[], categories[], categorySlugs[], bio, rating (null if no reviews), reviewCount, idVerified, pro, tasteMatch (null unless withMatches), distanceKm (always null for now), followers, cancellationPolicy {label, tiers}, gear {bodies, lenses}, packages[], startingPrice, addons[]*, reviews[]*, workingDays[]* }`
`*` only from `getProvider`. `getProvider(id)` accepts a provider id, the owner's profile id, or a slug. `getPerson(id)` returns a provider, or a client `{ kind: 'person', id, name, username, avatar, city, bio, clientRating, clientReviews }`.

**Package**: `{ id, name, description, priceType 'fixed'|'hourly'|'quote'|'per_person'|'per_item'|'daily', price (dollars|null), hours, attributes {}, editedPhotos, editingLevel, turnaroundDays, deliverables[], depositPct }`. `quantityFor(pkg, vertical)` (verticals/) says whether booking it needs a guest / item / day count and its min/max.

**Booking** (`listMyBookings()`, `listProviderBookings(providerId)`, `getBooking(id)`):
`{ id, status, role 'client'|'provider', vertical, quantity (null unless guests/items/days), provider {id, vertical, name, avatar, ...}, client {id, name, avatar, rating, reviews}, pkg, packageName, addons [{name, price}], start, end, hours, day (Date), dateKey, date "Oct 21, 2026", time "4:00 PM", location, note, subtotal, travelFee, total, deposit, depositPaid, isActive, policy {label, tiers}, conversationId, history [{status, at}], expiresIn "41h", offer {id, total, message}|null, deliveryExpiresDays, reviewWindowOpen, myReview, theirReview }`

**Album** (`toViewerAlbum(row)` on rows from `listAlbums(providerId)`): `{ id, providerId, title, caption, location, date, genre, type 'photo'|'beforeafter', cover, autoTags[], photos [{ id, src, beforeSrc?, exif, autoTags }] }`

**Discover card** (`getFeed({ limit, category })`): `{ id/photoId, albumId, authorId, provider, title, category, photos [{id, src, exif}], tags[], reason, exploration, exif }`

**Conversation** (`listConversations()`, `getConversation(id)`):
`{ id, kind 'direct'|'group'|'booking'|'inquiry', isGroup, title, bookingId, booking, members [{id, profileId, name, avatar, username, isPhotographer, lastReadAt}], lastMessage {text, fromMe, at, senderId}, lastMessageAt, unread }`. `members` excludes me.

**Message** (`listMessages(id)`, `sendMessage(id, {text, sharedAlbumId})`): `{ id, from, mine, text, sharedAlbum {id, title, cover, providerId}|null, at, time }`.

**Starting conversations:**
- `startDirectMessage(profileId)` opens a one-to-one thread with anyone.
- `startInquiry(providerId)` asks a photographer a question.
- `createGroup(title, profileIds)` needs at least 2 other people.
- `addGroupMembers`, `renameGroup` and `leaveGroup` manage a group.
- `searchPeople(q)` finds people to message; with an empty query it returns people you've talked to.

All of these run as database functions, which enforce blocks: a blocked person can't message you in one-to-one threads.

**Live:**
- `openChat(id, { onMessage, onRead, onTyping })` returns `{ typing(), close() }`.
- `subscribeToInbox(onChange)` updates the inbox list and tab badge.

Errors for display come from `messageError(err)`.

## IDs and links

- `/u/:id` takes a provider id, a profile id or a username/slug.
- Photographer pages use the **provider id**; clients use their **profile id**.
- Album viewer: `/gallery/:providerId?post=<albumId>` or `&photo=<photoId>`.

## Rules of thumb

- Everything a signed-out visitor can see (photographers, albums, reviews, search, Discover) works without an account. Bookings, Inbox and the Me tab show `<SignInPrompt/>`.
- Every list has an empty state. New accounts have no bookings, messages or likes.
- Booking changes go only through the `api/bookings.js` actions; errors come back as readable messages (`bookingError(err)`).

## Demo data

`supabase/demo/demo_data.sql` fills the dev database with:
- packages, add-ons, gear, working hours and blocked-off days for the 7 test photographers
- 22 bookings in every state, with reviews (these drive ratings)
- chats, follows, and a shortlist for Brian's account.

It's safe to re-run. `supabase/demo/remove_demo_data.sql` undoes it (run that before deleting the test users).
