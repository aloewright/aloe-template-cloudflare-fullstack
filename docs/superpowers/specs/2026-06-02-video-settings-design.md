# Thumbnail & Playback Settings — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-02
**Repo:** `aloewright/my-cf-template` (branch: `feature/video-settings`)

## Goal

Editing/management sub-project F (final of the set): a **Settings** panel in the video detail drawer to set a Stream video's poster-thumbnail timestamp (with a live-preview slider) and its allowed embedding origins.

## Mechanism (verified against Cloudflare docs)

- Both settings are edits via `POST /accounts/{id}/stream/{uid}` (the same endpoint the existing edit handler uses): `{ thumbnailTimestampPct: 0.0–1.0, allowedOrigins: string[] }`.
  - `thumbnailTimestampPct` (0.0 = first frame, 1.0 = last) — already on `StreamItem`. Docs: `POST /stream/{uid}` `{"thumbnailTimestampPct": 0.5}`.
  - `allowedOrigins` — domains the player/video may be embedded on (empty = allow all). **The plan verifies the exact field name/shape** on the Stream edit endpoint.
- **Live thumbnail preview:** Cloudflare's on-the-fly thumbnail endpoint `https://customer-<code>.cloudflarestream.com/<uid>/thumbnails/thumbnail.jpg?time=<sec>s&height=240`, where `sec = round(pct × duration)`. Works for **public** videos (the item's `thumbnail` is the unsigned base URL); **signed** videos can't be re-timed without a token, so they show the current saved thumbnail and refresh after save.

## Scope

### In scope
- Thumbnail timestamp slider (0–100%) with a live preview for public, ready videos.
- Allowed-origins editor (list of domains; empty = allow all).
- Save both via one `updateStream` call; refresh the gallery so the new thumbnail shows.

### Out of scope (YAGNI)
- Animated GIF thumbnails; per-embed `poster`/`primaryColor`/`startTime` player params (those are viewer-side query params, not stored settings).
- `requireSignedURLs` (already in the edit panel), captions/clip/downloads (separate sub-projects).
- Signed-video live thumbnail preview (needs a per-frame token).

## Worker API (extends `worker/src/routes/stream.ts`)

Widen the **existing** `PATCH /api/stream/:uid` handler (which already maps `name`/`meta`/`requireSignedURLs` into a `POST /stream/{uid}` body):
- Accept `thumbnailTimestampPct?: number` — when present, validate `0 ≤ x ≤ 1` (else `400`) and add to the update body.
- Accept `allowedOrigins?: string[]` — when present (an array), add to the update body (coerce entries to trimmed strings).
- These are additive: requests that omit them (the existing name/meta/signed edits) are unchanged.
- `CfVideo` gains `allowedOrigins?: string[]`; `StreamItem` gains `allowedOrigins: string[]`; `toStreamItem` maps `v.allowedOrigins ?? []`.
- `409` when not connected; `502` on CF failure (existing behavior).

## Client

- **`src/lib/cf-api.ts`:**
  - `StreamItem` gains `allowedOrigins: string[]`.
  - `MediaPatch` gains `thumbnailTimestampPct?: number; allowedOrigins?: string[]` (sent through the existing `updateStream(uid, patch)`).
- **`src/components/VideoSettingsPanel.tsx`** (new):
  - Props `{ item: MediaItem }`; renders only when `item.kind === "video"`.
  - **Thumbnail:** a `Slider` 0–100 (`pct`, initialized from `item.thumbnailTimestampPct × 100`). For a public, ready video (`!item.requireSignedURLs && item.thumbnail && (item.duration ?? 0) > 0`), a debounced (~300 ms) `<img>` preview at `${item.thumbnail}?time=${round((pct/100) × duration)}s&height=240`, with `onError` falling back to `item.thumbnail`. For signed videos, show `item.thumbnail` + a note that the preview updates after saving.
  - **Allowed origins:** a `Textarea` (one domain per line or comma-separated) initialized from `item.allowedOrigins.join("\n")`; a hint: "Leave empty to allow all origins." Parsed to a trimmed, non-empty `string[]` on save.
  - **Save** button → `updateStream(item.id, { thumbnailTimestampPct: pct / 100, allowedOrigins })` (via `useMutation`) → on success invalidate `["media"]` + success toast; on error red toast.
  - `useQueryClient` for invalidation. Hooks run before any conditional return.
- **`src/components/MediaDetailDrawer.tsx`** — render `<VideoSettingsPanel item={item} />` in `VideoDetail` (alongside the clip/download/caption panels).

## Data flow

Panel reads `item.thumbnailTimestampPct`/`item.allowedOrigins`. Slider → debounced preview URL (public). Save → `updateStream` → worker `POST /stream/{uid}` with `{ thumbnailTimestampPct, allowedOrigins }` → CF → invalidate `["media"]` → the gallery (and drawer on reopen) shows the new thumbnail.

## Error handling
- Not connected → `409`; out-of-range pct → `400`; CF failure → `502` → red notification.
- Live-preview image load failure → fall back to the current thumbnail (no broken image).
- Non-video items → panel not rendered.
- Empty allowed-origins → sends `[]` (allow all).

## Testing
- **Vitest (worker)** `worker/src/routes/stream.test.ts` additions:
  - `PATCH /:uid` with `{ thumbnailTimestampPct: 0.25 }` includes `thumbnailTimestampPct: 0.25` in the `POST /stream/{uid}` body.
  - `PATCH /:uid` with `{ allowedOrigins: ["example.com"] }` includes `allowedOrigins` in the body.
  - `PATCH /:uid` with an out-of-range `thumbnailTimestampPct` (e.g. `1.5`) → `400`.
  - The existing name/meta/`requireSignedURLs` edit test still passes (additive change).
  - `toStreamItem` surfaces `allowedOrigins` (covered via a GET/PATCH response assertion).
- **Client** by `npm run typecheck` + manual: open a public ready video → drag the thumbnail slider → preview updates → set an allowed origin → Save → toast → reopen: the gallery thumbnail reflects the new timestamp; a signed video shows the current thumbnail + note.

## Files
- Worker: `worker/src/routes/stream.ts` (widen PATCH + `CfVideo`/`StreamItem`/`toStreamItem`), `worker/src/routes/stream.test.ts`.
- Client: `src/lib/cf-api.ts` (StreamItem + MediaPatch fields), `src/components/VideoSettingsPanel.tsx` (new), `src/components/MediaDetailDrawer.tsx`.
- No new dependencies.
