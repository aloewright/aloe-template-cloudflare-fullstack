# SaaS Boilerplate — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-05-27
**Repo:** `aloewright/my-cf-template`

## Goal

Turn this Cloudflare full-stack template into a **learning artifact** that demonstrates the canonical shape of a SaaS on Cloudflare Workers. Reviewers should be able to read the code and immediately understand how billing, gated routes, and edge data integrate. The artifact must be cloneable in one click and explorable without paying.

## Scope

### In scope

- **Polar billing**, end-to-end:
  - Polar Checkout (hosted, redirect-based) for a single subscription tier.
  - `POST /api/checkout` creates a Polar checkout session.
  - `GET /api/checkout/success` is the Polar redirect target — it sets the stub-gate cookie and redirects to `/dashboard`.
  - `POST /api/webhook/polar` verifies the HMAC signature and upserts subscription rows in D1.
- **Stub gate** for `/dashboard`:
  - A `demo_unlock` HTTP-only cookie. `GET /api/session` returns `{ unlocked: boolean }` from the cookie.
  - The frontend `/dashboard` route loader calls `/api/session`; if `!unlocked`, throws `redirect("/")`.
  - A clearly labelled `// TODO(auth)` comment marks the line where a real Better Auth check would replace the cookie.
- **"Enter demo" path** decoupled from billing:
  - `POST /api/demo/unlock` sets the same cookie with no payment, so visitors can explore the protected route without buying.
- **Mature landing page** at `/`:
  - Hero + headline + two CTAs (Subscribe with Polar / Enter demo).
  - Three feature tiles, single pricing block, footer. Built with Mantine components and Tailwind utilities.
- **One-click deploy**:
  - "Deploy to Cloudflare" badge in the README pointing at `https://deploy.workers.cloudflare.com/?url=https://github.com/aloewright/my-cf-template`.
  - `wrangler.toml` no longer hardcodes `database_id`; the deploy flow auto-provisions D1 from `database_name`.
- **Docusaurus** documentation site:
  - Separate npm project in `docs/`. Scaffolded with `create-docusaurus` + TypeScript + Classic preset.
  - Deployed to Cloudflare Pages at `template-docs.<account>.pages.dev`.
  - Sidebar: Intro → Architecture → Billing (Polar) → Protected routes → Database (D1 + Drizzle) → Deploy → Customizing.

### Out of scope

- **Better Auth wiring.** `worker/src/auth.ts` and `/api/auth/*` stay scaffolded but never invoked. Docs explain how to drop it in.
- Password reset, transactional email, OAuth providers, magic links.
- Multiple subscription tiers, billing portal, usage metering.
- Teams / multi-tenant.
- R2 file uploads, realtime.
- Monorepo tooling. The repo stays as two top-level `package.json` files (root for the SaaS app, `docs/` for Docusaurus). No workspaces, no Turborepo.

## Architecture

```
┌─────────────────────────────────────────┐    ┌─────────────────────────────────────┐
│  Cloudflare Worker: template            │    │  Cloudflare Pages: template-docs    │
│  https://template.lazee.workers.dev     │    │  https://template-docs.<acct>.      │
│                                         │    │       pages.dev                     │
│  - React 19 SPA (Mantine + Tailwind)    │    │                                     │
│  - Hono API                             │    │  - Docusaurus 3 (classic preset)    │
│  - Polar SDK (checkout + webhook verify)│    │  - Walkthrough docs per feature     │
│  - Stub-gate cookie                     │    │                                     │
│  - env.DB ─► D1                         │    └─────────────────────────────────────┘
└─────────────────────────────────────────┘
```

### Request flow

```
GET /                       → Mantine landing (hero, features, pricing, two CTAs)

Click "Subscribe with Polar"
  → POST /api/checkout      → Worker creates Polar checkout, returns { url }
  → window.location = url   → Polar payment page
  → On success, Polar redirects to /api/checkout/success?checkout_id=…
  → Worker validates checkout, sets demo_unlock cookie, 302 to /dashboard

Click "Enter demo"
  → POST /api/demo/unlock   → Worker sets demo_unlock cookie, 200
  → SPA navigates to /dashboard

GET /dashboard              → Route loader calls /api/session
  → Worker reads demo_unlock cookie → { unlocked: boolean }
  → !unlocked → router throws redirect("/")
  → unlocked  → render protected UI

POST /api/webhook/polar     → Worker verifies HMAC, upserts subscriptions row in D1.
                              (This runs regardless of the cookie path; the webhook is the
                               production source of truth, the cookie is the demo stub.)
```

