# SmartLand Business Suite: plan

Status: Checkpoint 0 approved 2026-11-26 (decisions in section 9). Checkpoint 1 built. Branch `feat/business-suite` from `main` at e562292.
Written 2026-11-26 from the Business Suite prompt. `docs/business-suite-plan.md` wasn't in the repo, so this plan uses the prompt alone.

## What exists today

Facts from the code that shape this plan:

- **Accounts** (`store.py` `users`): id, email, name, password hash, `google_sub`. There's no "email verified" flag. Password sign-ups never confirm their email. Google sign-ins have a Google-verified email.
- **Sessions**: HS256 JWT signed with `JWT_SECRET`, 30 days, sent as a bearer token from `localStorage`.
- **Rate limits**: one slowapi `Limiter` keyed per signed-in user, or per IP for guests (`rate_key` in `main.py`).
- **Listings** belong to one user (`listings.user_id`). Every owner check is `user_id = ?` inside `store.py` (`set_listing_status`, `set_listing_price`, `listing_owner`).
- **Phone privacy**: search results drop `contact_phone` through `_with_trust(phone=False)`. A single listing page still shows it. Both stay as they are.
- **Brokers** already give a PRC license per listing (`ListingIn.prc_license`), and the listing page links to the PRC lookup.
- **Database**: one SQLite file. On Cloud Run, `deploy.ps1` already supports Litestream: with `SMARTLAND_BUCKET` set, every change is copied to `gs://<bucket>/db` within about a second and restored on start. Without the bucket, the database sits in `/tmp` and resets. The web app runs on one instance (`--max-instances 1`) because of SQLite.
- **PostGIS** (`smartland_geo`): read only, for elevation. `POSTGRES_URI` defaults to `localhost` and `deploy.ps1` doesn't set it, so production has no PostGIS today. It runs on your PC.
- **Dockerfile** copies backend files by name. Every new backend module must be added there.
- **Tests**: none. No `backend/tests/`, no pytest in `requirements.txt`.

## Order of work

The prompt has two starting points: the full suite (Checkpoints 1 and 2), and the Nov 25 Cloqui update that builds a minimal org first. Checkpoint 1 below is a superset of the minimal org (Checkpoint A), so the order works either way:

1. **Checkpoint 1**: orgs, members, invites, `can()`, tests. This covers Checkpoint A.
2. **Then either** Checkpoint 2 (CRM) or Checkpoint 3 (Cloqui link), whichever you want first. Checkpoint 3 needs the Cloqui side (3.2) done before step B can be tested end to end.

## 1. Data model

All IDs are text. New IDs use `secrets.token_urlsafe(9)` like listings, except `users.id`, which stays uuid hex. Times are ISO 8601 UTC text in SQLite and `timestamptz` in Postgres.

### Change to `users`

| Column | Type | Notes |
|---|---|---|
| `email_verified` | integer 0/1, default 0 | Set to 1 on Google sign-in. Needed for the Cloqui handoff and for accepting invites. See open question Q2 for password accounts. |

### `orgs`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `name` | text, 2 to 80 chars | Shown on listings and in Cloqui |
| `kind` | text | `brokerage`, `developer`, `agency`, `other` |
| `prc_license` | text, null | Required when `kind = 'brokerage'`. Same pattern as listings: 4 to 10 digits |
| `created_by` | text FK users | |
| `created_at` | text | |

### `org_members`

| Column | Type | Notes |
|---|---|---|
| `org_id` | text FK orgs, cascade | PK with `user_id` |
| `user_id` | text FK users, cascade | |
| `role` | text | `owner`, `admin`, `member`, `guest` |
| `joined_at` | text | |

Exactly one `owner` per org. A partial unique index enforces it: `CREATE UNIQUE INDEX org_one_owner ON org_members (org_id) WHERE role = 'owner'` (SQLite and Postgres both support this).

### `org_invites`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `org_id` | text FK orgs, cascade | |
| `email` | text | Lowercased |
| `role` | text | `admin`, `member`, `guest`. Never `owner` |
| `token_hash` | text, unique | SHA-256 of the invite token. The token itself is shown once, never stored |
| `invited_by` | text FK users | |
| `created_at`, `expires_at` | text | 7 days |
| `accepted_at`, `accepted_by` | text, null | |

