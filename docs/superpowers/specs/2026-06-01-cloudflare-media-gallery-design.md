# Cloudflare Media Gallery — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template`

## Goal

A personal, single-user web app — built by extending this Cloudflare Workers template — that connects to the owner's Cloudflare account, pulls in **all Cloudflare Images** and **all Cloudflare Stream** videos, and presents them in a gallery view where each asset can be previewed and edited. The app is gated by **Cloudflare Access** (Zero Trust) and deployed to Workers.

"Authenticate with Cloudflare" means the owner provides a **scoped API token + account ID** once; Cloudflare offers no general third-party OAuth for account API access. The token is stored encrypted server-side and the Worker proxies every Cloudflare API call (the browser never holds the token, and `api.cloudflare.com` has no permissive CORS for browser calls).

## Scope

### In scope

- **Connect flow** — paste scoped API token + account ID once; validated and stored encrypted in D1. Auto-discovers the Images delivery `account_hash` and Stream `customer-<code>`.
- **App lock** — Cloudflare Access in front of the Worker hostname; the Worker verifies the `Cf-Access-Jwt-Assertion` JWT (`jose`, issuer `TEAM_DOMAIN`, audience `POLICY_AUD`). Local-dev bypass flag for `wrangler dev`.
- **Images gallery (read)** — list via `GET /images/v2` (cursor pagination), responsive masonry grid, infinite scroll, detail drawer; thumbnails served from `imagedelivery.net/<hash>/<id>/<variant>`.
- **Stream gallery (read)** — list via `GET /stream`, thumbnail grid, detail drawer with iframe player (`customer-<code>.cloudflarestream.com/<uid>/iframe`).
- **Manage & metadata** (images + videos) — rename/filename, edit metadata key/values, toggle `requireSignedURLs`, delete with confirm.
- **Image transforms** — non-destructive flexible-variant URL params (width, height, fit, rotate, quality, format, blur, sharpen, brightness, contrast) with live preview; Copy URL and Save-as-named-variant (`POST /images/v1/variants`); one-time "Enable flexible variants" action (`PATCH /images/v1/config {"flexible_variants": true}`).
- **In-browser pixel edits** — canvas editor (crop, rotate/flip, brightness/contrast/saturation, freehand + text annotation); "Save as new image" exports a blob and uploads as a new Cloudflare image.
- **Stream thumbnail / clip / captions** — set `thumbnailTimestampPct`; trim to a new video via `POST /stream/clip {clippedFromVideoUID, startTimeSeconds, endTimeSeconds}`; list/add/delete captions.
- **Uploads** — new images via `POST /images/v2/direct_upload` (browser → Cloudflare, one-time URL); new videos via `POST /stream/direct_upload` (TUS resumable). Drag-and-drop with progress.
- **Signed-asset viewing** — for private images/videos, the Worker mints signed delivery URLs / Stream playback tokens (`POST /stream/<uid>/token`).

### Out of scope (YAGNI)

- Multi-user / teams / multi-account switching.
- R2 / KV / other Cloudflare product browsing.
- AI tagging, semantic search, bulk batch-edit pipelines.
- Mirroring Cloudflare metadata into D1 (Cloudflare API stays the source of truth; client caching via TanStack Query).
- Heavy third-party image-editor libraries (the canvas editor is built in-house, lean).
- Better Auth / app-side login (Cloudflare Access handles identity).

## Architecture

```
┌──────────────────── Cloudflare Access (Zero Trust) ────────────────────┐
│  injects Cf-Access-Jwt-Assertion on every request to the Worker host    │
└───────────────────────────────┬─────────────────────────────────────────┘
                                 ▼
┌──────────────────── Single Cloudflare Worker (Hono) ───────────────────┐
│  accessGuard middleware — jose verify JWT (TEAM_DOMAIN + POLICY_AUD)     │
│                                                                          │
│  /api/health                       → JSON (unguarded)                    │
│  /api/me                           → { email } from verified JWT         │
│  /api/settings  GET / PUT          → connection status / save+encrypt    │
│  /api/settings/test  POST          → validate token, discover hash+code  │
│  /api/images  GET                  → proxy v2 list + delivery URLs       │
│  /api/images/:id  GET/PATCH/DELETE → details / metadata+signed / delete  │
│  /api/images/upload-url  POST      → one-time direct-upload URL          │
│  /api/images/variants  GET/POST    → named variants                      │
│  /api/images/flexible  POST        → enable flexible variants            │
│  /api/stream  GET                  → proxy list                          │
│  /api/stream/:uid  GET/PATCH/DELETE→ details / meta+thumbnail / delete   │
│  /api/stream/:uid/token  POST      → signed playback token               │
│  /api/stream/:uid/captions ...     → list / add / delete                 │
│  /api/stream/clip  POST            → trim → new video                    │
│  /api/stream/upload-url  POST      → direct/TUS upload URL               │
│  *                                 → Workers Assets (React SPA)          │
│                                                                          │
│  cfFetch() → api.cloudflare.com with decrypted Bearer token              │
│  env.DB (D1, encrypted creds)   env.TOKEN_ENC_KEY (AES-GCM secret)       │
└──────────────────────────────────────────────────────────────────────────┘
```

The Worker is a thin, authenticated proxy. The browser never sees the Cloudflare token; `api.cloudflare.com` is never called from the browser. Cloudflare is the source of truth — no metadata mirrored in D1.

## Data model (D1 + Drizzle)

Single-user, one row:

