# Uploads — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template` (branch: `feature/uploads`)

## Goal

Second editing-phase sub-project: drag-and-drop **upload of new images and videos** to the connected Cloudflare account, directly from the gallery. Bytes go **browser → Cloudflare** via one-time, pre-authorized upload URLs the Worker mints with the stored token (the token never reaches the browser; large videos don't transit the Worker). Runs on the current stack (TanStack Start SSR + Hono, Mantine, TanStack Query, Zustand).

## Scope

### In scope
- **Images:** Cloudflare Images direct upload (`POST /images/v2/direct_upload` → one-time `uploadURL`; browser POSTs the file as multipart).
- **Videos:** Cloudflare Stream **resumable (TUS)** upload via `tus-js-client` against a Worker-minted, token-less upload URL.
- **Upload modal** (opened from an Upload button in the gallery header): `@mantine/dropzone` accepting images + videos, a **Require signed URLs** checkbox (default **off**), per-file progress, success/error per file.
- On completion, invalidate the `["media"]` query so new items appear (videos show as not-ready until Cloudflare finishes processing).

### Out of scope
- Pixel editing / transforms on upload, folder organization, chunked image upload (images go in one request), URL-based "upload from URL".
- Replacing/overwriting existing assets.

## Mechanism (token stays server-side)
The Worker mints one-time upload destinations using the stored token; the browser uploads bytes directly to Cloudflare. Nothing large transits the Worker, and the token is never exposed.

## Worker API (extend existing Hono routes)
- `POST /api/images/upload-url` — body `{ requireSignedURLs?: boolean }` → CF `POST /images/v2/direct_upload` with `{ requireSignedURLs }` → returns `{ uploadURL: string; id: string }`. Registered as a `POST` handler on `images.ts` (no conflict with the GET/PATCH/DELETE `/:id`). `409` when not connected.
- `POST /api/stream/upload-url` — body `{ uploadLength: number; name?: string; requireSignedURLs?: boolean }` → performs the **Stream TUS creation** server-side against Cloudflare (sends `Tus-Resumable: 1.0.0`, `Upload-Length`, and `Upload-Metadata` encoding `name` + `requiresignedurls`), and returns `{ uploadURL: string; uid: string }` where `uploadURL` is the token-less resumable endpoint (from CF's `Location` response header) and `uid` is from `stream-media-id`. `409` when not connected.
  - **To verify in the plan (against current Cloudflare docs):** exact TUS-creation request shape (endpoint `POST /accounts/{id}/stream?direct_user=true` vs `/stream`, required headers, `Upload-Metadata` base64 encoding, and which response header carries the upload URL + uid). This is the one area to confirm rather than guess.

## Client
- New dependency: **`tus-js-client`** (video resumable upload). `@mantine/dropzone` is already installed.
- `src/lib/cf-api.ts`: `getImageUploadUrl(requireSignedURLs)` → `{uploadURL,id}`; `getStreamUploadUrl({uploadLength,name,requireSignedURLs})` → `{uploadURL,uid}`.
- `src/lib/upload.ts`: orchestration —
  - `uploadImage(file, requireSignedURLs, onProgress)`: get URL → `POST` `FormData` (`file`) to `uploadURL` with an `XMLHttpRequest` for progress.
  - `uploadVideo(file, requireSignedURLs, onProgress)`: get TUS URL → `new tus.Upload(file, { uploadUrl, onProgress, onSuccess })`.
  - `uploadFile(file, ...)`: routes by MIME (`image/*` → image, `video/*` → video; else reject).
- `src/components/UploadModal.tsx`: Mantine `Modal` + `Dropzone` (accept `IMAGE_MIME_TYPE` + video mimes), a `Switch` for require-signed-URLs, and a per-file list showing name + `Progress` + state (queued/uploading/done/error). Uploads run concurrently (bounded) on drop; on all-settled → invalidate `["media"]`, toast a summary.
- `src/lib/store.ts`: add `uploadOpen: boolean` + `setUploadOpen` so the header button and modal share state.
- `src/features/Gallery.tsx`: an **Upload** button (header) that opens the modal; render `<UploadModal>`.

## Data flow
Dropzone → `uploadFile` → (`getImageUploadUrl`/`getStreamUploadUrl` via Hono server route → CF mints one-time URL) → browser uploads bytes directly to Cloudflare (image: XHR POST; video: tus-js-client) → on success invalidate `["media"]` → gallery refetches → new items appear (video may be "not ready" until processed).

## Error handling
- Per-file error surfaced in the modal row + a red notification; other files continue (`Promise.allSettled`).
- Reject unsupported MIME types in the dropzone (and defensively in `uploadFile`).
- TUS retries handled by `tus-js-client` (`retryDelays`).

## Testing
- **Vitest** (worker): `POST /api/images/upload-url` (calls CF `images/v2/direct_upload` with `requireSignedURLs`, returns `{uploadURL,id}`, `409` when not connected) and `POST /api/stream/upload-url` (issues the TUS-creation request, returns `{uploadURL,uid}`, `409`). Mock `fetch`; assert method/URL/headers/body.
- Client verified by `typecheck` + manual: drop a small image and a short video → progress to 100% → both appear in the gallery (image immediately; video transitions to ready); a non-media file is rejected.

## Files
- Worker: `worker/src/routes/images.ts`, `worker/src/routes/stream.ts` (+ test files).
- Client: `src/lib/cf-api.ts`, `src/lib/upload.ts` (new), `src/components/UploadModal.tsx` (new), `src/lib/store.ts`, `src/features/Gallery.tsx`.
- Dependency: `tus-js-client`.