### `listings.org_id`

`ALTER TABLE listings ADD COLUMN org_id TEXT REFERENCES orgs(id)`. Null for solo sellers, so their listings work as now. `user_id` stays as "who posted it".

### `pipeline_stages`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `org_id` | text FK orgs, cascade | |
| `name` | text | |
| `position` | integer | |
| `outcome` | text, null | `won`, `lost`, or null for open stages |

Seeded per org: New, Contacted, Viewing set, Offer, Closed won (`won`), Closed lost (`lost`).

### `contacts`

The person behind one or more leads, per org. Store only what's needed to reply.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `org_id` | text FK orgs, null | Null for a solo seller's contacts |
| `owner_user_id` | text FK users | The solo seller, or the org member who added it |
| `name` | text, 2 to 80 | |
| `phone` | text, null | At least one of phone or email |
| `email` | text, null | |
| `consent_at` | text, null | Set from the inquiry form. Null for contacts added by hand |
| `consent_version` | text, null | Which consent text they agreed to, for example `2026-11-v1` |
| `created_at`, `updated_at` | text | |

No address, birthday, ID numbers, or IP addresses.

### `leads`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `org_id` | text FK orgs, null | Copied from the listing at inquiry time |
| `owner_user_id` | text FK users | The listing's poster, or whoever added a manual lead |
| `contact_id` | text FK contacts, cascade | |
| `listing_id` | text FK listings, null | Null for manual leads not tied to a listing |
| `stage_id` | text FK pipeline_stages, null | Null for solo sellers (see Q3) |
| `assignee_id` | text FK users, null | Must be a member of `org_id` |
| `source` | text | `inquiry`, `manual`. Later: `video:<id>` for UTM |
| `message` | text, up to 1000 | The buyer's first message |
| `follow_up_on` | text date, null | |
| `created_at`, `updated_at`, `closed_at` | text | |

Index on `(org_id, stage_id)`, `(owner_user_id)`, `(follow_up_on)`.

### `lead_activities`

The timeline. Append only.

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | |
| `lead_id` | text FK leads, cascade | |
| `actor_id` | text FK users, null | Null for the buyer's own inquiry |
| `kind` | text | `created`, `note`, `stage`, `assigned`, `follow_up`, `task` |
| `body` | text JSON | For example `{"from": "New", "to": "Contacted"}` or `{"text": "..."}` |
| `created_at` | text | |

### `follow_ups`

The prompt lists this table. I suggest one `follow_up_on` date on `leads` plus a `follow_up` activity row instead, because a lead has one next step at a time. If you want several reminders per lead, it becomes its own table: `id`, `lead_id`, `due_on`, `note`, `done_at`, `created_by`. See Q4.

## 2. Database plan

### The current risk

SQLite on Cloud Run loses data on deploy only when `SMARTLAND_BUCKET` isn't set. With the bucket, Litestream restores it. Two limits stay either way: one web instance only, and up to about a second of changes lost if the container dies mid-write. For a CRM with a few orgs, that's fine for now. It stops being fine when you need a second instance or Cloqui needs to read SmartLand data directly.

### Options

Prices are list prices I know as of late 2026 for Singapore (`asia-southeast1` / `ap-southeast-1`). Check them on the pricing pages before you buy anything.

| | (a) Supabase Postgres | (b) Cloud SQL for PostgreSQL | (c) Existing PostGIS `smartland_geo` |
|---|---|---|---|
| What it is | Managed Postgres, own project | Google-managed Postgres, same project as Cloud Run | The database on your PC, for elevation |
| Monthly cost | Free tier: $0 (500 MB, pauses after 7 days without traffic, no backups). Pro: about $25 for the org, which includes one Micro compute. A second project on the same Pro org adds about $10 | db-f1-micro, 10 GB SSD, daily backups: about $12 to $15. No free tier | $0 while it stays on your PC, but Cloud Run can't reach it. Hosting it means Cloud SQL (as b, larger because of the 30 m DEM raster, about $20 to $30) or a VM (e2-small plus disk, about $15, and you run backups and updates) |
| Backups | Pro: daily, 7 days | Daily, 7 days, point in time optional | Yours to set up |
| Fit with Cloqui | Cloqui already runs on Supabase. Same tools, same dashboard, and Cloqui needs Pro anyway | Separate stack from Cloqui | None |
| Connection from Cloud Run | Pooler URL over TLS, no VPC | Cloud SQL connector, no VPC | Not reachable today |