```
cf_connection (
  id            integer pk default 1,   -- single-row guard
  account_id    text not null,
  account_hash  text,                   -- imagedelivery.net/<hash>
  stream_code   text,                   -- customer-<code>.cloudflarestream.com
  token_cipher  text not null,          -- AES-GCM ciphertext of scoped API token
  token_iv      text not null,          -- base64 IV
  flexible_variants_enabled integer default 0,
  created_at    text,
  updated_at    text
)
```

Token encrypted at rest with AES-GCM (WebCrypto), key from `TOKEN_ENC_KEY` secret — defense-in-depth atop Access. `/api/settings/test` discovers `account_hash` (parsed from an image variant URL) and `stream_code` (parsed from a Stream playback URL) and caches them on the row.

## Cloudflare API integration

- **Images list:** `GET /accounts/{id}/images/v2?per_page=&continuation_token=` → `{id, filename, meta, requireSignedURLs, uploaded, variants[]}`. Gallery thumb = `imagedelivery.net/<hash>/<id>/w=400` (or a thumb variant).
- **Image transforms:** flexible-variant URL params, live-previewed; Copy URL / Save named variant (`POST /images/v1/variants`); enable once via `PATCH /images/v1/config`. (Flexible variants cannot serve images that require signed URLs.)
- **Image upload:** `POST /images/v2/direct_upload` → one-time URL; browser uploads directly to Cloudflare (keeps large bodies out of the Worker).
- **Stream list:** `GET /accounts/{id}/stream` → `{uid, meta.name, thumbnail, thumbnailTimestampPct, playback.hls, preview, duration, status.state, requireSignedURLs}`.
- **Stream playback:** iframe embed `customer-<code>.cloudflarestream.com/<uid>/iframe`; private videos use a token from `POST /stream/<uid>/token`.
- **Stream edits:** `PATCH /stream/<uid>` (name/meta, `thumbnailTimestampPct`, `requireSignedURLs`); captions sub-resource; `POST /stream/clip` for trim; `POST /stream/direct_upload` (TUS) for upload.

## Client UI

TanStack Router routes: `/` → **Gallery**, `/settings` → **Connect**. A setup guard redirects to `/settings` until a connection is saved. Detail + editing happen in a Mantine Drawer/Modal over the gallery (deep-link routes are later polish).

```
┌───────────────────────────────── header: logo · search · ☼ · email ─┐
│  [ Images ]  [ Stream ]                        [ ⬆ Upload ] [ ⚙ ]    │
├───────────────────────────────────────────────────────────────────────┤
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐   ← responsive masonry grid       │
│  │img │ │img │ │vid▶│ │img │ │vid▶│     hover: name, size, ⋯ menu      │
│  └────┘ └────┘ └────┘ └────┘ └────┘     infinite scroll (cursor)       │
└───────────────────────────────────────────────────────────────────────┘
   click → Drawer (image):  [ Preview ] [ Transform ] [ Pixel edit ] [ Metadata ]
   click → Drawer (video):  [ Player ] [ Thumbnail ] [ Clip ] [ Captions ] [ Metadata ]
```

## Editing capabilities (detail)

- **Image transforms tab:** sliders/inputs → live preview via flexible-variant URL; Copy URL / Save named variant.
- **Pixel-edit tab:** in-house canvas component — crop (drag), rotate/flip, brightness/contrast/saturation (canvas filters), freehand + text annotation; "Save as new image" exports a blob and uploads via direct-upload. `react-image-crop` may assist the crop interaction.
- **Metadata tab (both):** rename/filename, edit metadata, toggle require-signed-URLs, delete (confirm modal).
- **Stream:** scrub player → set `thumbnailTimestampPct`; timeline start/end → clip to new video; caption upload/list/delete.

## Security

`accessGuard` Hono middleware verifies the Access JWT on all `/api/*` except `/api/health`; 403 on missing/invalid. **Dev bypass:** when `env.DEV_BYPASS_ACCESS === "1"` (set only in local `wrangler dev`), the guard injects a fake identity so `npm run dev` works without Zero Trust. CF token AES-GCM-encrypted in D1.

New env / config:
- `vars`: `TEAM_DOMAIN` (`https://<team>.cloudflareaccess.com`), `POLICY_AUD` (Access application AUD tag).
- secrets: `TOKEN_ENC_KEY` (AES-GCM key material).
- local: `DEV_BYPASS_ACCESS=1` for dev only.
- Docs note: how to create the Access self-hosted application and get the AUD tag; how to mint the scoped API token (Images Read+Edit, Stream Read+Edit).

## Build sequence (independently shippable phases)

0. **Foundations** — `accessGuard` (jose), `cf_connection` table + AES-GCM crypto, `/api/settings` + `/test`, setup guard, env wiring, dev bypass.
1. **Images gallery (read)** — v2 cursor list, masonry grid, detail drawer.
2. **Stream gallery (read)** — list, thumbnails, iframe player.
3. **Manage & metadata** — rename/metadata/signed-URL/delete for both.
4. **Image transforms** — flexible-variant enablement + live transform editor.
5. **Uploads** — direct upload (images) + TUS (Stream) with progress.
6. **Pixel editor** — canvas edit → re-upload as new image.
7. **Stream thumbnail + clip + captions.**
8. **Polish** — empty/loading/error states, docs page, screenshots.

## Testing

- Vitest unit tests: `cfFetch`, delivery/transform URL builders, AES-GCM crypto round-trip, `accessGuard` (mocked JWKS — valid/missing/bad-audience).
- Contract tests for proxy routes against recorded Cloudflare response fixtures.
- Manual checklist per phase against a real Cloudflare account.

## New dependencies

`jose` (Access JWT verification). Optional: `react-image-crop` (crop interaction), `tus-js-client` (resumable Stream uploads). No Cloudflare SDK — direct REST keeps the Worker lean.
