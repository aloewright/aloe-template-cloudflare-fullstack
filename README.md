# Cloudflare Full-Stack Template

A single-origin, edge-deployed full-stack starter: React SPA + Hono API + D1 database, all bundled into one Cloudflare Worker. Built for fast cold starts, zero-server ops, and a clean TypeScript-everywhere developer experience.

**Live demo:** https://template.lazee.workers.dev

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aloewright/my-cf-template)

---

## Tech Stack

| Layer | Choice | Why |
| --- | --- | --- |
| **Runtime** | Cloudflare Workers (`workerd`) | One process serves both the SPA and the API from edge POPs |
| **Frontend** | React 19 + Vite 8 (Rolldown / Oxc) | Modern React, instant HMR, ~100 ms production builds |
| **Routing** | TanStack Router | File-less, type-safe routes with full inference |
| **Data fetching** | TanStack Query | Cache + revalidation primitives for client state |
| **UI components** | Mantine 9 (core, hooks, notifications, modals, form) | Full component library with hooks, toast, dialog manager, and form state |
| **Styling** | Tailwind CSS 4 | Utility-first CSS via the new Vite plugin; layered alongside Mantine components |
| **API** | Hono | Tiny, fast router that matches the Workers fetch handler |
| **Database** | Cloudflare D1 (SQLite at the edge) | Pay-per-row, zero-config, replicated |
| **ORM** | Drizzle | Schema-first, generates SQL migrations, runs in `workerd` |
| **Auth (scaffolded)** | Better Auth | D1-backed sessions, email+password ready — not yet wired up in the demo |
| **Lint / Format** | Biome 2.4 | One tool, Rust-fast, replaces ESLint + Prettier |
| **Build** | Vite 8 + `tsc --noEmit` | Type-check both client and worker tsconfigs |
| **Deploy** | Wrangler 4 | Worker + assets in a single deploy |

---

## Architecture

```
        ┌──────────────────────────────────────────────────────┐
        │              Single Cloudflare Worker                │
        │  https://<worker>.<account>.workers.dev              │
        │                                                      │
        │  fetch handler (Hono)                                │
        │  ├─ /api/health        → JSON                        │
        │  ├─ /api/me            → Better Auth session         │
        │  ├─ /api/auth/*        → Better Auth handler         │
        │  └─ *                  → Workers Assets (dist/)      │
        │                                                      │
        │  env.DB ───────────► Cloudflare D1 (SQLite)          │
        └──────────────────────────────────────────────────────┘
```

**Single-origin model.** The Worker is bound to a built `dist/` directory via `assets = { directory = "dist" }` in `wrangler.toml`. Any path the API doesn't match falls through to Workers Assets, which serves the SPA shell. This means:

- No CORS — the API and the UI share an origin.
- No second project — one `wrangler deploy` ships the whole app.
- The Vite dev server still runs separately on `:5173`, proxying `/api/*` to `wrangler dev` on `:8787` for fast HMR (see `vite.config.ts`).

**Data flow.** The browser calls `fetch("/api/...")`. In dev, Vite proxies to the Worker. In prod, the Worker handles it directly. Inside the Worker, Hono dispatches to handlers that build a Drizzle client over `env.DB` (D1).

---

## Project Layout

```
.
├── src/                       # React SPA (client-only)
│   ├── App.tsx                # Demo page: queries /api/health + /api/me
│   ├── main.tsx               # ReactDOM root + QueryClient + RouterProvider
│   ├── router.tsx             # TanStack Router tree
│   ├── styles.css             # Tailwind entry
│   └── lib/                   # fetchJson, client utilities
│
├── worker/                    # Cloudflare Worker (server)
│   ├── src/
│   │   ├── index.ts           # Hono app, route registration
│   │   ├── auth.ts            # Better Auth factory (scaffolded)
│   │   └── db/
│   │       ├── index.ts       # drizzle(env.DB) helper
│   │       └── schema.ts      # Drizzle table definitions
│   └── tsconfig.json          # Worker-only TS config (workerd types)
│
├── dist/                      # Built SPA (created by `npm run build`)
├── biome.json                 # Linter + formatter config
├── vite.config.ts             # Vite + plugin-react + Tailwind + /api proxy
├── wrangler.toml              # Worker name, D1 binding, assets dir
├── tsconfig.json              # Client TS config
└── package.json
```

