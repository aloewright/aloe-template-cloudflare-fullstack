# TanStack Start Re-platform — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template` (branch: new `feature/tanstack-start` off the media-gallery work)

## Goal

Re-platform the Cloudflare Media Gallery UI onto the TanStack ecosystem and modernize the toolchain, **before** building the editing phase. Keep Hono as the API/edge layer; use TanStack Start (SSR) for the UI, on a single Cloudflare Worker. Add TanStack Table + Virtual for data-dense views, Zustand for UI state, a command palette, hotkeys, route progress, and the Mantine packages the editing phase will need. Swap Biome for oxlint + Prettier.

This is a foundational migration with no user-facing feature changes — the gallery, filters, sort, detail drawer, and signed-URL behavior must work identically afterward.

## Scope

### In scope
- **TanStack Start (SSR)** as the UI framework on a single Cloudflare Worker, replacing the static-SPA (`index.html` + `main.tsx` + `assets=dist`) model.
- **Hono unchanged**, mounted under Start as a splat server route (`/api/*` → `honoApp.fetch`). All worker routes/services/lib keep working as-is.
- **TanStack Router** (via Start) — file-based routes: `__root`, `index` (gallery), `settings`, `api/$` (Hono).
- **TanStack Query v5** (already present) for server state — behavior unchanged (client-side load-all + signed URLs).
- **Zustand** for UI state (view, media-type filter, sort, selected item) — extracted from `gallery.tsx` local state so the palette and hotkeys can drive it.
- **TanStack Table** (headless) + **TanStack Virtual** — rebuild the table view: column defs, header-click sort, column sizing, row selection (for future bulk ops), virtualized rows.
- **TanStack Hotkeys** (alpha, `@tanstack/react-hotkeys`) behind a `lib/hotkeys.ts` wrapper. Initial map: `g`/`t` grid/table; `1/2/3` filter all/images/videos; `⌘K` spotlight; `j/k`+`Enter` navigate/open (table); `Esc` close drawer; `?` cheatsheet.
- **Mantine additions:** `@mantine/spotlight` (⌘K palette), `@mantine/nprogress` (route progress), `@mantine/dropzone`, `@mantine/dates` (+dayjs), `@mantine/carousel` (+embla-carousel-react). (`core`, `hooks`, `form`, `notifications`, `modals` already present.) Each gets its `styles.css` import + provider wiring in `__root`.
- **Toolchain:** remove `@biomejs/biome` + `biome.json`; add **oxlint** (`.oxlintrc.json`) and **Prettier** (`.prettierrc` + `.prettierignore`). Scripts: `lint`→`oxlint`, `format`→`prettier --write .`, `check`→both. Re-format the repo once. Vitest stays.
- **Deploy:** same Worker name (`media-gallery`), D1, Access vars, and `media.aloewright.me` route. Worker entry becomes Start's generated server.

### Out of scope
- Editing features (transforms, pixel editor, metadata/rename/delete, uploads, Stream clip/thumbnail) — next phase, on top of this.
- Moving data fetching into SSR loaders/server functions (explicitly avoided — see Performance).
- Changing Access, D1 schema, signing, or the CF API integration.

## Architecture

```
Cloudflare Access (gates media.aloewright.me — unchanged)
        │
        ▼
Single Cloudflare Worker  ──  TanStack Start server entry (SSR)
  ├─ SSR routes (/, /settings)   → render shell + run light loaders at the edge
  └─ server route /api/$         → honoApp.fetch(request, env)   (Hono unchanged)
        env (DB, TEAM_DOMAIN, POLICY_AUD, TOKEN_ENC_KEY) via cloudflare:workers
```

- Build: **Vite + `@tanstack/react-start` plugin + `@cloudflare/vite-plugin`** → one Worker. Start owns the fetch handler; the splat server route delegates `/api/*` to the existing Hono app. The exact Start↔Cloudflare↔Hono wiring (server-route signature, bindings access, asset handling) is the highest-uncertainty area and will be confirmed against current TanStack Start + Cloudflare Vite docs during planning. The current branch remains deployable as a rollback.
- Cloudflare bindings are read via `cloudflare:workers` `env` (D1, vars, secret). Access guard, Drizzle, AES-GCM + HMAC signing, Stream token minting — all unchanged.

