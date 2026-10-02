# Handoff: Gatepass — Society Visitor Management

## Overview
Gatepass manages visitors for a residential/commercial society (India context: flats, offices, +91 mobiles). Four roles:

- **Visitor** — no app. Receives SMS; a link opens a mobile web pass page (QR + 6-digit code).
- **Security** — gate app: log walk-ins, verify codes/QR (RFID reader), allow entry/exit, handle resident alerts.
- **Member** — one app for **owners and tenants**: approve/deny walk-ins, pre-approve guests (code + QR), extend approvals, activity history, manage units/tenant routing, profile, contact/alert security.
- **Admin** — society settings (name, logo, OTP rule, SMS sharing, pass validity, security contacts), unit directory (add/edit members, approve tenant requests), all activity with date ranges.

## About the Design Files
`Gatepass.dc.html` is a **design reference built in HTML** — an interactive prototype showing intended look and behaviour, not production code. All four phones share one in-memory state so cross-role flows can be demoed. Recreate it in your target stack (e.g. React Native / Flutter for the Member + Security apps, a web app for Admin and the visitor pass page, plus a backend with SMS/OTP provider). Open the HTML file in a browser (keep `support.js` and `_ds/` beside it) to click through. The logic class at the bottom of the file (`class Component`) documents every state transition and is the best behavioural spec.

## Fidelity
**High-fidelity.** Final colours, type, spacing and copy. Recreate pixel-accurately, adapting to platform conventions (safe areas, native date pickers, tel: links).

## Design Tokens (Modernist system — `_ds/.../styles.css`)
- Font: **Archivo** 400/600/800 (Google Fonts). Headings 800, letter-spacing -0.015em.
- Type sizes used: 10–11px uppercase labels (letter-spacing 0.08–0.1em, 600); 12–13px meta; 14–15px body; 16–19px card titles (800); 18px app header title (800); 24–40px codes/keypad.
- Colours:
  - Background `#f3f2f2`, surface `#eae9e9`, ink/text `#201e1d`
  - Divider `color-mix(#201e1d 40%, transparent)`; muted text = ink at 55–70%
  - Neutral ramp: 100 `#f8f4f4`, 300 `#d7d3d3`, 700 `#605d5d`, 800 `#444141`, 900 `#2d2b2b`
  - **Red is reserved for errors/warnings only**: text `#ae1800` (accent-700); error box bg `#fff2ef` + text `#7c1405`
- Radius: **0 everywhere**. Rules: 2px dividers between sections, 1px between rows.
- Spacing: 4 / 8 / 12 / 16 / 24 / 32px.
- Shadows: sm `0 1px 2px rgba(45,43,43,.14)`, md `0 3px 10px rgba(45,43,43,.16)`, lg `0 12px 32px rgba(45,43,43,.22)` (phone frame, sheets, toasts).
- Buttons: labels **flush left**. Primary = ink fill / light text (hover neutral-800, active neutral-900). Secondary = 1px divider border, hover ink 7%. Ghost = ink text, hover ink 8%. Disabled 45% opacity. Focus ring 2px ink, offset 2px.
- Tags: positive (Approved/Inside/Valid/Active) = solid ink; pending = 1px ink outline; neutral (Denied/Exited/Used) = neutral-100 bg + neutral-800 text.
- Toggles: 46×26 square, 2px ink border; on = ink track + light 16px square knob at 24px; off = transparent + ink knob at 3px.
- Icons: Lucide, 2px stroke, square caps, 12–24px.
- Photos: grayscale filter (`grayscale(1) contrast(1.08)`).

## Common Phone Layout (375×780)
Status bar 34px → app header (40px logo tile [society logo or 2-letter initials on ink], uppercase kicker 10px + 18px title, optional icon buttons) with 2px bottom rule → scrollable content (16px padding, 14px gaps) → bottom tab bar (2px top rule, equal columns, 20px icon above 12–13px label; active tab has a 3px ink top bar and ink text, inactive 55% ink). Overlays: toast (ink, bottom 70px), notification banner (ink, top 40px, auto-hide 5s), bottom sheets (`.dialog` on 50% neutral-900 backdrop).

## Screens

### Visitor (SMS + web pass, no app)
1. **Messages** — SMS thread from sender `PG-GATE`: invites, approval results, OTPs. Pass SMS contains a link `gatepass.in/p/<code>`.
2. **Pass page** (browser) — back + address bar with lock; society name; "Entry pass for {name}"; status tag Valid/Used; 240px QR; code 40px/800 tracking 0.1em; grid: Visiting / Purpose / Validity; helper copy "Show the QR at the gate reader or tell security the code."

### Security (tabs: Home · New entry · Verify · Log)
- **Home**: open resident alerts (ink cards: type, unit · name · phone, note, Call / Acknowledge → Mark resolved); two 120px action tiles (New visitor [primary], Verify code or QR); 3-cell stat row (Inside now / At the gate / Today); "At the gate" list (Allow in when approved, Awaiting tag); "Inside now" list (Mark exit).
- **New entry**: 96px photo capture (camera input), name, flat/office **directory search** (unit, owner or tenant name; dropdown shows "Notifies X (Role)"), "Request goes to" box listing recipients with role and phone, mobile (+ Send OTP / OTP field / Verified tag when Admin OTP rule on), purpose chips (Guest, Delivery, Cab, Service, Other), primary "Notify resident for approval". Disabled until name, 10-digit mobile, valid unit, purpose (and OTP verified if required). Error: "Not in the directory…".
- **Verify**: "Scan QR / RFID pass" button, 6 code boxes, 3×4 keypad (Clear, 0, backspace). Auto-verify at 6 digits. Valid → card with "Pre-approved by {unit}", details, "Allow entry". Invalid/used → red error box.
- **Log**: today's visitors with photo/initials, status tag, actions.
- Persistent strip on non-Home tabs when alerts are open; top banner on new alert.

