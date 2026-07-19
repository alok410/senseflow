# Apply Gradient Wave Theme

Add the animated WebGL gradient-wave background and matching visual polish (glass cards, marquee accents) to the auth page and all three role dashboard shells. Zero backend / API / data-logic changes — pure presentation.

## Scope (visual only)

- Auth page (`/auth`)
- Landing / role picker (`/`)
- Dashboard shell used by Admin, Secretary, Consumer (`src/components/DashboardLayout.tsx`) — background + header treatment only, so all inner pages inherit it
- Do NOT touch: server functions, Supabase queries, session hook, meter API logic, tables, forms behavior

## Files to add

- `src/components/ui/gradient-wave.tsx` — WebGL animated gradient background (from snippet, TypeScript, `"use client"` removed since TanStack doesn't need it)
- `src/components/ui/marquee.tsx` — marquee helper (used for subtle branding strip on auth/landing only)
- `src/components/ui/badge.tsx` — only if not already present; skip if it exists

## Files to modify

- `src/styles.css` — add `@theme inline` marquee animation vars + `@keyframes marquee` / `marquee-vertical` (append, don't disturb existing tokens or `@import "tw-animate-css"` line)
- `src/routes/auth.tsx` — wrap page in a relative container, mount `<GradientWave />` behind content, upgrade card to translucent/backdrop-blur; keep form, OTP flow, role select untouched
- `src/routes/index.tsx` — same background treatment behind existing 3-role picker; keep `enter(role)` logic identical
- `src/components/DashboardLayout.tsx` — mount `<GradientWave />` as fixed background layer with low opacity; keep sidebar/nav/children rendering identical

## Dependencies

- `bun add @radix-ui/react-slot class-variance-authority` — only if not already installed (shadcn Button typically pulls them in already; will verify before installing)
- Skip `@aliimam/logos` — the icon marquee row from the snippet is design-portfolio-flavored and not relevant here; use lucide-react icons already in project (Droplets, Gauge, Users, etc.) if we keep any accent row
- Skip `tw-animate-css` install — already imported in `src/styles.css`

## Non-goals

- No changes to role logic, session, routing, data fetching, charts, tables, or any `*.functions.ts`
- No new metadata / SEO changes
- No color-token overhaul — gradient uses its own palette; existing shadcn tokens stay

## BUGLOG

Add `v1.0.18` entry noting the theme refresh (per project rule, treated as a change worth logging).

## Technical notes

- `GradientWave` uses `window` + `WebGL` — safe in TanStack because it only runs inside `useEffect`. No SSR guard needed beyond that.
- Mount as `<div className="fixed inset-0 -z-10 pointer-events-none">` inside layouts so it never blocks clicks and doesn't reflow content.
- Keep default color array from snippet (sky/white) but swap to a water-themed palette (`#38bdf8`, `#0ea5e9`, `#7dd3fc`, `#ffffff`) to match SensorFlow branding.
