---
sidebar_position: 2
---

# Architecture

Two co-deployed projects:

- **Worker** at `template.<subdomain>.workers.dev` — serves the SPA via Workers
  Assets and the API via Hono. Bound to D1.
- **Pages** at `template-docs.<subdomain>.pages.dev` — this Docusaurus site.

## Request flow

1. `GET /` → Workers Assets serves the built SPA shell.
2. The SPA boots, TanStack Router renders `<Landing>`.
3. Clicking **Enter demo** → `POST /api/demo/unlock` → cookie set → navigate to `/dashboard`.
4. The `/dashboard` route loader hits `GET /api/session` and either renders or throws `redirect("/")`.
5. Clicking **Subscribe with Polar** → `POST /api/checkout` → redirect to Polar → return through `/api/checkout/success` → cookie + 302 to `/dashboard`.
6. Polar separately fires `POST /api/webhook/polar` for `subscription.*` events; the handler verifies the signature and writes to D1.
