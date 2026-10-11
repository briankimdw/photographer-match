# End-to-end test (real database, real test users)

A single command that signs in as the throwaway test users from `docs/test-users.json` and runs every backend feature against the hosted Supabase project. It goes through the app's own data layer (`frontend/src/api/*.js`, unchanged), so a pass means the queries the screens use really work with Row-Level Security, the database functions and Storage.

It uses the **publishable key** from `frontend/.env.local`. It never uses the service role key, and it refuses to start if the key in `.env.local` looks like one. Passwords, tokens and the key are never printed or saved. Emails appear masked (`jor…@example.com`).

## Run it

```
cd frontend
node scripts/e2e/run.mjs                    # everything (about 1–2 minutes)
node scripts/e2e/run.mjs --dry-run          # signed-out checks for real + the signed-in plan; no sign-in
node scripts/e2e/run.mjs --only messaging,events
node scripts/e2e/run.mjs --verbose          # full error text, cleanup progress
node scripts/e2e/run.mjs --keep             # skip cleanup (inspect the [e2e] data in the app)
node scripts/e2e/run.mjs --pause-for-payment   # also test deliver → complete → reviews → ratings
node --test scripts/e2e/test/helpers.test.mjs  # unit tests of the helpers (offline)
```

The exit code is 0 when nothing failed, 1 when a step or a cleanup task failed, and 2 when the test couldn't start (for example, a missing `.env.local`).

### Before you run it

- **Node 22.15 or newer** (it uses `module.registerHooks`).
- `frontend/.env.local` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **The test users and demo data:** `node scripts/seed-test-users.mjs --with-photos`, then `supabase/demo/demo_data.sql`. The `preflight` section checks this and names whatever is missing.
- All migrations applied, including `supabase/demo/sharing_events_credits_setup.sql` (share cards, events with friends, post credits).
- **Optional, the AI planner:** `cd services/ml && .venv/Scripts/python -m uvicorn app.main:app --port 8000`. If it isn't running, the `planner` section is skipped with a notice. `VITE_ML_URL` in `.env.local` overrides the address.
- **Optional, "% match":** this needs SigLIP embeddings for the photos (`python -m app.worker --once` in `services/ml`). Without them, that step is skipped.

## Who plays whom

| Role | Test user | Used for |
|---|---|---|
| clientA | jordanlee | books, follows, swipes, owns the [e2e] event, chats and groups |
| clientB | taylorb | DMs, co-planner, the competing booking |
| outsider | kai.film | must never see anyone else's data (RLS) |
| photographer | mayachen | identity-verified, capacity 1: answers requests, gets credited on a post |
| unverified | sofia.wild | not identity-verified: can't accept a booking |
| caterer | goldenspoon | capacity 3: posts an album, opens a second listing |

`ROLES` in `lib/context.mjs` changes these. The pricing section also books packages from other test vendors (priya-frames, jonah-reyes…) but never signs in as them.

## What it covers

| Area (`--only`) | What it checks |
|---|---|
| `anon` | Categories. `listProviders` per vertical, with counts. `search_providers` by dates, vertical, service and max price. `getProvider` by id, slug and owner id. Reviews match the rating aggregates. Albums and credits. The Discover feed for signed-out visitors. `getPerson`. Signed-out visitors see no private rows and can't call the booking RPCs. Planner health. |
| `preflight` | The role accounts, listings and flags (verified, unverified, `max_concurrent` > 1), and a package of every price type. Runs automatically before any signed-in area. |
| `social` | Follow (the follower list and count update), unfollow, shortlist add and remove. |
| `discover` | Personal feed. Like ×3, pass, undo the pass. The taste profile counts the likes. `provider_matches` values are in range. |
| `pricing` | `requestBooking` for **fixed, hourly, per_person (with quantity), per_item, daily (2 dates) and quote** packages. Totals and deposits are compared with the SQL rules (`lib/pricing.mjs`), then each booking is cancelled (status and refund %). A per-person request below the minimum is refused. |
| `lifecycle` | Client requests → the vendor sees it in `listProviderBookings` → counter → the client accepts the offer (new total and deposit). The vendor accepts a second request directly. The unverified vendor can't accept but can decline. Delivering, completing or reviewing before payment is refused. The vendor cancels. With `--pause-for-payment`: delivered → completed → double-blind reviews (hidden, then revealed) → provider and client rating counts go up by one. |
| `capacity` | Overlapping per-person bookings on the caterer fill its capacity, and the next one is refused as "fully booked" (the slot numbers are shown). Cancelling frees a slot. A second booking that overlaps on the photographer is refused as "already booked". |
| `messaging` | DM, unread flag and `unreadCount`, `markRead`. **Realtime:** the recipient's `openChat` receives a new message within 10 seconds (`--realtime-timeout`), and the inbox subscription fires. Groups: needing at least 2 others, create, rename (by a member), add, message, leave (the member who left loses access). `searchPeople`. |
| `sharing` | `shareToChats` sends post, vendor and event cards to a DM. The recipient sees the cards. `share_preview` is filled by the server, and the event preview has only safe keys (no budget, guests, owner or members). The recipient can't open the private event. A preview the client tries to set is wiped. Non-members can't share someone else's event. |
| `events` | `create_event_with_chat`. Inviting someone makes them a co-planner and puts them in the chat (inviting twice adds nobody). The board: add a vendor, vote ×2, take one vote back, shortlist. A booking made from the event shows on the co-planner's board through `event_bookings`, but the co-planner can't read the booking itself. Outsiders get nothing: no event, board, bookings or chat, and they can't invite themselves or add a candidate. Renaming the event renames the chat. The owner can't leave. The co-planner leaves. Deleting the event deletes its chat. |
| `posting` | The caterer posts an album through the real `postAlbum` with a JPEG generated in code (`lib/jpeg.mjs`), an occasion and a credit for the photographer. The public view shows the photo URL serving JPEG bytes, the occasion, the credit and the camera settings. The credited vendor shows the post under "Tagged in". Editing changes the title and occasion and removes the credit. Other users can't edit or delete the post. Deleting it removes the row and **both storage files** (the folder is listed before and after). |
| `listing` | `becomeProvider` in a second vertical that can serve several events at once (rentals), which sets `max_concurrent` > 1. A per-item package with min and max. The listing appears in its vertical and in date search, and two overlapping bookings fit. Hiding it (draft) removes it from public lists. |
| `planner` | `/plan/health`. Requests without a token get a 401. `planEvent` with the client's access token returns a brief and recommendations. |
| `rls` | An outsider can't read or change a client's booking, its history, offers or add-ons (cancel, accept and review are refused). Another vendor can't see it. The outsider can't read or post in a DM, can't add themselves to it and can't move its read markers. They can't read or edit an event or add themselves to it. They also can't edit another listing, package or profile, read `provider_private`, swipes or the shortlist, insert a swipe, review or follow on someone's behalf, or upload into another user's storage folder. These probes write values that are already there, so they change nothing even if a policy were broken. |

