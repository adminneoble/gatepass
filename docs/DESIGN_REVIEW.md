# Design review: handoff → build

> **Update (v3, lively).** v2 was calm but dull. v3 keeps its structure and adds energy:
> - **Brand gradient:** indigo→violet (`#4f46e5 → #7c3aed`) on headers, the unit switcher, primary buttons, active tabs, hero tiles, the login panel and the pass ticket.
> - **Identity accents:** each kind of thing gets its own colour, from indigo, violet, sky, amber and slate.
>   - Visitor purposes: Guest indigo, Delivery amber, Cab sky, Service violet.
>   - Gate stats, activity types and settings icons each have their own accent.
>   - Every person's avatar keeps a stable colour.
> - **Small touches:** section heads carry a brand bar with gradient counts, and the page has a soft violet glow at the top.
> - **Colour rule unchanged:** green and red are still outline and text only. The accent set deliberately has no green or red tones. The accent styles are in `web/src/styles/lively.css`.

> **Update (v2, sober UI).** The first build kept the handoff's monochrome Modernist look, and it read like a wireframe. The current system is:
> - **Surfaces:** calm cool-neutral background (`#f4f6f8`) with white cards, soft shadows and gentle radii (8–16px).
> - **Primary colour:** one muted steel-blue (`#3e5c84`), used for actions, selection, tabs and the logo tile.
> - **Type:** Inter instead of Archivo 800.
> - **Status colours:** green (success) and red (warnings, errors, emergencies) are **only outlines and text, never fills**. That covers status tags, the verify result, alert cards, the Alert/Send alert buttons, error notices and toasts. "Waiting" uses a muted amber outline.
> - **Dark theme:** follows the same rules.
>
> The tokens are in `web/src/styles/tokens.css`. The table below records the original v1 evaluation.

This review covers the high-fidelity prototype in `design_handoff_gatepass/` (Modernist system: Archivo, ink `#201e1d` on warm grey `#f3f2f2`, 0 radius, 2px rules). The product logic and copy were kept as designed. The changes below are to the visual and interaction layer.

## Kept as designed
- Archivo 400/600/800, ink-on-grey palette, square corners, 2px section rules and 1px row rules.
- Button labels are flush left. Primary is an ink fill, secondary is a divider outline, ghost is plain ink text.
- Toggle spec (46×26, 2px ink border, square knob), grayscale visitor photos, Lucide icons.
- Tag semantics: positive is solid ink, pending is an ink outline, neutral is a grey fill.
- Every screen, flow, rule and piece of copy listed in the handoff README.

## What was raw, and what changed

| Issue in the handoff | Change |
|---|---|
| Everything was inline-styled, with no reusable components | Built a token file (`web/src/styles/tokens.css`) and a component library (`web/src/ui`) |
| Cards used `surface #eae9e9`, darker than the page, so content looked sunken and flat | Added a raised "paper" layer (`#fbfafa`) with a hairline edge and a soft shadow. Inputs keep the sunken surface, so fields and cards read as different things |
| Inactive tabs and muted text at 55% ink were about 3.3:1 contrast, failing WCAG AA | Muted text now uses neutral-700 (`#605d5d`, 5.9:1). Labels are at least 11px |
| 36px controls were too small for guards in a hurry | Minimum touch target is 44px, gate actions are 52px and keypad keys are 64px |
| Hierarchy was flat (every section was a 10px label plus a rule) | Section heads carry counts, the gate gets big-numeral stats and primary/secondary action tiles, and pending visitors get an elevated card with a 72px photo |
| Resident emergencies were plain ink cards | Emergencies now use the red that the system reserves for warnings: red alert cards, a red strip on other tabs, red banners with vibration. Red still never appears decoratively |
| There was no motion | Sheets rise in, banners drop down, toasts fade, cards pop in, and pending tags pulse. All of it respects `prefers-reduced-motion` |
| There were no empty, loading or error states | Added dashed empty states with guidance, shimmer skeletons, inline error notices and a shake on a wrong code |
| Admin was squeezed into a 375px phone frame | On desktop, admin has a sidebar and a directory table. On phones it keeps the bottom tabs and cards |
| Night-shift gate use had no dark mode | Full dark theme via tokens. It follows the system setting, with a manual override in the account sheet |
| The visitor pass was a plain card | It's now designed as a ticket: an ink band with the society name, a 240px QR, a large code, a perforation and a fact row. Used and expired passes are dimmed |
| The QR was a placeholder pattern | Real, scannable QR codes encode a signed token. The scanner accepts the camera, USB/Bluetooth readers (keyboard wedge) or the keypad |
| There was no sign-in | Added a mobile OTP login in the same visual language, with a split hero layout on desktop |

## Platform notes
- One responsive web app serves all roles. It runs in a phone browser or as a home-screen web app, which covers the "Member + Security apps" without app-store work. Native shells (Capacitor or React Native) can wrap it later.
- The handoff's `tel:` links, camera capture (`capture="user"`), safe-area insets and native date pickers are all used.
