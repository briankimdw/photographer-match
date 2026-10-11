# Mobile QA checklist

Functional pass of the Expo app, 2026-10-10 (mobile-qa). Driven on the Expo **web** target
(`npx expo start --web`) with headless Chrome. Signed-in screens used fake, stubbed sessions
(no real account, no sign-in). Native-only code (maps, gestures, image picker, Share, Linking,
keyboard) was code-reviewed against the Expo SDK 57 APIs.

**Legend:** PASS = works as intended; FIXED = bug found and fixed in this pass; PHONE = needs a
real device to confirm; NOTE = works, with a remark.

## Build checks

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS (also after all fixes) |
| `npx expo-doctor` | PASS, 21/21 |
| `npx expo export --platform ios` / `android` | PASS (both bundle; re-run after fixes) |
| `[auth]` sign-in trace | PASS: `[auth] event INITIAL_SESSION`, `google: redirectTo …`, `sign-in step threw …` all log |

## Browse

| Feature | Result | Notes |
| --- | --- | --- |
| Home: greeting, search bar → /search | PASS | |
| Home: service rail → /services/:vertical | PASS | Catering page: shelves, Map / See all, service chips |
| Home: Plan with AI box, occasions → /occasions/:slug | PASS | Wedding checklist with vendor rails |
| Home: shelves, "Add to event" on a card (signed out → sign-in with `next`) | PASS | |
| Service page, occasion page | PASS | |

## Discover

| Feature | Result | Notes |
| --- | --- | --- |
| Deck loads, Like / Pass / Shortlist buttons | PASS | |
| Drag right (like), drag up (shortlist), short drag springs back | PASS | Web mouse drag; real touch on a phone: PHONE |
| Undo | PASS | Restores the last card |
| Details sheet (packages, 2-week strip, Ask / Profile / Book) | PASS | |
| Vertical picker, service chips, empty state ("You've seen everything") | PASS | Videography has providers but no photos, so its deck is empty (data) |
| Your taste / Shortlist sheets signed out | PASS | Sign-in prompts |
| Explore masonry, tile → gallery at that photo, Back | PASS | |

## Search

| Feature | Result | Notes |
| --- | --- | --- |
| Text search, vertical + service chips | PASS | |
| Filters sheet (price by unit, rating, distance, trust), active chips | PASS | |
| Sort sheet | PASS | |
| Dates sheet, date chips, "free on all N dates", Book with dates | PASS | |
| Map view on web (list fallback + provider card, `?focus=`) | PASS | |
| Native map (pins, radius circle, Search this area, locate, zoom out) | FIXED + PHONE | "Search this area" appeared right after the map loaded (see Fixes 1) |

## Profiles

| Feature | Result | Notes |
| --- | --- | --- |
| Portfolio / Packages / Gear / Reviews tabs | PASS | Duplicate reviews on Maya come from duplicated seed rows (data) |
| Followers sheet | PASS | |
| Follow / shortlist signed out | PASS | "Sign in to follow vendors" toast |
| Ask a question signed out → sign-in with `next` | PASS | |
| Add to event (sheet with events, Added / Add, New event with …) | PASS | |
| Share: vendors → in-app ShareSheet; people → system share | FIXED | People link now uses `Linking.createURL` (see Fixes 6) |
| Tagged in | NOTE | Hidden: no `album_credits` rows in the hosted DB yet. Code path reviewed |
| Unknown id → "Profile not found" | PASS | |

## Gallery

| Feature | Result | Notes |
| --- | --- | --- |
| `/gallery/:id?post=`, `/post/:id` redirect | PASS | |
| Album pager (vertical), photo pager (horizontal), counter | PASS (web) / PHONE | Pinch zoom and hold-to-hide need touch |
| Info sheet (caption, place, tags) | PASS | |
| Like / save signed out, Share sheet, Close, Book | PASS | |
| Start at a later album after the viewer measures itself | FIXED | See Fixes 2 |

## Booking

| Feature | Result | Notes |
| --- | --- | --- |
| Fixed, hourly (hours stepper), per person (guests stepper + typed value clamped to min/max), per item, daily, quote | PASS | Totals, deposit, "Per date / Total for N dates" |
| Multi-date requests, busy days crossed out | PASS | |
| Signed out → sign-in keeps pkg / dates / **event** | FIXED | `?event=` was dropped (Fixes 3) |
| Bookings list: calendar, Needs your attention, Upcoming / Past | PASS | |
| Booking detail, client: countered (accept / decline), accepted, delivered, completed, cancelled | PASS | Actions call the right RPCs |
| Booking detail, vendor: requested (accept / counter sheet / decline), ID-verify note | PASS | |
| Cancel sheet (policy, refund) | PASS | |
| Delivery, Review (stars, double-blind), "Booking details" / "Back to booking" | FIXED | They pushed a second copy of the booking (Fixes 4) |
| Not found / signed out states | PASS | |

## Inbox and chat