### Recommendation

**(a) Supabase Postgres, in its own project in the same Supabase org as Cloqui.** When Cloqui moves to Pro (about $25 a month, already planned), the SmartLand project adds about $10 a month on Micro compute. Total for both apps: about $35 a month. Keep SmartLand and Cloqui in separate projects so neither app can read the other's tables.

Until you say go on that cost, keep SQLite with Litestream behind the repository layer. Confirm `SMARTLAND_BUCKET` is set on your last deploy (Q1). Nothing in Checkpoints 1 to 3 needs Postgres.

Keep PostGIS for elevation only. Mixing business data into a database that lives on your PC puts customer data on a laptop with no backups.

### Repository layer

- New `backend/db.py`: the one connection, a `transaction()` context manager, and `?` placeholders. Today it wraps `sqlite3`. On the move it wraps `psycopg` (sync, to match current code) and rewrites `?` to `%s`.
- New `backend/orgs_repo.py` and `backend/crm_repo.py`: every SQL statement for the new tables, written in the subset SQLite and Postgres share (no `INSERT OR REPLACE`, use `ON CONFLICT`. No SQLite date functions).
- `store.py` keeps its own `_db()` for now and moves onto `db.py` in a separate step, so this branch doesn't touch working listing code more than it must.
- Migrations: numbered SQL files in `backend/migrations/` (`001_orgs.sql`, `002_crm.sql`) with a `schema_migrations` table recording which ran. Same files feed Postgres later.

### One-time migration script (for later)

`backend/scripts/sqlite_to_postgres.py`, run once by you, never on deploy:

1. Put the site in read-only mode (an env flag the backend checks on writes) and wait for Litestream to settle.
2. Download the latest replica: `litestream restore -o smartland.db gcs://<bucket>/db`.
3. Create the schema in Postgres from `backend/migrations/` (Postgres variants).
4. Copy tables in foreign key order: users, orgs, org_members, org_invites, listings, documents, photos, listing_events, reports, shares, pipeline_stages, contacts, leads, lead_activities. Batches of 1,000 with `COPY`.
5. Check row counts per table and run `listing_rules.verify_chain` on every listing's events. Stop if any chain breaks.
6. Deploy with `DATABASE_URL` set, raise `--max-instances`, and turn read-only off.
7. Keep the SQLite replica for 30 days as a fallback.

## 3. Permissions

One helper, `can(user, action, org_id)`, in `backend/permissions.py`. Every business route calls it before reading or writing. It raises 404 (not 403) when the user isn't in the org, so nobody can probe which org IDs exist. It raises 403 when they're in the org but their role is too low.

| Action | owner | admin | member | guest |
|---|---|---|---|---|
| `org.view` | yes | yes | yes | yes |
| `org.edit` (name, license) | yes | yes | no | no |
| `members.manage` (invite, change role, remove) | yes | yes | no | no |
| `listing.post_as_org` | yes | yes | yes | no |
| `listing.edit_org` (any org listing) | yes | yes | own only | no |
| `leads.view` | yes | yes | yes | assigned only |
| `leads.edit` | yes | yes | yes | no |
| `leads.delete` | yes | yes | no | no |
| `workspace.open` (Cloqui) | yes | yes | yes | yes |

Rules on top of the table:

- The owner can't be removed or demoted. Ownership transfer is out of scope for now.
- An admin can't promote anyone to owner, or change another admin's role. Only the owner can.
- For solo sellers (`org_id` null), the rule is `owner_user_id == user.id`.
- Listing edits for org listings go through `can()` too: `store.set_listing_status` and friends get an `org_id` check alongside `user_id`.

