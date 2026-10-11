# Web QA checklist

Run: 2026-10-10, web app (`frontend/`, Vite dev server) against the hosted Supabase project.

**How it was tested:**
- **Signed out:** headless Chrome driven over CDP, against real data. Console errors and failed network requests were captured on every page.
- **Signed in:** a **fake** session injected into the page; no real account or password was used.
  - Private data (bookings, chats, events, votes, follows) came from fixtures.
  - Public reads (vendors, packages, albums, reviews, search) passed through to the real project as the anonymous role.
  - Every write and RPC was intercepted, recorded and checked, and never sent.
- **Select strings:** every `select` string in `frontend/src/api/*` was replayed as the anonymous role against the real project. For writes, the `?select=` was replayed as a read with `limit=0`.
- **RPCs:** RPC names and parameter names were checked against the migrations.

**Result:** 89 items: 81 pass, 8 fail. All 8 failures are fixed (marked "fixed"), plus one wording bug inside a passing item (the Follow and Shortlist toasts). Notes marked *minor* are left as they are.

## Data layer
| Item | Result | Notes |
|---|---|---|
| Every select/embed string in `api/*` (97 functions, ~140 requests) | pass | No 400s: no "more than one relationship" errors and no unknown columns. `event_candidates` and its votes return 401 for anon (no grant, by design); their columns were checked against the migration instead. |
| RPC names and parameters (24 functions) vs migrations | pass | All match, including `request_booking` with `p_quantity` / `p_event_id`. |
| `BOOKING_COLUMNS` after adding `profile.display_name` | pass | Re-validated. |

## Browse
| Item | Result | Notes |
|---|---|---|
| Home: greeting, service rail, occasions, "free this weekend", shelves | pass | |
| Service rail → `/services/:vertical` | pass | |
| Service page: service chips, "See all", Map | pass | Links to `/search?v=…&cat=…` and `&view=map`. |
| `/services/<unknown>` | pass | Shows the "We don't have that service" state. |
| Occasion page: checklist tick (saved on this device), "Start planning with friends" | pass | Goes to `/events/new?type=wedding`, with the type preselected. |
| `/occasions/<unknown>` | pass | |
| Unknown route (404) | **fixed** | The page was blank. It now shows a "Page not found" screen. |

## Discover
| Item | Result | Notes |
|---|---|---|
| Deck: like / pass / shortlist / undo (×3) | pass | Undo restores the right cards. Signed out, Shortlist shows a sign-in toast. |
| Details sheet: packages, next 2 weeks, Ask / Profile / Book | pass | Signed out, Ask goes to sign-in. |
| Card price for non-photography vendors | **fixed** | It showed "from $5" with no unit. It now uses `fromPriceLabel` ("from $5 each"). |
| Style chips, vertical picker, "Not into this" / taste / shortlist sheets signed out | pass | |
| Vertical with vendors but no posts (e.g. florals) | pass (*minor*) | Says "You've seen everything" when nothing was ever shown. |
| Explore grid, filter chips (`?s=`), paging to "You're all caught up", tile → gallery | pass | |

## Search
| Item | Result | Notes |
|---|---|---|
| Text search (`?q=`), clear | pass | |
| Vertical and service chips (URL kept) | pass | |
| Filters: the vertical's own filters, price, rating, distance prompt, Pro / ID; removable chips | pass | |
| Sort (Top rated / Lowest price) | pass | |
| "Free on" dates: picker → results → Book carries the free dates; Back keeps the dates | pass | |
| Map, "Search this area", List with area sections | pass | |

## Profiles
| Item | Result | Notes |
|---|---|---|
| Photographer: tabs (Portfolio / Packages / Gear / Reviews), `?tab=reviews` | pass | |
| Caterer / venue / DJ: tab order for non-visual verticals, "About" attributes | pass | |
| Client profile (`/u/<profile id>`): client rating, Message | pass | |
| Not found (`/u/nobody-here`) | pass | |
| Followers sheet, avatar viewer, review detail sheet | pass | |
| Availability strip; `?dates=` "Your dates" free/booked; Book carries only free dates | pass | |
| Signed out: Follow / Shortlist / Ask / Add to event / Share | pass | The Follow and Shortlist toasts said "photographers" for every vertical (**fixed**: now "vendors"). |
| Vendor names in sentences | **fixed** | Showed "Book The", "About DJ", "Message The", "The's calendar…". Now uses the new `shortName`: "Book Maya", "Book The Glasshouse DTLA". |
| Service area for radius 0 | **fixed** | Showed "Arts District + 0 km radius". Now just "Arts District". |
| Tagged in | pass | Hidden when there are no credits. Credits are covered by the fixtures earlier agents left (po-*). |

## Gallery viewer
| Item | Result | Notes |
|---|---|---|
| Open from profile, arrows / next album, deep link `?post=`, Close fallback on a direct load | pass | |
| Like / Save / Share signed out, info sheet (tags, report) | pass | |
| Book line price unit | **fixed** | Same as the Discover card: now `fromPriceLabel`. |
| URL after moving to another album | pass (*minor*) | `?post=` keeps the album you opened, so Back and reload return to it. |
| Unknown post id / unknown vendor / vendor with no posts | pass | |