### Stub gate vs real auth

The stub gate is intentionally trivial — a cookie boolean. The point is the *pattern*: route loader → session check → redirect-or-render. The replace-with-real-auth swap is a single function in `worker/src/routes/session.ts`, marked with `// TODO(auth)`. The docs walk through the swap explicitly.

The webhook handler does *not* depend on the cookie. It does the production-correct work (verify signature, upsert subscription row). This way the boilerplate shows both the lightweight demo path and the real billing-state path side-by-side.

## File layout

```
/
├── README.md                       # Deploy button + quickstart + env vars + post-deploy steps
├── wrangler.toml                   # No hardcoded database_id; name stays as `template`
├── package.json                    # Root: SaaS app
├── package-lock.json
├── postcss.config.cjs
├── biome.json
├── vite.config.ts
├── tsconfig.json
│
├── src/                            # React SPA
│   ├── main.tsx                    # MantineProvider + Modals + Notifications + QueryClient
│   ├── router.tsx                  # TanStack Router tree
│   ├── routes/
│   │   ├── landing.tsx             # / — hero, features, pricing, two CTAs
│   │   └── dashboard.tsx           # /dashboard — protected
│   ├── lib/
│   │   ├── api.ts                  # fetchJson + checkout/demo-unlock helpers
│   │   └── session.ts              # Route loader helper that calls /api/session
│   └── styles.css
│
├── worker/                         # Cloudflare Worker (Hono)
│   ├── tsconfig.json
│   ├── migrations/                 # Drizzle-generated SQL migrations
│   │   └── 0001_subscriptions.sql
│   └── src/
│       ├── index.ts                # Hono app; mounts routes below
│       ├── auth.ts                 # Better Auth scaffold — UNCHANGED, never invoked
│       ├── polar.ts                # Polar SDK client factory
│       ├── routes/
│       │   ├── health.ts           # GET  /api/health
│       │   ├── session.ts          # GET  /api/session
│       │   ├── checkout.ts         # POST /api/checkout
│       │   ├── success.ts          # GET  /api/checkout/success
│       │   ├── demo.ts             # POST /api/demo/unlock
│       │   └── webhook.ts          # POST /api/webhook/polar
│       └── db/
│           ├── index.ts            # drizzle(env.DB) helper
│           └── schema.ts           # notes (existing) + subscriptions (new)
│
└── docs/                           # Docusaurus (separate npm project)
    ├── package.json
    ├── docusaurus.config.ts
    ├── sidebars.ts
    ├── tsconfig.json
    ├── docs/
    │   ├── intro.md
    │   ├── architecture.md
    │   ├── billing-polar.md
    │   ├── protected-routes.md
    │   ├── database-d1.md
    │   ├── deploy.md
    │   └── customizing.md
    ├── src/
    │   └── css/custom.css
    └── static/
        └── img/                    # Logo, favicon if needed
```