Tests prove a member of org A gets 404 on every org B route: get org, list members, invite, change role, list leads, get one lead, move a lead, add a note, open the workspace.

## 4. Lead flow

1. A buyer opens a listing and taps **Ask about this listing**, under the seller's name in the contact card.
2. A short form opens in place: name, phone or email (at least one), message, and a consent checkbox. A hidden field catches bots.
3. `POST /api/listings/{id}/inquiries` (no sign-in needed). Rate limits: `5/hour` and `20/day` per IP. A second inquiry from the same phone or email on the same listing within 24 hours adds to the existing lead instead of making a new one.
4. The backend finds the listing's `org_id` and `user_id`, creates or reuses the contact, creates the lead in the first stage, and logs a `created` activity.
5. The buyer sees: "We sent your message to {seller name}. They'll contact you by phone or email."
6. The seller's org sees it on `/business/leads`. A solo seller sees it under **Inquiries** on `/listings/mine` (see Q3).

Inquiries on sold listings are refused. Search results keep dropping phone numbers. Buyer phone numbers and emails never appear in any listing response.

### Consent text (Data Privacy Act of 2012)

Checkbox label, version `2026-11-v1`:

> I agree that SmartLand shares my name, contact details, and message with this seller so they can reply about this property. They and SmartLand keep them for up to 2 years, and I can ask SmartLand to delete them at any time.

Below the form: "SmartLand processes your details under the Data Privacy Act of 2012 (Republic Act No. 10173)." with a link to a privacy notice. The privacy notice page doesn't exist yet. I'll draft it in Checkpoint 2 for your review. A lawyer should read it before launch.

Retention: a daily cleanup removes the contact details of leads closed more than 2 years ago and keeps the stage history. Admins can delete a lead and its contact at any time.

## 5. Cloqui handoff contract

SmartLand's half. Cloqui's half is built in the Cloqui repo (3.2), not from here.

### Handoff (browser opens the workspace)

`POST /api/business/workspace/handoff` with `{ "org_id": "..." }`. Signed-in members only, `can(user, 'workspace.open', org_id)`. Rate limit `10/minute` per user.

Refuses with 403 and "Confirm your email to open the workspace." when `users.email_verified` is 0.

Returns `{ "url": "<CLOQUI_URL>/api/handoff", "token": "<jwt>" }`. The secret stays on the server.

Token: HS256 signed with `CLOQUI_HANDOFF_SECRET_SMARTLAND`.

| Claim | Value |
|---|---|
| `app` | `smartland` |
| `org_id`, `org_name` | from `orgs` |
| `user_id`, `email` | from `users` |
| `email_verified` | `true` (never issued otherwise) |
| `role` | the member's role |
| `iat`, `exp` | now, now plus 60 s |
| `jti` | `uuid4().hex`, new each call |
| `iss`, `aud` | `smartland`, `cloqui-handoff` (proposed addition: Cloqui should check both. Tell the Cloqui session if you agree) |

Frontend: on **Open workspace**, the click handler opens a blank tab named `cloqui` first (so popup blockers allow it), then fetches the token, then submits a hidden `<form method="post" target="cloqui">` with one `token` field. The token travels in the POST body, never in a URL, so it isn't in history or server logs.

### Server to server (Checkpoint C)

`backend/cloqui_client.py`, using `httpx` with a 5 s timeout. Each call signs a fresh token: same secret, `aud: cloqui-api`, `iss: smartland`, `app: smartland`, `org_id`, 60 s expiry, new `jti`.

- `create_circle(org_id, external_ref)` → `POST /api/apps/circles`
- `create_task(org_id, title, notes, link, circle_ref=None)` → `POST /api/apps/tasks`
- `summary(org_id)` → `GET /api/apps/summary?org_id=`

If Cloqui is down or slow, `summary` returns `None` and `/business` shows "Workspace is offline right now." The rest of the page keeps working.

### Env keys (names only)

`backend/.env`: `CLOQUI_HANDOFF_SECRET_SMARTLAND`, `CLOQUI_URL`. Production: same two in `deploy.ps1`, passed as Cloud Run env vars from your shell like `SMARTLAND_JWT_SECRET`. A Secret Manager move is possible later and costs about $0.06 per secret a month.

