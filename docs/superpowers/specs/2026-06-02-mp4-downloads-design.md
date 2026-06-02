# MP4 / Audio Downloads — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-02
**Repo:** `aloewright/my-cf-template` (branch: `feature/mp4-downloads`)

## Goal

Editing/management sub-project E: enable and download a ready Stream video as **MP4** (and **audio-only M4A**) from the video detail drawer, with a **Remove** action. The panel shows: Enable → "Preparing X%" (polled) → Download link.

## Mechanism (verified against Cloudflare docs)

- **Enable:** `POST /accounts/{id}/stream/{uid}/downloads` (MP4 `default`) / `POST …/stream/{uid}/downloads/audio` (M4A `audio`).
- **Status:** `GET /accounts/{id}/stream/{uid}/downloads` → `{ result: { default?: { status, url, percentComplete }, audio?: {…} } }`. `status` goes `inprogress` → `ready`. Poll until `ready`.
- **Delete:** `DELETE /accounts/{id}/stream/{uid}/downloads/{default|audio}`.
- **Download URL:** `https://customer-<streamCode>.cloudflarestream.com/<uid>/downloads/default.mp4?filename=<name>` (audio: `…/downloads/audio.m4a`). The `filename` query param makes Cloudflare serve `Content-Disposition: attachment`, so a plain `<a href>` downloads the file — no worker proxy (videos are large).
- **Signed videos** (`requireSignedURLs: true`): mint a token with `downloadable: true` (`POST /stream/{uid}/token` body `{ downloadable: true }`) and put the **token in place of the uid** in the URL: `https://customer-<code>.cloudflarestream.com/<token>/downloads/default.mp4?filename=<name>`. This reuses the token mechanism already in `signStreamItems` (which posts to `/stream/{uid}/token`), with the added `downloadable` flag.

`filename` charset (per CF): `[A-Za-z0-9-_]`; the extension is appended automatically, so the value must omit it.

## Scope

### In scope
- MP4 (`default`) and audio-only (`audio`) downloads.
- Enable, poll-to-ready with a progress indicator, download link, and **Remove** per type.
- Correct URLs for both public and signed videos.

