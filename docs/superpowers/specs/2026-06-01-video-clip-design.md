# Video Clip Trimming — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template` (branch: `feature/video-clip`)

## Goal

Editing/management sub-project D: trim a ready Cloudflare Stream video into a **new clip** from the video detail drawer by selecting start/end times. The clip processes on Cloudflare and appears in the library when ready.

## Mechanism (verified against Cloudflare docs)

Cloudflare on-demand clipping creates a **new** video from an existing one:

```
POST /accounts/{account_id}/stream/clip
{ "clippedFromVideoUID": "<uid>", "startTimeSeconds": 10, "endTimeSeconds": 40 }
```

The response is a new video with its own `uid`; it processes asynchronously (status `queued`/`inprogress` → `ready`) and then shows in the library like any uploaded video. It plays in the existing drawer player once ready.

**Verify in the plan against current docs:** whether `/stream/clip` accepts a name/`meta` inline. If it does, send `meta: { name }`; if not, the worker follows the create with a `PATCH /stream/{newUid}` to set `meta.name`. (Clipped videos do **not** inherit `scheduledDeletion` — not relevant here.)

## Scope

### In scope
- Worker `POST /api/stream/:uid/clip` → CF `/stream/clip`, returns the new `StreamItem` (mapped via existing `toStreamItem` + `signStreamItems`).
- A trim panel in the video detail drawer: a two-thumb range slider over the source duration, synced numeric (seconds) inputs, mm:ss readouts, a live clip-length label, a name field, and a Create button.
- On success: a "processing" notification + refresh of the media list (the clip appears, not-ready then ready). Stay on the source video.

### Out of scope (YAGNI)
- MP4 download of the clip (that's the next sub-project, E).
- Live-stream instant clipping (different mechanism/manifest).
- Frame-accurate scrubbing / player-synced playhead capture (range slider + numeric inputs only).
- Watermarks, captions, thumbnail timestamp (separate sub-projects).

## Worker API (extends `worker/src/routes/stream.ts`)

- `POST /api/stream/:uid/clip` — body `{ startTimeSeconds: number; endTimeSeconds: number; name?: string }`. Access-gated; `409` when not connected.
  - Validate: both finite numbers, `startTimeSeconds >= 0`, `endTimeSeconds > startTimeSeconds` → else `400 { error }`.
  - Call `cfJson(creds, "/stream/clip", { method: "POST", body: JSON.stringify({ clippedFromVideoUID: uid, startTimeSeconds, endTimeSeconds, ...(name ? { meta: { name } } : {}) }) })`.
  - If the plan finds `/stream/clip` ignores `meta`, follow with `cfJson(creds, "/stream/{newUid}", { method: "POST", body: JSON.stringify({ meta: { name } }) })` (Stream uses `POST /stream/{uid}` for edits, as the existing PATCH-equivalent does).
  - Map the new video through `toStreamItem`, run `signStreamItems([item], creds)`, return the `StreamItem` (`200`). CF failure → `502`.

Route path `POST /:uid/clip` is two-segment and does not collide with the existing `POST /upload-url`, `GET/PATCH/DELETE /:uid`, or `GET /`.

## Client

- **`src/lib/clip.ts`** (new, pure, unit-tested):
  - `isValidClipRange(startSeconds: number, endSeconds: number, durationSeconds: number): boolean` — `start >= 0 && end > start && end <= durationSeconds` (and finite).
  - `clipSecondsLabel(seconds: number): string` — `m:ss` formatting (so the panel and tests share one formatter).
- **`src/lib/cf-api.ts`** — `createClip(uid: string, input: { startTimeSeconds: number; endTimeSeconds: number; name?: string })` → `fetchJson<StreamItem>("/api/stream/:uid/clip", { method: "POST", … })`.
- **`src/components/VideoClipPanel.tsx`** (new):
  - Props `{ item: MediaItem }`. Renders only when `item.kind === "video" && item.readyToStream && (item.duration ?? 0) > 0`.
  - State `[start, end]` (seconds), initialized `[0, duration]`. A Mantine `RangeSlider` (`min={0}`, `max={duration}`, `step={1}`, `minRange={1}`, `value={[start, end]}`, label formatted via `clipSecondsLabel`) kept in sync with two `NumberInput`s (Start/End seconds). A `Text` showing `Clip length: <clipSecondsLabel(end - start)>`. A `TextInput` for name, default `"<item.name> (clip)"`.
  - `useMutation(createClip)`: Create button disabled unless `isValidClipRange(start, end, duration)`. `onSuccess`: `notifications.show({ message: "Clip is processing — it'll appear shortly", color: "green" })` + `queryClient.invalidateQueries({ queryKey: ["media"] })`. `onError`: red notification.
- **`src/components/MediaDetailDrawer.tsx`** — render `<VideoClipPanel item={item} />` inside `VideoDetail` (after the badges/links, before/after `MediaEditPanel` — placed after the links block).

## Data flow

Slider/inputs → `[start, end]` state (kept consistent both directions) → Create → `createClip(uid, {startTimeSeconds, endTimeSeconds, name})` → worker validates → CF `/stream/clip` (+ optional name PATCH) → returns the new `StreamItem` → client invalidates `["media"]` → the clip appears in the gallery (processing, then ready).

## Error handling
- Invalid range (end ≤ start, or end > duration) → Create disabled (client) + `400` guard (worker).
- Not connected → `409`.
- CF clip failure → `502` → red notification.
- Not-ready / non-video items → panel not rendered.

## Testing
- **Vitest (worker)** `worker/src/routes/stream.test.ts` additions:
  - `POST /:uid/clip` posts to `/stream/clip` with `{ clippedFromVideoUID: "<uid>", startTimeSeconds, endTimeSeconds }` (assert method/URL/body), and returns the mapped new `StreamItem`.
  - `400` when `endTimeSeconds <= startTimeSeconds`.
  - `409` when not connected.
- **Vitest (client lib)** `src/lib/clip.test.ts`: `isValidClipRange` (valid; end ≤ start; end > duration; negatives) and `clipSecondsLabel` (`0 → "0:00"`, `9 → "0:09"`, `75 → "1:15"`).
- **Client** by `npm run typecheck` + manual: open a ready video → set start/end via slider and inputs (they stay in sync) → clip-length updates → name defaults → Create → "processing" toast → the clip appears in the gallery and becomes playable when ready.

## Files
- Worker: `worker/src/routes/stream.ts` (+route), `worker/src/routes/stream.test.ts`.
- Client: `src/lib/clip.ts` (new), `src/lib/clip.test.ts` (new), `src/lib/cf-api.ts`, `src/components/VideoClipPanel.tsx` (new), `src/components/MediaDetailDrawer.tsx`.
- No new dependencies.