## Routing & data flow
- File-based routes under `src/routes/`. `__root.tsx` hosts providers (Mantine + all package providers, QueryClient, Spotlight, NavigationProgress, Notifications, Modals, Hotkeys) and the app shell.
- **SSR renders the shell only.** Media list, image detail, image variants, and settings status are fetched **client-side via TanStack Query** exactly as today (preserves load-all + signed-URL + per-video token behavior). `ensureConnected` becomes a route loader that checks `/api/settings` and redirects to `/settings` if unconnected.

## State management
- **TanStack Query** = server state (media, detail, variants, settings). Query keys unchanged.
- **Zustand** store (`lib/store.ts`) = UI state: `view: "grid"|"table"`, `mediaType: "all"|"image"|"video"`, `sort: SortKey`, `selectedId: string|null`. `gallery.tsx` reads/writes the store; palette + hotkeys dispatch to it.

## Table view (TanStack Table + Virtual)
- `MediaTable` rebuilt with `@tanstack/react-table` headless model: column defs (thumbnail, name, type, date, duration, access), `getSortedRowModel` (header-click sort), column sizing, `enableRowSelection` (checkbox column, for future bulk edit/delete). Rows rendered with Mantine `Table` primitives.
- `@tanstack/react-virtual` virtualizes rows (render only visible). Grid virtualization is a later optional enhancement.

## Performance / latency (hard requirements)
Driven by the latency review:
1. **Code-split the new UI libraries.** Lazy-load `@mantine/carousel`, `@mantine/dropzone`, `@mantine/dates`, and `@mantine/spotlight` via dynamic `import()` (and Start route-level splitting) so they don't bloat the initial chunk. Keep dayjs imports narrow. Target: initial JS gzip stays within ~10–15% of today's ~155 KB.
2. **Keep data fetching client-side.** SSR renders the shell only; do **not** put the media list / per-video token minting into blocking SSR loaders (would spike TTFB). Loaders may do at most one cheap check (connection status).
3. **Accept** a small TTFB/cold-start increase from SSR + a larger Worker bundle (tens of ms). Acceptable for an Access-gated tool.
4. **Win:** TanStack Virtual reduces table render cost at scale.

## Toolchain swap
- Remove `@biomejs/biome`, `biome.json`. Add `oxlint` (+ `.oxlintrc.json`) and `prettier` (+ `.prettierrc`, `.prettierignore`). Update `package.json` scripts and any hooks/CI that call biome. One-time repo reformat with Prettier.

## Testing
- Vitest worker tests (crypto, urls, cf, connection store/service, access guard, route contracts, sign, variants) must keep passing unchanged.
- Add a smoke test for the Hono-mounted server route (request `/api/health` through the Start server route resolves to Hono) if feasible in the test harness.
- Manual parity check after migration: connect flow, gallery grid/table, filter/sort, image variant copy boxes, video links + resolution, dark/light, spotlight, hotkeys — all behave as before, live on `media.aloewright.me`.

## New dependencies
`@tanstack/react-start`, `@tanstack/react-router` (via Start), `@tanstack/react-table`, `@tanstack/react-virtual`, `@tanstack/react-hotkeys` (alpha), `zustand`, `@cloudflare/vite-plugin`, `@mantine/spotlight`, `@mantine/nprogress`, `@mantine/dropzone`, `@mantine/dates`, `dayjs`, `@mantine/carousel`, `embla-carousel-react`, `oxlint`, `prettier`. Remove `@biomejs/biome`.

## Staged sequencing (each stage verified before the next)
1. **Toolchain** — Biome → oxlint + Prettier; reformat; tests green.
2. **Scaffold Start** — Vite + Start + Cloudflare plugin; `__root` + move `/` and `/settings` to file routes; SSR shell renders; providers wired.
3. **Mount Hono** — `api/$` server route → Hono; verify API parity (health, settings, images, stream, variants) live.
4. **State + chrome** — Zustand store; Spotlight palette; nprogress; TanStack Hotkeys wrapper + initial map.
5. **Table** — TanStack Table + Virtual rebuild of the table view (sort, sizing, selection, virtualization).
6. **Remaining Mantine pkgs** — dates/carousel/dropzone added + lazy-loaded; CSS wired.
7. **Deploy** — to `media-gallery` / `media.aloewright.me`; full manual parity + latency sanity check.

## Risks
- TanStack Start's Cloudflare integration and TanStack Hotkeys (alpha) are evolving — pin versions, isolate behind wrappers, verify against current docs in the plan, keep the current branch as rollback.
- Bundle bloat (mitigated by code-splitting requirement above).