### Out of scope (YAGNI)
- Worker-proxied downloads (CF's `filename` attachment + CDN delivery is sufficient).
- Live-recording download nuances, scheduled deletion, watermarks/captions (separate concerns).
- Bulk/library-wide download management.

## Worker API (extends `worker/src/routes/stream.ts`)

Access-gated; `409` when not connected; `400` when `:uid` is not a 32-hex Stream id (matching the clip route's guard).

- `GET /api/stream/:uid/downloads` →
  1. `GET /stream/{uid}/downloads` (CF) → `{ default?, audio? }`.
  2. `GET /stream/{uid}` (CF) for `requireSignedURLs` + `meta.name`.
  3. If the video is signed **and** any type is `ready`, mint one downloadable token (`POST /stream/{uid}/token` `{ downloadable: true }`); `ref = token ?? uid`.
  4. `code = creds.streamCode ?? parseStreamCode(video.thumbnail|playback.hls)`.
  5. Build, for each present type, `url` only when `status === "ready"`: `https://customer-${code}.cloudflarestream.com/${ref}/downloads/${default.mp4|audio.m4a}?filename=${sanitizeDownloadFilename(name)}`.
  6. Return `{ default: Info | null, audio: Info | null }`, `Info = { status: string; percentComplete: number; url: string | null }`. CF failure → `502`.
- `POST /api/stream/:uid/downloads` — body `{ type?: "default" | "audio" }` (default `"default"`) → CF `POST /stream/{uid}/downloads` or `…/downloads/audio` → `{ ok: true }`. `502` on CF failure.
- `DELETE /api/stream/:uid/downloads?type=default|audio` (default `"default"`) → CF `DELETE /stream/{uid}/downloads/{type}` → `{ ok: true }`.

Route paths `/:uid/downloads` are two-segment and don't collide with the existing `/:uid`, `/:uid/clip`, `/upload-url`, or `/`.

## Client

- **`sanitizeDownloadFilename(name: string): string`** lives in `worker/src/lib/urls.ts` (the existing URL-helpers module) since the **worker** builds the download URL. It replaces any char outside `[A-Za-z0-9-_]` with `_`, strips a trailing extension, collapses repeated `_`, and falls back to `"video"` when empty. Unit-tested in `worker/src/lib/urls.test.ts`. (No client-side `download.ts`.)
- **`src/lib/cf-api.ts`**:
  - `type DownloadInfo = { status: string; percentComplete: number; url: string | null }`.
  - `type DownloadsStatus = { default: DownloadInfo | null; audio: DownloadInfo | null }`.
  - `getDownloads(uid)` → `GET /api/stream/:uid/downloads`.
  - `enableDownload(uid, type: "default" | "audio")` → `POST …/downloads` `{ type }`.
  - `deleteDownload(uid, type: "default" | "audio")` → `DELETE …/downloads?type=…`.
- **`src/components/VideoDownloadPanel.tsx`** (new):
  - Props `{ item: MediaItem }`. Renders only when `item.kind === "video" && item.readyToStream`.
  - `useQuery({ queryKey: ["downloads", item.id], queryFn: () => getDownloads(item.id), refetchInterval: (q) => hasInProgress(q.state.data) ? 4000 : false })`.
  - For each type (MP4 `default`, Audio `audio`): if `null` → an **Enable** button (`enableDownload` mutation → invalidate `["downloads", id]`); if `inprogress` → a `Progress` bar + "Preparing N%"; if `ready` → a **Download** `<a href={url} download>` (CF forces the attachment) + a **Remove** button (`deleteDownload` mutation → invalidate).
  - Mutations: success → invalidate `["downloads", id]`; error → red notification.
- **`src/components/MediaDetailDrawer.tsx`** — render `<VideoDownloadPanel item={item} />` in `VideoDetail` (after `VideoClipPanel`).

## Data flow

Panel mounts → `getDownloads` → render per-type state. Enable → `POST` → invalidate → status `inprogress` → `refetchInterval` polls every 4 s → `ready` → Download link appears (signed token minted server-side when needed). Remove → `DELETE` → invalidate → back to Enable.

## Error handling
- Not connected → `409`; bad uid → `400`; CF failure → `502` → red notification.
- Signed-video token-mint failure → that type's `url` is `null`; the panel shows "Download URL unavailable."
- Not-ready / non-video items → panel not rendered.
- Polling stops once neither type is `inprogress`.

## Testing
- **Vitest (worker)** `worker/src/routes/stream.test.ts` additions:
  - `GET /:uid/downloads` for a **public** video maps `default`/`audio` statuses and builds the ready URL with the **uid** + `?filename=`.
  - `GET /:uid/downloads` for a **signed** video mints a downloadable token (assert `POST /stream/{uid}/token` body `{ downloadable: true }`) and the ready URL uses the **token** in place of the uid.
  - `POST /:uid/downloads` posts to `…/downloads` for `type:"default"` and `…/downloads/audio` for `type:"audio"`.
  - `DELETE /:uid/downloads?type=audio` calls CF `DELETE …/downloads/audio`.
  - `409` when not connected.
- **Vitest (worker lib)** `worker/src/lib/urls.test.ts` additions: `sanitizeDownloadFilename` (`"My Vid.mp4" → "My_Vid"`, strips extension, replaces spaces/punctuation, empty → `"video"`).
- **Client** by `npm run typecheck` + manual: open a ready video → Enable MP4 → "Preparing %" → Download saves the file → enable Audio → downloads `.m4a` → Remove returns to Enable → a signed video's link still downloads.

## Files
- Worker: `worker/src/routes/stream.ts` (+3 handlers), `worker/src/lib/urls.ts` (+`sanitizeDownloadFilename`), `worker/src/routes/stream.test.ts`, `worker/src/lib/urls.test.ts`.
- Client: `src/lib/cf-api.ts`, `src/components/VideoDownloadPanel.tsx` (new), `src/components/MediaDetailDrawer.tsx`.
- No new dependencies.