### Member (tabs: Requests · Invite · Activity · Units)
- Header: logo tile, "{name} · {unit}", title, Security (shield) + Notifications (bell) icon buttons. Below: unit switcher strip (unit id + "Home" / "Rented · {tenant}" / "Tenant").
- **Requests**: own open alerts (ink strip with status); Security contact card (gate phone · 24×7, Call icon button, primary "Alert"); pending visitors across all units that route to this person (photo, name, purpose, phone, Approve / Deny); "Today at {unit}" history with Extend.
- **Invite**: name, mobile, purpose chips, date (Today/Tomorrow) → "Generate code and QR" → pass card (QR 128px, code, validity, "Sent by SMS" or "Share code and QR"); "Passes issued" list with Extend.
- **Extend approval sheet**: 1 day / 3 days / 1 week / Custom date → "Valid until {date}"; same code becomes reusable; SMS if sharing on.
- **Activity**: range segmented control Today / 7 days / 30 days / Custom (From/To date inputs); summary "N activities · range"; grouped by day; row = icon tile, name, "label · detail", time.
- **Units**: My profile (view / edit name + mobile; mobile change requires OTP to new number; duplicate number error); per-unit card: owner, tenant, "Request removal", owner-only toggles "Send visitor requests to tenant" and "Also notify me", "Request admin to add tenant" form (pending state with Cancel), footer "Requests go to …". Tenant view shows explanatory note instead of controls.
- **Contact security sheet**: gate + supervisor rows with Call; alert type grid (Medical emergency, Suspicious person, Need help at home, Fire or smoke, Lift stuck, Other); optional note; "Send alert".

### Admin (tabs: Settings · Directory · Activity)
- **Settings**: Society profile (72px logo upload, name — used in all apps, pass page, SMS); Security contacts (gate phone, supervisor name + phone); OTP verification toggle; Send pass to visitor's mobile toggle; Pass validity 4 hours / 24 hours / 3 days.
- **Directory**: pending tenant requests (Approve / Reject); primary "Add member"; search; unit rows (id, type tag, Edit; Owner / Tenant / Notifies grid).
- **Add member sheet**: unit number (new → Type Flat/Office; existing → Role Owner/Tenant + replace warning), name, mobile.
- **Edit sheet**: owner name/mobile, tenant name/mobile (clear both to remove). Person changes propagate to every unit they hold.
- **Activity**: same component as Member, all units, flat shown in each row.

## Interactions & Business Rules
- **Routing**: recipients(unit) = tenant (+ owner if "Also notify me") when tenant exists and owner diverted; otherwise owner. Identity = mobile number; one person may hold many units.
- **Walk-in**: Security submit → visit `pending` → recipients notified → Approve/Deny → visitor SMS → Security "Allow in" → `inside` → "Mark exit" → `exited`.
- **Pre-approval**: Member generates 6-digit code + QR; auto-SMS if Admin sharing on, else manual Share. Security verifies by code or scan → Allow entry → pass `used` (unless extended).
- **OTP** (Admin toggle): 4-digit code by SMS to visitor; required before logging a walk-in.
- **Tenant changes**: owner requests → Admin approves/rejects → owner notified; tenants sign in with registered number.
- **Alerts**: member → `new` → security Acknowledge → `ack` → Mark resolved → `resolved`; member notified at each step.
- Every action appends to an activity log `{date, time, unit, name, kind, detail}`; kinds: request, approved, denied, entry, exit, pass, extend, tenant, profile, alert.
- Mobile inputs accept digits only, max 10; display as `+91 98200 11223`.

## State / Data Model (suggested backend entities)
`Society {name, logo, gatePhone, supervisorName, supervisorPhone, otpRequired, autoSharePass, passValidity}` ·
`Unit {id, type, owner:Person, tenant?:Person, divertToTenant, ccOwner}` ·
`Person {name, mobile}` ·
`Visit {id, name, mobile, unitId, purpose, photo, status, time, via: Walk-in|Pass}` ·
`Pass {code, name, mobile, unitId, purpose, date, validUntil, sent, used}` ·
`TenantRequest {id, unitId, kind: add|remove, name, mobile, requestedBy, status}` ·
`Alert {id, type, note, unitId, name, mobile, time, status}` ·
`Event {id, date, time, unitId, name, kind, detail}`.
Real implementation needs: auth by mobile OTP, push notifications (member + security), SMS gateway, QR encoding of a signed pass token (the prototype's QR is a placeholder pattern), RFID/QR reader integration at the gate, role-based access.

## Assets
- No raster assets. Icons are Lucide (inline SVG paths in the file). Society logo is user-uploaded. Visitor photo is captured on device.

## Files
- `Gatepass.dc.html` — the full interactive prototype (template + logic class).
- `support.js` — runtime needed to open the prototype in a browser.
- `_ds/.../styles.css` — Modernist design tokens and component classes (`.btn`, `.input`, `.seg`, `.tag`, `.card`, `.dialog`, `.table`). The prototype overrides the accent to ink (see `<style>` in the file's helmet) so red is used only for errors.
