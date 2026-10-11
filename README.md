# photographer-match

A marketplace to **find, compare, book and pay service providers**. Photographers come first. Later it expands to every vendor for an event (musicians, caterers, makeup artists, florists, venues), with an AI event planner that drafts bookings and the user approves and pays each one.

The main rule across all the docs: **the booking core is category-agnostic from day one.** Providers, packages, availability, bookings and reviews never reference "photographer" directly. Each category adds its own schema-validated fields.

## Status

| Part | State |
|---|---|
| `frontend/` | Clickable mobile prototype on mock data (not yet connected to the database) |
| Database + auth | Supabase set up and tested (`supabase/`, design in [`docs/DATABASE.md`](docs/DATABASE.md)) |
| Docs | Two design docs, not yet reconciled (see below). Session-by-session status: [`docs/PROGRESS.md`](docs/PROGRESS.md) |

## Docs

- [`architecture.md`](architecture.md): service-based backend design. Covers services and their boundaries, the event bus, the booking state machine, payments and escrow, the media pipeline, recommendations, the AI planner, chat contact masking, trust and safety, and build phases.
- [`docs/PLAN.md`](docs/PLAN.md): product and feature spec for the photographer vertical. Covers posting, swipe Discover, profiles, booking flow, delivery galleries, payments, monetization, extra features, and the multi-service event expansion.
- [`orchestrator/README.md`](orchestrator/README.md): plan-driven Claude Code orchestrator. You write and approve a plan in `plans/`, it implements and verifies it locally, then opens a PR for review.

### Open decisions: where the docs disagree

| Topic | `architecture.md` | `docs/PLAN.md` |
|---|---|---|
| Backend | ~8 FastAPI services, Postgres per service, Redis, RabbitMQ/SNS+SQS event bus | Supabase (Postgres, Auth, Storage, Realtime) plus one FastAPI ML service |
| Client | React web (Vite or Next.js); React Native later | Expo mobile-first, plus Next.js web |
| Repo layout | `/services`, `/libs`, `/web`, `/infra` | pnpm + Turborepo: `apps/`, `packages/`, `services/`, `supabase/` |
| Build order | Booking loop first; feed and swipe in phase 3 | Posting and social first; booking in phase 3 |
| Booking states | `requested → accepted → paid → in_progress → delivered → completed` | `requested → (accept, pay deposit) → confirmed → in_progress → delivered → completed` |
| Delivery export | Presigned ZIP, then "Save to Drive/Dropbox" with the user's token; no server-side rclone | rclone worker streams files to Google Drive, Dropbox or OneDrive |
| Contact masking in chat | Hide phone and email until paid, detect and nudge | Not covered |

Both docs agree on Stripe Connect with funds held until delivery, ID verification through Stripe Identity (separate from the paid Pro tier), reviews only after a completed booking, AI-image flagging with RAW-file review, a swappable recommender with exploration and corrections, and an AI planner that can never pay or book on its own.

## Frontend prototype

`frontend/` is a Vite + React (JavaScript) app for visualizing the product. Everything runs on mock data in `src/data/mock.js`. It shows a phone frame on desktop and fills the screen on a phone.

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
npm run dev -- --host  # also reachable from a phone on the same Wi-Fi
```

What it covers:

- **Home:** search, bookings that need action, categories, photographers matched to your taste, available this weekend, top rated nearby.
- **Discover:** swipe deck filtered by category. Each card is a mini portfolio with "why this" reasons, "Not into this" corrections, a taste profile, a shortlist, and a match prompt after you like a photographer twice.
- **Search:** filters (date, price, rating, Verified Pro), sorted by taste match, with list and map views.
- **Provider profile:** badges, availability, packages, gear, reviews, cancellation policy, "Ask a question".
- **Booking:** request flow (package, date, add-ons, travel fee, deposit), status timeline, deposit payment, counter offers, cancellation refunds, disputes.
- **After the shoot:** delivery gallery (favorites, zip download, cloud export) and double-blind reviews.
- **Inbox:** booking threads, inquiries and group chats.
- **Me:** client view (rating, saved items, settings) and provider view (identity verification, payouts, incoming requests, calendar, packages, portfolio upload with EXIF and AI-review flow).

Booking detail pages have a dashed **"Prototype · simulate the other side"** box, so one person can walk through both sides of a booking. It's a demo aid, not a product feature.

The prototype follows `docs/PLAN.md`'s booking states. It isn't wired to any API and isn't meant to be the production frontend as-is.

## Backend (planned)

Nothing is built yet, and the shape depends on the open decisions above. If it starts as a single FastAPI app before splitting into services, the local setup would look like:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -e .
uvicorn app.main:app --reload --port 8000
```

## Working in this repo

- Two people work in this repo, so push work to a branch and open a pull request instead of pushing straight to `main`.
- Don't commit secrets. `.env` is already ignored.