## Booking request
| Item | Result | Notes |
|---|---|---|
| fixed (Maya) | pass | |
| hourly (Jonah): stepper, total = hours × rate | pass | |
| per_person (Golden Spoon): min/max clamp (9999 → 300, 5 → 40), step 5, total, deposit | pass | |
| per_item (Crumb Club): min/max, "+" disabled at the max | pass | |
| daily (Glasshouse): no quantity, "Per day", total for N days | pass | |
| quote (Leo): quote note, no price | pass | |
| Add-ons, multiple dates, carried-over `?dates=` (past dates dropped), bad `?pkg=` | pass | |
| Signed out: "Sign in to send request" → `/sign-in?next=` | pass | |

## Bookings + BookingDetail (client)
| Item | Result | Notes |
|---|---|---|
| List: needs attention / upcoming / past, calendar dots, tap a day | pass | |
| requested → Cancel request | pass | Calls `cancel_booking`. |
| countered → Accept offer | pass | Calls `respond_to_offer(o1, true)`. |
| accepted (per_person, qty 80), confirmed (refund 100%) | pass | |
| delivered (photo) → Delivery → Accept | pass | Calls `accept_delivery`. |
| delivered (DJ) → Confirm it's done | pass | |
| completed → Review (4★ + text) | pass | Calls `submit_review(p_rating 4)`. |
| completed with my review → hidden note | pass | |
| declined / not found / error state | pass | |

## BookingDetail + Dashboard (vendor)
| Item | Result | Notes |
|---|---|---|
| requested → Accept / Offer another price ($1,000 + message) / Decline | pass | `respond_to_booking` gets the right params. |
| Quote request in detail: no Accept, "Send a price", offer must be > 0 | pass | |
| Quote request on the Me → Requests card | **fixed** | It offered Accept, which the database always rejects ("Quote-based requests need a price"). It now offers "Send a price". |
| Counter on the Me → Requests card | **fixed** | A $0 counter was allowed. It now requires a price above $0. |
| countered, confirmed past day → Mark as delivered, confirmed future → Cancel, delivered | pass | |
| Package editor: edit, new package | pass | Writes the right row. Limits for per-person packages are written as columns. |
| Calendar: block a day, past day ignored | pass | Writes the blackout range in the listing's time zone. |

## Inbox / chat / sharing
| Item | Result | Notes |
|---|---|---|
| Inbox list: DM, group, event and inquiry chats, last-message previews, share labels | pass | |
| Send (Enter), optimistic message, read marker | pass | |
| Failed send → "Not sent · Retry · Delete", Retry resends | pass | |
| Group / event chat headers, Event board button → `/events/:id` | pass | |
| Not found chat | pass | |
| New message: recent people, search | pass | |
| ShareSheet from a profile: pick a DM and a group, add a note, Send → "Sent to 2 chats" | pass | Two `messages` inserts with `shared_provider_id`. |
| Typing indicator after re-opening a chat | **fixed** | The `typing:<id>` channel was reused while it was still being removed: `supabase.channel()` returns the old channel with the same topic. Under StrictMode, or when re-opening a chat, typing never arrived. The channel is now shared and released after a delay. Realtime itself was not testable in the harness. |
| Read receipts | pass (*minor*) | Shows "Sent" under my message even when the other person replied after it. |

## Events
| Item | Result | Notes |
|---|---|---|
| List (upcoming) | pass | |
| Board: groups per needed vertical, votes, stage sheet, Book for this event (`?event=&dates=`) | pass | |
| Invite sheet: excludes members | pass | |
| Edit details → PATCH | pass | |
| Delete → `/events` | pass | |
| New event → `create_event_with_chat` | pass | |
| Add to event from a profile | pass | Shows "Added" for an event that already has the vendor. |
| Error state | pass | |

## Planner / posting / listings / account
| Item | Result | Notes |
|---|---|---|
| Planner (`?mock=1`): prompt → plan, chip edit sheet, Save as event | pass | `create_event_with_chat` gets the right params. The mock's "by 1 clients" wording is in `devMock.js` only. |
| Upload: vendor (picks the listing) / "Posting is for vendors" for clients | pass | |
| My Work: lists posts | pass | Edit and delete were covered by earlier agents' po-* harness. |
| New listing: grid, "Listed" on existing verticals, continue as a caterer | pass | |
| Settings, Verify (verified), AI review (live post) | pass | |
| Welcome: name required, saves `display_name` / `username` | pass | |
| Sign-in: invalid email, short sign-up password, forgot-password validation, `next=` limited to same-site paths | pass | Auth endpoints were blocked; no sign-in was attempted. |
| `/reset-password` and `/auth/callback` without a session | pass | Both time out into a clear "link didn't work" state. |
| Signed-out prompts on every private route | pass | |
| Empty states for a new account (inbox, events, bookings, my work, me) | pass | |
| Error states (bookings, inbox, events, booking detail) | pass | |

## Only verifiable with a real signed-in session
- Realtime: new messages, typing, read receipts and live board updates across two browsers.
- Uploads to Storage.
- RLS outcomes of writes: who can vote, remove members and delete events.
- `become_provider` end to end.
- Google sign-in.