## 6. Screens

All copy follows the my-tone skill. Layout follows `DESIGN.md`.

| Route | What it shows |
|---|---|
| `/account` | Your profile as now, plus a **Business** section: your orgs with your role, **Open** for each, and **Create a business account** |
| `/business/new` | Name, kind, PRC license (shown and required for brokerages), **Create business account** |
| `/business` | Overview of the current org: name and license, **Open workspace**, follow-ups due today and overdue, lead counts per stage, Cloqui panel (unread messages, open tasks) |
| `/business/team` | Members with roles. Owner and admins see **Invite**, a role menu per member, and **Remove**. Pending invites with **Copy link** and **Cancel** |
| `/invite/:token` | "{Inviter} invited you to {org} as {role}." Signs you in first if needed. **Join {org}** |
| `/business/leads` | Board (one column per stage, drag and drop) and list (sortable table). Toggle between them. Each card has a **Move to** menu for keyboard and touch. **Add lead** |
| `/business/leads/:id` | Contact, linked listing, stage, assignee, follow-up date, note box, timeline |
| `/business/contacts` | List with search. A contact's page lists their leads |

With more than one org, a switcher in the `/business` header picks the current one, kept in `localStorage`.

Org listings: the post form gets **Post as** (you, or one of your orgs where you're at least a member). Org listings show the org name, and the PRC license for brokerages, in the contact card and on `TrustBadges`.

Drag and drop uses native HTML5 drag events, no new library. The **Move to** menu is the accessible path and works without dragging.

## 7. File-by-file changes

### Backend

| File | Change |
|---|---|
| `backend/deps.py` (new) | `JWT_SECRET`, `issue_token`, `authenticate`, `optional_user`, `is_admin`, `limiter`, moved out of `main.py` so routers can import them without a cycle |
| `backend/db.py` (new) | Connection, `transaction()`, migration runner |
| `backend/migrations/001_orgs.sql`, `002_crm.sql` (new) | Tables above |
| `backend/orgs_repo.py`, `backend/crm_repo.py` (new) | All SQL for the new tables |
| `backend/permissions.py` (new) | `can()` and the role table |
| `backend/business.py` (new) | `APIRouter` for `/api/business/*` and `/api/invites/*` |
| `backend/inquiries.py` (new) | `POST /api/listings/{id}/inquiries` |
| `backend/cloqui.py` (new) | Handoff route and token signing |
| `backend/cloqui_client.py` (new) | Server-to-server client (Checkpoint C) |
| `backend/main.py` | Import from `deps.py`, include the routers, add `org_id` to `ListingIn` with a `can()` check |
| `backend/store.py` | `email_verified` column, set it in `google_user`. `org_id` on listings. Org-aware owner checks |
| `backend/requirements-dev.txt` (new) | `pytest` |
| `backend/tests/conftest.py` (new) | Temp `DATABASE_PATH` per test, `TestClient`, user and org factories |
| `Dockerfile` | Copy the new modules and `migrations/` |
| `deploy.ps1` | Pass `CLOQUI_URL` and `CLOQUI_HANDOFF_SECRET_SMARTLAND` |
| `README.md` | Business suite section and the new env keys |

### Frontend

| File | Change |
|---|---|
| `src/lib/api.ts` | `businessApi` (orgs, members, invites, leads, contacts, handoff, summary) and types. `inquire()` on `listingsApi`. `email_verified` on `User` |
| `src/lib/business.ts` (new) | Current org hook, `openWorkspace()` form post |
| `src/App.tsx` | New routes and titles |
| `src/pages/Account.tsx` | Business section |
| `src/pages/Listing.tsx` | **Ask about this listing** form. Org name and license in the contact card |
| `src/pages/MyListings.tsx` | Inquiries for solo sellers (Q3) |
| `src/pages/NewListing.tsx` | **Post as** picker |
| `src/pages/business/*.tsx` (new) | `NewOrg`, `Overview`, `Team`, `Leads`, `Lead`, `Contacts`, `Invite` |
| `src/components/Trust.tsx` | Org name on `TrustBadges` |

## 8. Tests

`backend/tests/`, run with `pytest` from `backend/`.

Checkpoint 1:
- Creating an org makes the creator its owner and seeds six stages.
- Brokerage org without a PRC license is refused.
- Only owner and admin can invite, change roles, and remove. Member and guest get 403.
- The owner can't be removed or demoted. An admin can't make an owner.
- An invite expires after 7 days. A used invite can't be used again. An invite only works for the email it was sent to.
- A member of org A gets 404 on every org B route.
- Solo listings still post, edit, and delete as before.

Checkpoint 2:
- An inquiry creates a lead in the listing's org and in the first stage.
- An inquiry on a solo listing goes to the seller only.
- Org B can't see org A's lead, contact, or the buyer's phone, through any route.
- Search results and listing responses never contain a buyer's phone or email.
- A stage change, assignment, and note each add one activity.
- An assignee must be a member of the org.
- Inquiries without consent are refused. The 6th inquiry in an hour from one IP gets 429.
- Repeat inquiries within 24 hours join the existing lead.

Checkpoint 3:
- Non-member and unverified email get refused.
- The token has every claim, the right `app`, and `exp - iat == 60`.
- Two calls give two different `jti`.
- The secret never appears in any response.
- Cloqui client calls with the client mocked: success, timeout shows offline, wrong org refused.

## 9. Decisions (2026-11-26)

- **Q1. Bucket:** `SMARTLAND_BUCKET` is set on production, so Litestream keeps the SQLite file between deploys.
- **Q2. Workspace sign-in:** only verified emails (Google sign-ins today) can open the Cloqui workspace. Email confirmation for password accounts waits for an email-sender cost check.
- **Q3. Solo sellers get the full CRM.** Each seller gets a private org with `kind = 'personal'`, created the first time they need it (their first inquiry, or opening the CRM). All leads then live in an org, so `can()` covers everyone the same way. A personal org has one member, can't invite anyone, never shows on listings, and is hidden from the business account list. Solo listings keep `org_id` null. An inquiry on a solo listing goes to the poster's personal org.
- **Q4. Follow-ups:** one `follow_up_on` date per lead. No `follow_ups` table.
- **Q5. Invites:** the owner or an admin copies the invite link and sends it. No invite emails yet.
- **Q6. pytest** is installed in `backend/venv`. The venv stays out of every commit.
- **Q7. Two-way messages (Checkpoint 2).** Each inquiry is a thread (`lead_messages`). A buyer who asks while signed in reads replies on `/messages` and can answer there. A buyer who asks signed out gets replies by phone or email only, and the team can't send them in-app messages. Notes stay private to the team. No push or email alerts for new messages until an email-sender cost check. A new-message count shows in the nav and on leads.

Invites only need the signed-in email to match the invite's email, not a verified one: the link itself is the secret, and it works once.

## 10. Later checkpoints (plan only)

Each gets its own estimate before any work.

- **4. Videos in circles**: Cloqui's recorder and private R2 playback. Cloudflare R2 is $0.015 per GB a month with free egress, and 10 GB free. I'll size it from expected minutes per org.
- **5. Huddles and private live**: LiveKit rooms. LiveKit Cloud's free tier covers a small number of participant minutes. Per-org minute caps go in before launch.
- **6. Auto Shorts**: **Make a Short** on a listing sends title, price, location, area, trust badges, PRC license, and photos to AutoShorts Studio's Listing mode. Template mode (FFmpeg, no AI credits) by default. AI mode stays inside the 20-credit Higgsfield budget. Every video goes to Approvals first. Captions use listing facts only.
- **7. Performance page**: `/business/videos` with views, likes, comments, and shares from AutoShorts Studio snapshots, and leads per video through UTM on the listing link (`leads.source = video:<id>`).

Platform reviews for 6 and 7: YouTube Data API audit for upload quota beyond the default, Meta App Review plus Business Verification for Instagram and Facebook publishing, and the TikTok Content Posting API audit (unaudited apps post private only). None cost money, but each takes days to weeks.
