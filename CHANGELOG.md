# Changelog

All notable changes to this template will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Re-platformed the UI to TanStack Start (SSR) on a single Cloudflare Worker.** The static React SPA (`index.html` + `main.tsx` + `assets=dist`) is replaced by TanStack Start file-based routes with edge SSR; the existing Hono API is mounted unchanged as a splat server route (`src/routes/api/$.ts` → `app.fetch(request, env)`), preserving one origin / one deploy. Bindings via `cloudflare:workers`. Toolchain swapped Biome → **oxlint + Prettier**. Added **Zustand** (UI state), **TanStack Table + Virtual** (sortable, selectable, virtualized table view), **@mantine/spotlight** (⌘K palette), **@mantine/nprogress** (route progress), **TanStack Hotkeys** (g/t/1-3/d/Esc), and installed **@mantine/dates/carousel/dropzone** (kept lazy for the editing phase). Data fetching stays client-side via TanStack Query.

### Added

- **Image variant management (editing phase, sub-project B):** a Variants section on the Settings page to manage account-level Cloudflare Images variants — list, create, edit, and delete (the `public` variant is protected). Variant changes are account-wide, so edits and deletes are gated by a confirm. New worker endpoints under `/api/images/variants` (the existing GET now returns full defs: fit, metadata, size, always-public).
- **Video captions (editing phase, sub-project C):** manage a Stream video's captions from the detail drawer — list (with an auto-generated badge + status), AI-generate captions for a chosen language (Workers AI), upload a `.vtt` file, and delete. The worker proxies Cloudflare's `/stream/:uid/captions` API; the panel polls while a generated caption is processing.
- **Video downloads (editing phase, sub-project E):** enable, poll, download (MP4 + audio-only M4A), and remove Stream video downloads from the detail drawer. The worker proxies Cloudflare's `/stream/:uid/downloads` API and builds the ready URL — using a `downloadable` signed token for private videos and `?filename=` (so Cloudflare serves it as an attachment); large files stream straight from Cloudflare's CDN, not through the worker.
- **Video clip trimming (editing phase, sub-project D):** trim a ready Stream video into a new clip from the detail drawer — a range slider over the source duration synced with start/end second inputs, a live clip-length readout, and a name field. The worker `POST /api/stream/:uid/clip` proxies Cloudflare's `/stream/clip` and returns the new video; on success the media list refreshes so the processing clip appears and becomes playable when ready.
- **Image transform builder (editing phase, sub-project A):** an in-drawer tool to transform public images on the fly via Cloudflare flexible variants — width/height/fit/gravity/dpr/trim/background, rotate/blur/sharpen/brightness/contrast/gamma, and format/quality/metadata/anim/compression — with a live debounced preview, copy-URL, and a worker-proxied download. One-click "Enable flexible variants" (`PATCH /images/v1/config`) when off; signed images show a notice (flexible variants don't apply to them). Also: the upload modal now accepts **HEIC/HEIF** images (Cloudflare ingests them and serves web formats).
- **Audio (editing phase, sub-project 3):** upload and play audio files, stored in a dedicated R2 bucket (`AUDIO_BUCKET`) with metadata in a new D1 `audio_files` table. Audio is a first-class media type with its own filter; the existing Upload modal accepts `audio/*` (browser → worker → R2), and playback streams from R2 through the Access-gated worker with HTTP range support. Grid cards show a compact `@gfazioli/mantine-audio` player; the detail drawer and cinema view show the full player with an animated `Audio.Spectrum`; audio items use a music-note placeholder thumbnail. Rename + delete supported.
- **Uploads (editing phase, sub-project 2):** drag-and-drop upload of new images and videos from the gallery. The Worker mints one-time, pre-authorized upload destinations (`POST /api/images/upload-url` → Images direct-upload; `POST /api/stream/upload-url` → Stream TUS via the `Location` header) with the stored token, and the browser uploads bytes directly to Cloudflare (images via multipart, videos resumably via `tus-js-client`). Upload modal (`@mantine/dropzone`) with a require-signed-URLs toggle and per-file progress; on completion the media list refreshes.
- **Manage & metadata (editing phase, sub-project 1):** rename, edit metadata key/values, toggle require-signed-URLs, and delete images + videos inline from the detail drawer; bulk-delete selected rows from the table (selection lifted into the Zustand store). New Worker endpoints `PATCH`/`DELETE` for `/api/images/:id` and `/api/stream/:uid`. Image "rename" sets a `meta.name` display name (the Cloudflare filename is immutable); the grid/table/drawer prefer `meta.name`. Destructive actions are gated by a confirm modal; mutations invalidate the `["media"]` query.
- **Media library views, filter & sort:** the gallery is now a single unified library (images + videos) with a Grid/Table view toggle, a Media-type filter (All / Images / Videos), and live Sort (newest, oldest, name A→Z/Z→A, type, duration). All media is loaded client-side and filtered/sorted in memory. The detail drawer lists each image variant as a clickable box labelled with its name + configured resolution (e.g. `FHD · 1920×1080`); clicking copies that variant's (signed) delivery URL. New `/api/images/variants` endpoint exposes variant dimensions, and image-detail responses now sign every variant URL (not just the thumbnail).
- **Cloudflare Media Gallery (phase 1):** an Access-gated, single-user app that connects to a Cloudflare account (scoped API token stored AES-GCM-encrypted in D1) and browses all Cloudflare Images and Stream assets in a tabbed masonry gallery with read-only detail drawers. New Worker layer: `accessGuard` middleware verifying the Cloudflare Access JWT (`jose`), an encrypted `cf_connection` credentials store, a thin `cfFetch`/`cfJson` REST proxy, and `/api/settings`, `/api/me`, `/api/images`, `/api/stream` routes. Editing, uploads, transforms, and Stream clip/thumbnail/captions are planned follow-on phases.
- README **Releases** section now embeds a table of recent releases (version, date, one-line headline) so the README itself summarizes the release history without requiring a click-through to GitHub. New entries appended on every release.

## [0.2.0] — 2026-05-28

Docs-only: canonical-template README pass.

### Changed

- **README rewritten as a canonical template README.** Title renamed to "Cloudflare SaaS Template"; lede reframed so it reads as a template (not a personal project); reference-deployment URLs explicitly labeled. Project Layout block updated — the stale Docusaurus description was replaced with the actual React + Mantine + MDX docs shape. Tech Stack picked up rows for Polar, Tabler icons, Nunito, and a CI row. Node prerequisite bumped 20 → 22 (matches Wrangler 4 + CI). `CLOUDFLARE_ACCOUNT_ID` example genericized to `wrangler whoami` rather than a literal account id. Auth section now points at the in-repo `docs/src/content/customizing.mdx` as a fallback for forks where the reference docs URL doesn't apply. `npm overrides` note expanded to cover both root and `docs/` pins.

### Added

- README **"What's inside"** feature summary above the Tech Stack table — 9 bullets for fast scanning.
- README **"Docs site"** section documenting the docs-as-a-Worker pattern and the `docs:*` scripts (`docs:dev`, `docs:build`, `docs:deploy`).
- README **"Releases"** section linking the GitHub Releases page and CHANGELOG (Keep a Changelog + SemVer attribution).
- Release + Changelog badges next to the Deploy-to-Cloudflare button.

## [0.1.0] — 2026-05-28

Initial release.

### Added — runtime

- **Single Cloudflare Worker** that serves both the React SPA (via Workers Assets) and the Hono API from one origin.
- **Hono router** in `worker/src/index.ts` mounting six route modules under `worker/src/routes/`:
  - `GET  /api/health` — service heartbeat
  - `GET  /api/session` — reads `demo_unlock` cookie, returns `{ unlocked }`
  - `POST /api/demo/unlock` — sets the cookie with no payment ("Enter demo" path)
  - `POST /api/checkout` — creates a Polar checkout, returns `{ url }`
  - `GET  /api/checkout/success` — Polar redirect target; verifies + sets cookie + 302 to `/dashboard`
  - `POST /api/webhook/polar` — HMAC-verifies and upserts a `subscriptions` row in D1
- **Polar billing** via `@polar-sh/sdk` (`worker/src/polar.ts`).
- **D1 + Drizzle** with `notes` and `subscriptions` tables; migrations under `worker/migrations/`.
- **Better Auth scaffolded** in `worker/src/auth.ts` but intentionally unwired; swap-in instructions in the docs.

### Added — frontend

- **React 19 + Vite 8 (Rolldown / Oxc)** SPA.
- **TanStack Router** with two routes: `/` (Landing) and `/dashboard` (protected via `requireUnlocked` loader).
- **TanStack Query** for client-side data fetching.
- **Mantine 9** (`core`, `hooks`, `notifications`, `modals`, `form`) layered alongside Tailwind 4.
- **Mature landing page** (`src/routes/landing.tsx`): hero with dual CTAs ("Subscribe with Polar" + "Enter demo"), three feature cards (Auth-ready / Edge-native / One-click deploy), pricing card, footer.
- **Custom logo** (`src/assets/logo.svg`, `public/logo.svg`) — indigo → violet → fuchsia gradient with a white lightning bolt.
- **Nunito** typography across both sites (300..900 variable axis from Google Fonts).
- **Refined icon system** via `@tabler/icons-react` (shield-lock, bolt, rocket, credit-card, arrow-right, check, brand-github, sun, moon).
- **Dark-mode toggle** rendered fixed top-right on the demo (visible on both landing and dashboard) and in the docs header.

### Added — docs site

- **Standalone React + Mantine + MDX SPA** in `docs/`, deployed as the `template-docs` Worker at `template-docs.lazee.workers.dev` (replaces the earlier short-lived Docusaurus + Pages setup).
- **AppShell layout**: header (logo + nav + theme toggle), sidebar (7 doc pages), content, footer.
- **Shiki** (`@shikijs/rehype`, `github-dark`) for code-block highlighting.
- **7 pages**: Introduction, Architecture, Billing (Polar), Protected routes, Database (D1 + Drizzle), Deploy, Customizing.

### Added — deploy and CI

- **One-click deploy** badge in the README pointing at `https://deploy.workers.cloudflare.com/?url=...`. `wrangler.toml` omits `database_id` so D1 is auto-provisioned on first deploy.
- **GitHub Actions** (`.github/workflows/deploy-app.yml`, `deploy-docs.yml`) auto-deploy each Worker on push to `main` with path filters. Both pin Node 22 (for Wrangler 4) and use `cloudflare/wrangler-action@v4`.
- **Dependabot** (`.github/dependabot.yml`) covers root npm, docs npm, and GitHub Actions on a weekly schedule. Minor+patch updates are grouped per ecosystem; majors land as individual PRs.

### Added — tooling

- **Biome 2.4** for lint + format (replaces ESLint + Prettier).
- **TypeScript 6** with `moduleResolution: "Bundler"`; `baseUrl` dropped (paths resolve from tsconfig location).
- **npm `overrides`** to clear two classes of upstream issues:
  - `@esbuild-kit/core-utils → esbuild ^0.25.0` (cleared GHSA-67mh-4wv8-2f99 from drizzle-kit's deprecated transitive)
  - `serialize-javascript ^7.0.5` + `uuid ^11.1.1` in `docs/` (cleared three Docusaurus-era build-only Dependabot alerts)

### Notes

- Better Auth, password reset, multi-tier billing, teams, and R2 uploads are explicitly out of scope for 0.1.0 and documented as swap-in points in the docs site.
- The webhook handler is the production source of truth for subscription state; the `demo_unlock` cookie is the UX stub for the demo only.

[Unreleased]: https://github.com/aloewright/my-cf-template/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/aloewright/my-cf-template/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aloewright/my-cf-template/releases/tag/v0.1.0