---

## Setup

### Prerequisites

- Node 20+ (or Bun — see [Bun note](#bun-instead-of-node) below)
- A Cloudflare account with Workers + D1 access (`wrangler login` if not already authenticated)

### Install

```bash
npm install
```

### Create your D1 database

The committed `wrangler.toml` points at the demo's D1 — replace it with your own:

```bash
npx wrangler d1 create <your-database-name>
```

Wrangler prints a binding snippet. Copy the `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "<your-database-name>"
database_id   = "<id-from-wrangler>"
```

---

## Post-deploy setup (one-click deploy users)

The Deploy badge above provisions a Worker and a D1 database in your account, but
the SaaS bits need three secrets and one migration before billing works.

```bash
# 1. Set Polar secrets (use sandbox tokens while you're testing)
echo "polar_oat_…"       | npx wrangler secret put POLAR_ACCESS_TOKEN
echo "polar_whsec_…"     | npx wrangler secret put POLAR_WEBHOOK_SECRET
echo "prod_…"            | npx wrangler secret put POLAR_PRODUCT_ID
# Optional: flip to production once you're live
echo "production"        | npx wrangler secret put POLAR_SERVER

# 2. Apply migrations to the freshly-provisioned D1
npx wrangler d1 migrations apply template --remote

# 3. Point Polar's webhook URL at:
#    https://<your-worker>.<your-subdomain>.workers.dev/api/webhook/polar
```

Visit your deploy URL — the landing page should render. "Enter demo" works
without any of the above (it just sets the cookie). "Subscribe with Polar"
needs the secrets to hit the API.

---

## Local Development

```bash
npm run dev
```

Runs two processes in parallel via `concurrently`:

| Process | Port | What it does |
| --- | --- | --- |
| `vite` | `127.0.0.1:5173` | Serves the SPA with HMR; proxies `/api/*` to the Worker |
| `wrangler dev` | `127.0.0.1:8787` | Runs the Worker against a local D1 simulation |

Visit **http://127.0.0.1:5173** — that's the UI. The Worker is also addressable directly at `http://127.0.0.1:8787` if you want to hit the API without the proxy.

D1 in local dev uses a SQLite file under `.wrangler/state/` — it's gitignored, persists between runs, and is wiped if you delete the directory.

### Useful scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start Vite + Wrangler in parallel |
| `npm run build` | Build the SPA to `dist/` and typecheck the Worker |
| `npm run preview` | Preview the built SPA (no Worker) |
| `npm run typecheck` | `tsc --noEmit` on both client and worker configs |
| `npm run lint` | Biome lint (no writes) |
| `npm run format` | Biome format (writes) |
| `npm run check` | Biome lint + format + organize imports (writes) |

---

## Database & Migrations

The schema lives in `worker/src/db/schema.ts`. Drizzle Kit reads it and emits SQL.

```bash
# Generate a migration from schema changes
npx drizzle-kit generate

# Apply locally
npx wrangler d1 migrations apply <your-database-name> --local

# Apply to production
npx wrangler d1 migrations apply <your-database-name> --remote
```

You can also run ad-hoc SQL:

```bash
npx wrangler d1 execute <your-database-name> --remote --command "SELECT * FROM notes"
```

---

## API Routes

Defined in `worker/src/index.ts`:

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/api/health` | Returns `{ ok, service, timestamp }`. Always public. |
| `GET` | `/api/me` | Returns the Better Auth session user, or `null` if signed out. |
| `*` | `/api/auth/*` | Delegated to Better Auth's handler (sign-up, sign-in, etc.). |

Anything not matching `/api/*` falls through to Workers Assets, which serves `dist/index.html` (the SPA).

---

## Auth (scaffolded, not wired)

`worker/src/auth.ts` defines a `createAuth(env)` factory using Better Auth with the D1 adapter and email+password enabled. The handler is mounted at `/api/auth/*` and `/api/me`.

The demo deploy intentionally **does not** complete the auth setup. To enable it later:

1. **Set a secret.** Better Auth requires `BETTER_AUTH_SECRET` (32+ random bytes, base64) in production:
   ```bash
   openssl rand -base64 32 | npx wrangler secret put BETTER_AUTH_SECRET
   ```

2. **Provision the auth tables.** Better Auth needs four tables (`user`, `session`, `account`, `verification`). Generate the SQL from the Better Auth CLI or hand-author a migration, then apply it:
   ```bash
   npx wrangler d1 migrations apply <your-database-name> --remote
   ```

3. **Read the env in `auth.ts`.** Pass `secret: env.BETTER_AUTH_SECRET` (and a `baseURL`) into `betterAuth({...})` so the production deploy stops using dev defaults.

Until those steps land, `/api/auth/*` and `/api/me` will respond but sign-up will fail because the tables don't exist.

---

## Deployment

```bash
npm run build          # produces dist/
npx wrangler deploy    # uploads Worker + assets
```

Wrangler prints the live URL (e.g., `https://<name>.<subdomain>.workers.dev`). The same command redeploys — Workers does zero-downtime version swaps.

### Versions & rollback

```bash
npx wrangler versions list
npx wrangler rollback           # rolls back to the previous version
```

### Logs

```bash
npx wrangler tail               # stream live logs
npx wrangler tail --status error
```

---

## Tooling Notes

### Vite 8 + Rolldown + Oxc

Vite 8 replaces Rollup with [Rolldown](https://rolldown.rs/) and esbuild with [Oxc](https://oxc.rs/) — both Rust toolchains. You'll see production builds finish in ~100 ms.

### Mantine + Tailwind

The app is wrapped in `<MantineProvider>` → `<ModalsProvider>` → app → `<Notifications />` (see `src/main.tsx`). Mantine's core/notifications CSS is imported before `styles.css` so Tailwind utilities can override Mantine when needed. Use Mantine for components (buttons, inputs, modals, toast, form state) and Tailwind for layout and one-off styling.

Mantine requires PostCSS for breakpoint variables and the `rem()`/`em()` functions — see `postcss.config.cjs`. Tailwind 4 runs through `@tailwindcss/vite`, separate from the PostCSS pipeline, so they don't conflict.

### Biome

`biome.json` is configured for 2-space indent, double quotes, 100-column lines. The ECC tooling directories (`.claude/`, `.codex/`, `.agents/`) are excluded from formatting. Run `npm run check` before committing.

### esbuild override

`package.json` includes:

```json
"overrides": {
  "@esbuild-kit/core-utils": { "esbuild": "^0.25.0" }
}
```

This clears [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) from a deprecated transitive in `drizzle-kit`. The `@esbuild-kit/*` packages have been merged into `tsx` upstream, so this should become unnecessary in a future `drizzle-kit` release.

### Bun instead of Node

The entire dev/build pipeline runs unchanged under Bun: replace `npm install` with `bun install` and `npm run X` with `bun run X`. The Worker itself runs in `workerd`, not Node, so Bun only affects local tooling speed.

---

## Compatibility

- `compatibility_date = "2025-02-01"`
- `compatibility_flags = ["nodejs_compat"]` — required by Better Auth and several Hono middlewares

Bump the compatibility date quarterly to pick up new `workerd` features.

---

## License

AGPL-3.0-or-later. See [`LICENSE`](./LICENSE).
