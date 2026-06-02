# Audio (upload + playback) — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template` (branch: `feature/audio`)

## Goal

Third editing-phase sub-project: upload and play **audio files** in the gallery, stored in a **dedicated R2 bucket**. Audio becomes a first-class media type alongside images and videos. Playback uses the `@gfazioli/mantine-audio` extension, with an animated **spectrum visualizer** in the single-item surfaces (detail drawer + cinema) and compact players in the grid/table.

## Why audio is different from images/video

Images and videos are Cloudflare media products accessed with the stored account **token** (Images API, Stream API). Audio is **not** a Cloudflare media product — it is plain object storage the worker owns directly via an **R2 binding**. So:

- No stored token is involved. Bytes go **browser → worker → R2** on upload, and **R2 → worker → browser** on playback.
- Audio is private because the worker is **Cloudflare-Access-gated**; the browser sends the Access cookie on same-origin requests to `/api/audio/:id`. There are no signed URLs (that toggle is hidden for audio).
- Editable metadata + listing live in **D1** (table `audio_files`), so a rename is a cheap row update rather than re-uploading the object.

## Scope

### In scope
- Dedicated R2 bucket `media-gallery-audio` (binding `AUDIO_BUCKET`).
- D1 table `audio_files` for metadata + listing.
- Upload of `audio/*` through the existing Upload modal (browser → `POST /api/audio` → R2 + D1).
- Range-aware streaming playback (`GET /api/audio/:id`) so scrubbing works.
- Audio as a third `MediaItem.kind` (`"audio"`) merged into the unified library; **Audio** added to the media-type filter.
- Compact inline player in grid cards + table rows; **full player with `Audio.Spectrum`** in the detail drawer and cinema view.
- **Music-note placeholder** thumbnail (`IconMusic`) wherever a thumbnail would render for audio (grid card, table cell, cinema poster).
- Rename + delete for audio.
- Player theming via the mantine-audio **Styles API** (match Mantine theme colors, Nunito font, dark/light).