## API surface

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET`  | `/api/health` | Existing health endpoint | none |
| `GET`  | `/api/session` | Reads `demo_unlock` cookie, returns `{ unlocked: boolean }` | none |
| `POST` | `/api/checkout` | Creates Polar checkout session, returns `{ url }` | none |
| `GET`  | `/api/checkout/success` | Polar redirect target; sets cookie, 302 to `/dashboard` | none (validated via checkout_id) |
| `POST` | `/api/demo/unlock` | Sets `demo_unlock` cookie with no payment | none |
| `POST` | `/api/webhook/polar` | Verifies HMAC signature, upserts subscription row | HMAC signature |
| `*`    | `/api/auth/*` | Scaffolded Better Auth handler — wired but never invoked elsewhere | n/a |

### Cookie spec

- Name: `demo_unlock`
- Value: `"1"`
- `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000` (30 days)
- Set by `/api/checkout/success` and `/api/demo/unlock`.
- Read by `/api/session`. No client-side reads.

## Data model

New table in `worker/src/db/schema.ts`:

```ts
export const subscriptions = sqliteTable("subscriptions", {
  id: text("id").primaryKey(),                       // Polar subscription id
  customerId: text("customer_id").notNull(),
  customerEmail: text("customer_email").notNull(),
  productId: text("product_id").notNull(),
  priceId: text("price_id"),
  status: text("status").notNull(),                  // active | canceled | past_due | …
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
```

Drizzle Kit generates the SQL into `worker/migrations/`. The README and the `deploy.md` docs page both reference `npx wrangler d1 migrations apply <db> --remote` as the post-deploy step.

The existing `notes` table is kept unchanged so the template still demonstrates a standard Drizzle table.

## Polar integration

**SDK**: `@polar-sh/sdk` (official TypeScript SDK; works in `workerd` with `nodejs_compat`).

**Required secrets** (set via `wrangler secret put`):
- `POLAR_ACCESS_TOKEN` — server-side API token
- `POLAR_WEBHOOK_SECRET` — for `polar.webhooks.verify(body, signature, secret)`
- `POLAR_PRODUCT_ID` — the single subscription product id
- `POLAR_SERVER` (optional, `sandbox` | `production`; default `sandbox`)

**Checkout creation**:
```ts
const polar = new Polar({ accessToken: env.POLAR_ACCESS_TOKEN, server: env.POLAR_SERVER });
const checkout = await polar.checkouts.create({
  productId: env.POLAR_PRODUCT_ID,
  successUrl: `${origin}/api/checkout/success?checkout_id={CHECKOUT_ID}`,
});
return c.json({ url: checkout.url });
```

**Success handler** validates the checkout via Polar API before trusting the redirect, sets the cookie, and 302s.

**Webhook verification** uses the SDK's `validateEvent` helper. Events of interest: `subscription.created`, `subscription.updated`, `subscription.canceled`. Each upserts the `subscriptions` row keyed by Polar subscription id. The handler always returns `200` after verification — non-2xx triggers Polar retry storms.

## Landing page

Mature, single-page marketing. Mantine components, Tailwind utilities for spacing. Sections (top to bottom):

1. **Hero**: app name + one-line value prop + two CTAs side-by-side ("Subscribe with Polar" — filled Mantine Button; "Enter demo" — light variant).
2. **Features**: three Mantine `Card`s with icons (one each for Auth-ready, Edge-native, One-click deploy).
3. **Pricing**: single Mantine `Card` with the tier name, price, and a "Subscribe" CTA (same as hero).
4. **Footer**: link to docs site, GitHub repo, license.

No animations beyond Mantine's defaults. No images required for v1 (icon font / Mantine `@tabler/icons-react` is enough).

## Deploy & ops

### One-click deploy

README adds, near the top:
```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aloewright/my-cf-template)
```

`wrangler.toml` becomes:
```toml
name = "template"
main = "worker/src/index.ts"
compatibility_date = "2025-02-01"
compatibility_flags = ["nodejs_compat"]

assets = { directory = "dist" }

[[d1_databases]]
binding       = "DB"
database_name = "template"
# database_id omitted on purpose — Cloudflare Deploy auto-provisions on first deploy.
```

### Post-deploy steps (documented in README + `docs/deploy.md`)

1. Click the Deploy badge. Cloudflare provisions a Worker, a D1 database, and gives you a `*.workers.dev` URL.
2. Set Polar secrets:
   ```bash
   echo "polar_<token>"   | npx wrangler secret put POLAR_ACCESS_TOKEN
   echo "polar_webhook_…" | npx wrangler secret put POLAR_WEBHOOK_SECRET
   echo "prod_…"          | npx wrangler secret put POLAR_PRODUCT_ID
   ```
3. Apply migrations:
   ```bash
   npx wrangler d1 migrations apply template --remote
   ```
4. Point Polar's webhook URL at `https://<your-worker>.workers.dev/api/webhook/polar`.
5. Visit the deploy URL — landing page renders, "Enter demo" works without paying, "Subscribe with Polar" hits sandbox.

### Docs deploy

```bash
cd docs
npm install
npm run build
npx wrangler pages deploy build --project-name template-docs
```

Root `package.json` gets pass-through scripts:
```json
"docs:dev":    "npm --prefix docs run start",
"docs:build":  "npm --prefix docs run build",
"docs:deploy": "npm --prefix docs run build && npx wrangler pages deploy docs/build --project-name template-docs"
```

## Code style for this artifact

Because the goal is **learning**, the SaaS-specific files (auth stub, Polar handlers, webhook verifier, the route-loader gate) carry short explanatory comments — *why* and *what the production swap looks like*. Infra files (vite, wrangler, biome) stay terse. This is a deliberate departure from the project's default "no comments" rule, scoped to the new files only.

## Out-of-scope follow-ups

These are explicitly deferred to later specs:

- Wiring Better Auth (email+password, then OAuth).
- Adding password reset + transactional email (Resend or Mailchannels).
- Multiple subscription tiers + Polar Customer Portal embed.
- Teams / multi-tenant.
- R2 uploads.

## Open questions

None at design time. Re-open during implementation if any assumptions don't hold.