## What it creates, and how it cleans up

Every row it writes carries the tag **`[e2e <runId>]`** in its title, notes or message text. For example `[e2e mpi74c1] birthday`, or a booking note `[e2e mpi74c1] lifecycle booking`. The second listing's slug starts with `e2e-`. Bookings go on dates about 320–520 days ahead, past all the demo data. Demo data is never edited: the follow and shortlist tests pick vendors the client wasn't already following or saving.

Undo tasks are registered as things are made. They run at the end of the run, after a failure, and on Ctrl+C, in this order:

1. **bookings**: cancel any that are still active.
2. **events**: delete them (their board, votes and chat go with them).
3. **chats**: everyone leaves the [e2e] group.
4. **content**: delete the post and its storage files, and the [e2e] package.
5. **social**: unfollow, unsave, undo swipes.
6. **listing**: set the second listing to draft (hidden).

Within a phase, the newest task runs first. One failing task doesn't stop the others. Each failure is reported, and it makes the exit code non-zero.

**What the API can't delete.** RLS has no delete rule for bookings, messages, conversations or listings, so some rows stay:

- the cancelled bookings, with their history and booking chats
- the [e2e] DM messages and the empty [e2e] group
- the hidden second listing

None of these are visible or active anywhere in the app. Their exact ids are written to **`frontend/scripts/e2e/last-cleanup.sql`**. Optionally, paste that file into the Supabase SQL editor to remove them; it only touches those ids. If the reviews test ran, the same file also recalculates the two ratings it changed. A rerun reuses the hidden second listing and the existing DM instead of making new ones.

With `--keep`, none of the undo tasks run. `last-report.json` lists them under `cleanup.pending`.

### `--pause-for-payment`

A booking can only become `confirmed` through the payment webhook (server code), so the publishable key can't get past `accepted`. With this flag, the run pauses and prints a one-line SQL `update` for that single [e2e] booking. Run it in the SQL editor, and the test carries on through delivery, completion, reviews and ratings. The completed booking and its reviews are leftovers: `last-cleanup.sql` deletes them and recalculates the ratings.

## Reading the results

- **Console:** one line per step as it runs (✓ / ✗ / -), then a table: Section · Step · Result · Time · Detail.
  - **PASS** details say what was checked, for example `"jonah-reyes \"Event Coverage\" 5h: $750, deposit $225; cancelled"`.
  - **FAIL** details give the expected and actual values, or the database's error message.
  - **SKIP** says why: the planner isn't running, no SigLIP matches, `--pause-for-payment` wasn't given, or an earlier step in the same area failed (`blocked: "…" failed`).
- **`frontend/scripts/e2e/last-report.json`** (git-ignored):
  - the run id, options and roles (usernames only)
  - the summary and every step result
  - the cleanup outcome for each task
  - the leftover ids
  - in `--dry-run`, the planned steps
- A failing step in an area blocks the later steps of that area, because they depend on its state. Steps marked "soft" (independent checks) don't block anything.

## Files

| File | What it is |
|---|---|
| `run.mjs` | Entry point: options, section order, report, cleanup, Ctrl+C. |
| `lib/shim.mjs`, `lib/hooks.mjs`, `lib/supabase-shim.mjs` | Run `src/api/*.js` under Node. `import.meta.env` is rewritten. `src/lib/supabase.js` is swapped for a client that follows the "active" test user (each user has their own in-memory session). There are small stand-ins for `localStorage`, `location` and an `XMLHttpRequest` built on fetch, which is what uploads use. |
| `lib/context.mjs` | Roles, sign-in, date allocation, package lookups, `book()` (tries the next day if one is taken). |
| `lib/pricing.mjs` | The expected totals, mirroring `request_booking`. |
| `lib/cleanup.mjs` | The undo registry and the leftover SQL. |
| `lib/harness.mjs` | Steps, assertions, the table. |
| `lib/jpeg.mjs` | A tiny baseline JPEG encoder (a solid grey square). |
| `sections/*.mjs` | The checks, one file per area. |
| `test/helpers.test.mjs` | Offline unit tests: totals, masking and redaction, cleanup order and SQL, JPEG, runner, options, hooks, the XHR stand-in, and that every `app.*` function the sections call exists. |