### Out of scope (YAGNI)
- Waveform (`Audio.Waveform`) — only the spectrum is used.
- Transcoding / format conversion, audio trimming/editing.
- Arbitrary per-file metadata beyond `name` (audio rename only; no key/value editor).
- Playlists, queueing, cross-fade.
- A per-card spectrum (a live `AnalyserNode`/`AudioContext` per card would exceed the browser's ~6-context cap; spectrum is only in single-item surfaces).

## Storage

### R2 bucket
`media-gallery-audio`, bound as `AUDIO_BUCKET`. Object key is a generated UUID plus the original extension (e.g. `b1c2…-d3.mp3`). Put with `httpMetadata.contentType` set.

### D1 table `audio_files`
```sql
CREATE TABLE IF NOT EXISTS audio_files (
  id           TEXT PRIMARY KEY,   -- UUID, also used in /api/audio/:id
  r2_key       TEXT NOT NULL,      -- object key in AUDIO_BUCKET
  name         TEXT NOT NULL,      -- display name (defaults to filename)
  content_type TEXT NOT NULL,      -- e.g. audio/mpeg
  size         INTEGER NOT NULL,   -- bytes
  created_at   TEXT NOT NULL       -- ISO 8601
);
```

New migration file under `worker/migrations/` (next sequential number, `0002_*.sql`).

## Worker API

New `audioRoute` mounted at `/api/audio` (Access-gated like the rest). It reads `c.env.AUDIO_BUCKET` (R2) and uses an injected **audio store** (`makeAudioStore(env.DB)`) so the route is testable with a fake store + fake bucket — mirroring the `makeService` pattern used by `images`/`stream`.

### Audio store (`worker/src/lib/audio-store.ts`)
```ts
export type AudioRow = {
  id: string;
  r2_key: string;
  name: string;
  content_type: string;
  size: number;
  created_at: string;
};

export interface AudioStore {
  list(): Promise<AudioRow[]>;            // newest first
  insert(row: AudioRow): Promise<void>;
  get(id: string): Promise<AudioRow | null>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function makeAudioStore(db: D1Database): AudioStore; // D1-backed impl
```

### Endpoints
- `GET /api/audio` — list. Returns `{ files: AudioFile[] }` where
  `AudioFile = { id; name; contentType; size; createdAt; src }` and `src = "/api/audio/" + id`.
- `POST /api/audio` — upload. Body is `multipart/form-data` with `file` (required) and optional `name`. Worker: read `formData`, reject if no file (`400`); generate `id = crypto.randomUUID()`, derive extension, `r2_key = id + ext`; `await AUDIO_BUCKET.put(r2_key, file, { httpMetadata: { contentType: file.type } })`; `store.insert(...)` with `name = name ?? file.name`, `content_type = file.type || "application/octet-stream"`, `size = file.size`, `created_at = new Date().toISOString()`. Return the `AudioFile`.
- `GET /api/audio/:id` — stream/playback. Look up row (`404` if missing). Parse `Range: bytes=start-end`:
  - No range → `AUDIO_BUCKET.get(r2_key)`; respond `200` with body, `Content-Type` (from row), `Content-Length: size`, `Accept-Ranges: bytes`.
  - Range → compute `offset = start`, `length = end ? end-start+1 : size-start`; `AUDIO_BUCKET.get(r2_key, { range: { offset, length } })`; respond `206` with `Content-Range: bytes start-end/size`, `Content-Length: length`, `Accept-Ranges: bytes`. Unsatisfiable range → `416`.
- `PATCH /api/audio/:id` — rename. Body `{ name: string }` (`400` if empty). `store.rename(id, name)`; `404` if missing. Return updated `AudioFile`.
- `DELETE /api/audio/:id` — `AUDIO_BUCKET.delete(r2_key)` + `store.remove(id)` (idempotent). Return `{ ok: true }`.

### Bindings
`worker/src/types.ts`: `Bindings` gains `AUDIO_BUCKET: R2Bucket`. Regenerate `worker-configuration.d.ts` via `wrangler types`.

## Upload flow (client)

The existing Upload modal also accepts `audio/*`. `src/lib/upload.ts`:
- `isUploadable` also returns true for `audio/*`.
- `uploadFile` routes `audio/*` → `uploadAudio(file, onProgress)` (the `requireSignedURLs` arg is accepted but ignored for audio).
- `uploadAudio(file, onProgress)`: build `FormData` (`file`, `name`), `POST /api/audio` via `XMLHttpRequest` (progress), resolve on `2xx`.

`src/components/UploadModal.tsx`: add `AUDIO_MIME` (`audio/mpeg`, `audio/mp3`, `audio/wav`, `audio/ogg`, `audio/webm`, `audio/aac`, `audio/flac`, `audio/x-m4a`, `audio/mp4`, `audio/*`) and include it in the dropzone `accept`.

## Client integration

### Types (`src/lib/media.ts`)
- `MediaKind` gains `"audio"`.
- `MediaItem` gains `src: string | null` (the `/api/audio/:id` URL), `contentType: string | null`, `size: number | null` (null for image/video).
- `audioToMedia(f: AudioFile): MediaItem` → `{ kind: "audio", id, name, thumbnailUrl: "", createdAt, requireSignedURLs: false, duration: null, width: null, height: null, status: null, readyToStream: null, iframeUrl: null, links: [], variants: [], meta: {}, src, contentType, size }`.
- `fetchAllMedia` adds `allAudio()` (calls `listAudio()`) and merges: `[...images, ...videos, ...audio]`.
- `updateMediaItem` / `deleteMediaItem` branch: `kind === "audio"` → `updateAudio(id, { name })` / `deleteAudio(id)`.

### API (`src/lib/cf-api.ts`)
- `AudioFile` type (matching the worker).
- `listAudio()` → `fetchJson<{ files: AudioFile[] }>("/api/audio")`.
- `updateAudio(id, patch: { name?: string })` → `PATCH /api/audio/:id`.
- `deleteAudio(id)` → `DELETE /api/audio/:id`.

### Store (`src/lib/store.ts`)
`MediaType` gains `"audio"`. Gallery `TYPE_OPTIONS` gains `{ value: "audio", label: "Audio" }`. `filterAndSort` already filters by `kind === type`, so no change there; audio has `duration: null` (sorts to the end of the duration sort, like images).

### Components
- **`AudioThumb`** (new, or a small helper): a square neutral surface with a centered `IconMusic` (from `@tabler/icons-react`). Used as the audio "thumbnail" in `MediaCard`, `MediaTable`, and as the cinema poster.
- **`AudioPlayer`** (new, `src/components/AudioPlayer.tsx`): wraps `@gfazioli/mantine-audio`. Prop `variant: "compact" | "full"`.
  - `compact` → `<Audio src controls size="sm">` (play/pause + timeline + time), no spectrum. Used in cards/rows.
  - `full` → compound API: `<Audio src>` containing `<Audio.Spectrum>` plus `<Audio.Controls>` (`Audio.PlayButton`, `Audio.Timeline`, `Audio.TimeDisplay`, `Audio.VolumeSlider`). Used in drawer + cinema.
  - Themed via the Styles API (`classNames`/`styles`) to match Mantine theme tokens (colors, radius) and respect dark/light.
- **`MediaCard`**: `kind === "audio"` → render `AudioThumb` + name + a `compact` `AudioPlayer`.
- **`MediaTable`**: `kind === "audio"` → thumbnail cell shows `IconMusic`; a column hosts a `compact` `AudioPlayer` (or play affordance). Type/size columns populated from the audio fields.
- **`MediaDetailDrawer`**: new `AudioDetail` branch → `full` `AudioPlayer` (spectrum) + `MediaEditPanel` + badges (size, content type, created).
- **`MediaEditPanel`**: when `kind === "audio"`, hide the metadata key/value editor and the **Require signed URLs** switch; show **Name** + **Delete** only. Save calls `updateMediaItem(item, { name })` (which branches to `updateAudio`).
- **`CinemaView`**: `kind === "audio"` → poster area shows `IconMusic` on the dark backdrop with a `full` `AudioPlayer` (spectrum) below/over it; filmstrip thumb for audio shows `IconMusic`.
- **`__root.tsx`**: add `import "@gfazioli/mantine-audio/styles.css";`.

## Data flow

Upload: Dropzone → `uploadFile` → `uploadAudio` → `POST /api/audio` (XHR) → worker streams to R2 + inserts D1 → on success invalidate `["media"]` → gallery refetches → audio appears.

Playback: card/drawer/cinema renders `<Audio src="/api/audio/:id">` → browser issues (ranged) `GET` with the Access cookie → worker streams from R2 (200/206) → mantine-audio plays; in `full` variant the spectrum animates off the WebAudio analyser.

## Error handling
- Dropzone rejects non-`audio/*` (and non-image/video); `uploadFile` rejects unknown types defensively.
- Per-file upload errors surface in the modal row + notification (existing `Promise.allSettled`); other files continue.
- Worker: `400` (no file / empty rename), `404` (unknown id), `416` (bad range), `500` on R2/DB failure.
- `DELETE` is idempotent.

## Testing
- **Vitest (worker)** `worker/src/routes/audio.test.ts` with a fake `AudioStore` (Map-backed) and a fake `AUDIO_BUCKET` (Map-backed object exposing `put`/`get`/`delete`, where `get` honors `{ range }`):
  - `POST /api/audio` writes the object to the bucket and inserts a row; returns the `AudioFile`; `400` when no file.
  - `GET /api/audio` returns the mapped list with `src`.
  - `GET /api/audio/:id` → `200` + `Accept-Ranges` for a full request; `206` + `Content-Range` for a `Range` request; `404` for unknown id.
  - `PATCH /api/audio/:id` renames; `404` unknown; `400` empty name.
  - `DELETE /api/audio/:id` removes from bucket + store; returns `{ ok: true }`.
- **Client** verified by `npm run typecheck` + manual: upload an mp3 → progress to 100% → appears with a music-note thumbnail + compact player; play in the card; open the drawer → spectrum animates while playing; rename; delete.

## Files

**Worker**
- Create: `worker/migrations/0002_audio_files.sql`, `worker/src/lib/audio-store.ts`, `worker/src/routes/audio.ts`, `worker/src/routes/audio.test.ts`.
- Modify: `worker/src/types.ts` (add `AUDIO_BUCKET`), `worker/src/index.ts` (mount `audioRoute`), `worker-configuration.d.ts` (regenerate), `wrangler.jsonc` (add `r2_buckets`).

**Client**
- Create: `src/components/AudioPlayer.tsx`, `src/components/AudioThumb.tsx` (if not inlined).
- Modify: `src/lib/cf-api.ts`, `src/lib/media.ts`, `src/lib/upload.ts`, `src/lib/store.ts`, `src/components/UploadModal.tsx`, `src/components/MediaCard.tsx`, `src/components/MediaTable.tsx`, `src/components/MediaDetailDrawer.tsx`, `src/components/MediaEditPanel.tsx`, `src/components/CinemaView.tsx`, `src/features/Gallery.tsx`, `src/routes/__root.tsx`.

**Dependency:** `@gfazioli/mantine-audio`.

## Setup actions (in the plan)
1. `wrangler r2 bucket create media-gallery-audio`.
2. Add the `r2_buckets` binding to `wrangler.jsonc`.
3. Create the `0002_audio_files.sql` migration; apply locally and `--remote` (CI does not auto-apply migrations).
4. `npx wrangler types` to regenerate `worker-configuration.d.ts`.
5. `npm install @gfazioli/mantine-audio` (verify Mantine v9 / React peer compatibility at install).