| Feature | Result | Notes |
| --- | --- | --- |
| Inbox list (DM, group, inquiry), unread, new message picker | PASS | |
| Chat: day separators, stacked bubbles, read receipt "Sent / Seen" | PASS | |
| Send (optimistic) | PASS | Retry / delete path code-reviewed |
| Details sheet (DM: report or block; group: members, add, rename, leave) | PASS | |
| Event chat header → event board | PASS (ev fixtures) | |
| Share cards in chat | NOTE | Rendering reviewed. Realtime and typing need two devices: PHONE |
| Unread badge after reading a chat | FIXED | See Fixes 8 |
| Long-press a message → report / block | PHONE | The bubble's text is `selectable`; check long-press still opens the sheet on iOS and Android |
| KeyboardView keeps the composer above the keyboard | PHONE | |

## Events and planner

| Feature | Result | Notes |
| --- | --- | --- |
| Events list, event board (budget, groups, votes, statuses), candidate sheet | PASS | |
| Book for event (passes `event` + date) | PASS | |
| Invite, open group chat, leave event → /events | PASS | |
| New event form | PASS | |
| Planner: intro, result (brief chips, budget split, picks), error state | PASS | |
| Planner composer above the keyboard on Android | FIXED + PHONE | See Fixes 7 |

## Posting and vendor tools

| Feature | Result | Notes |
| --- | --- | --- |
| Upload for a caterer, DJ, photographer; listing picker with several listings | PASS | |
| Pick photos (web file chooser), cover / order, details, occasion, credits (tag a vendor), Post | PASS | Writes: albums, photos, uploads, cover, album_credits |
| Client → "Posting is for vendors" | PASS | |
| Upload from the phone library | FIXED + PHONE | Blob `type` assignment could throw (Fixes 5) |
| My work (empty), Me business mode, checklist, Dashboard tabs | PASS | |
| New listing (`?v=` preset), Settings | PASS | |

## Account

| Feature | Result | Notes |
| --- | --- | --- |
| Sign in: invalid email, short password (sign up), forgot password, code step | PASS | No real sign-in done |
| Google button | PASS | Opens `…/auth/v1/authorize?provider=google&redirect_to=<app>/auth/callback`; a blocked popup shows an error |
| Auth callback (`?next=`), reset password screen | PASS | |
| Welcome gate (new account → /welcome?next=…) | FIXED | `next` repeated the route's own id (Fixes 9) |
| Settings → Appearance Light / Dark / System (saved as `pm:theme`) | PASS | |
| Deep links `eventorganizer://…` | PHONE | Routes mirror the web paths; scheme set in app.json |
| Back navigation, 404 page, empty / error / loading states | PASS | |

## Fixes made

1. `components/map/ProviderMap.tsx`: the first `onRegionChangeComplete` (the map fitting `initialRegion` to its own size) counted as the user moving the map, so "Search this area" could show right away. The first report now sets the starting view.
2. `screens/gallery/AlbumViewer.tsx`: pages are sized from the window until the viewer measures itself. When the real height differs (e.g. Android system bars), the list now scrolls back to the current album, so it stays lined up.
3. `screens/bookings/BookingRequest.tsx`: the sign-in redirect dropped `?event=`, so a booking started from an event board lost its event link.
4. `screens/bookings/Review.tsx`, `Delivery.tsx`: "Back to booking" / "Booking details" now use `router.dismissTo` instead of pushing a second copy of the booking.
5. `shims/images.ts` `prepareUpload`: assigning `blob.type` throws in strict mode (RN's and the browser's `Blob.type` are getter-only) when the picked file has no type. It now uses `Object.defineProperty`.
6. `screens/profile/Profile.tsx`: sharing a person used a hard-coded `eventorganizer:/…`. It now uses `Linking.createURL`, so the link also opens in Expo Go.
7. `screens/planner/Planner.tsx`, `screens/SignIn.tsx`, `components/Sheet.tsx`: replaced `KeyboardAvoidingView` (behavior `undefined` on Android, which does nothing with SDK 57 edge-to-edge) with the app's `KeyboardView`. Without it the planner composer, sign-in fields and sheet inputs stayed under the keyboard.
8. `hooks/useUnreadCount.ts`: also rechecks on navigation (like the web TabBar), so the inbox dot clears after you read a chat.
9. `state/WelcomeGate.tsx`: `next` repeated the dynamic route params (`/u/x?id=x`). Path params are now left out.

## For mobile-a11y (presentation only)

- Nested heading Text warns on web: `<h1> cannot contain a nested <h1>` (SignIn `display` title with the accent dot, and Welcome).
- The first-name label trick reads oddly for business names: "Book DJ", "Notes for The", "The will confirm…" (shared `name.split(' ')[0]`, same on the web).

## Needs a real phone

Map gestures and pins; the swipe deck with touch; pinch zoom and hold in the gallery; the
image picker and upload (EXIF, HEIC); Share sheets; keyboard on iOS and Android (Chat, Planner,
Sign in, sheets); long-press report in Chat; realtime and typing; deep links / email links
(`eventorganizer://`, `exp://`); Google sign-in round trip in Expo Go (needs `exp://**` in
Supabase Redirect URLs).
