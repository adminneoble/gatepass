# Gatepass

Visitor management for residential and commercial societies. It has four roles, one backend and one responsive web app:

| Role | Where | What they do |
|---|---|---|
| Security | `/gate` (phone or gate tablet) | Log walk-ins, verify pass codes or QR codes (camera or USB/RFID reader), allow entry and exit, handle resident alerts |
| Member (owner or tenant) | `/app` | Approve or deny walk-ins, pre-approve guests, extend approvals, view activity, manage tenant routing, alert security |
| Admin | `/admin` (desktop sidebar, phone tabs) | Society settings, unit directory, tenant requests, all activity |
| Visitor | `/p/<token>` (no app, no sign-in) | Opens the entry pass from the SMS link |

The design reference is in [design_handoff_gatepass/](design_handoff_gatepass/). [docs/DESIGN_REVIEW.md](docs/DESIGN_REVIEW.md) records what changed from it and why.

## Run it

Requires Node 22 or later.

```bash
npm install
npm run dev          # API on :4000, web on :5173 (proxies /api)
```

Open http://localhost:5173. On first start the database is created and seeded with the demo society from the prototype (Palm Grove Residency). The login page lists demo accounts. In development the OTP is shown on screen.

| Account | Mobile |
|---|---|
| Security · Gate desk | 98000 12345 |
| Ananya Rao: owner of B-402 and C-110 (C-110 is rented to Vikas) | 98111 00001 |
| Vikas Iyer: tenant of C-110 | 98111 00002 |
| Admin · Kavita Desai | 98000 00001 |

**Playing the visitor:** visitors have no app. Every SMS is written to an outbox, and http://localhost:5173/dev/sms shows it as a phone inbox. Pass links, OTPs and approval messages all land there.

To try the full flow, open two browser profiles. Sign in as Security in one and as Ananya in the other. A walk-in logged for B-402 appears on Ananya's phone instantly.

```bash
npm test             # API flow tests (routing, OTP, passes, alerts, tenant requests, scoping)
npm run db:reset     # wipe and re-seed server/gatepass.db
npm run build && npm start   # production: one Node process serves API + built web app on :4000
```

## Architecture

```
server/  Node + Express 5 + TypeScript, SQLite (better-sqlite3)
  src/db/schema.sql      tables: society, people, staff, units, visits, passes, tenant_requests,
                         alerts, events (audit log), notifications, otps, sessions, sms_outbox
  src/domain.ts          routing rule (who gets a unit's requests), activity log, notifications
  src/auth.ts            mobile OTP sign-in, cookie sessions, role guards
  src/routes/            core (auth, society, public pass, dev SMS) · gate · member · admin
  src/lib/realtime.ts    Server-Sent Events: cache invalidation + live banners
  src/lib/sms.ts         SMS provider interface (plug in your gateway here)
web/     React 19 + Vite + TanStack Query + React Router
  src/styles/            design tokens (light and dark) and component CSS: the refined Modernist system
  src/ui/                component library (Button, Field, Seg, Chips, Toggle, Tag, Sheet, QR…)
  src/pages/             gate/ · member/ · admin/ · shared/Activity · Login · PassPage · DevSms
```

**Notices:** admins broadcast announcements from **Admin → Notices**. A notice can go to everyone, residents only (owners and tenants), security only, or selected blocks.
- **Priority:** Normal, Important or Urgent. Urgent notices require an "I've read this" acknowledgement.
- **Delivery and lifetime:** an optional SMS copy, and an optional "show until" date.
- **Receipts:** recipients are recorded at send time, so read and acknowledgement receipts stay accurate, and the admin can withdraw a notice.
- **Where people see them:** urgent and unread important notices are pinned on the resident and security home screens, and the full board is behind the megaphone icon.

**Key rules, implemented as in the prototype's logic class:**
- **Routing.** A unit's visitor requests go to its owner. If the owner has diverted them to a tenant, they go to the tenant instead, and also to the owner when "Also notify me" is on.
- **Identity.** A person is identified by their mobile number. One person may hold several units, and changing their details updates every unit they hold.
- **Walk-in lifecycle.** `pending → approved/denied → inside → exited`. The visitor gets an SMS when the resident decides.
- **Passes.** A pass has a 6-digit code that is unique among live passes, and a QR code containing an HMAC-signed token. A pass works once. Extending it makes it reusable until the end of the chosen day.
- **Visitor OTP.** When the admin turns this on, security can't log a walk-in until the visitor's mobile is verified by OTP (valid for 20 minutes).
- **Audit log.** Every action is appended to `events`, which feeds the Activity screens.

## Before production

- **Secret:** set `GATEPASS_SECRET` (signs pass QR tokens), `PUBLIC_URL` (used in SMS links) and `NODE_ENV=production`.
- **SMS:** implement `SmsProvider` in `server/src/lib/sms.ts` with a DLT-registered Indian gateway such as MSG91 or Gupshup.
- **Push notifications:** live banners currently need the app to be open (SSE). Add Web Push or FCM for guards and residents whose phones are locked.
- **Database:** SQLite (WAL mode) is fine for a single society on one server. For multi-society hosting, port `schema.sql` to Postgres and add a `society_id`.
- **Photos and logos:** these are stored as small resized data URLs in the database. Move them to object storage at scale.
- **Rate limits:** OTP requests only have a 20-second resend wait per number, and there is no hourly cap by design. Add per-IP limits at the proxy to protect your SMS budget.
- **Sessions:** a sign-in lasts until the user signs out. Removing someone from the directory also removes their access.
