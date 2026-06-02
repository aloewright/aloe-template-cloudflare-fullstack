# Stream Captions — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-02
**Repo:** `aloewright/my-cf-template` (branch: `feature/stream-captions`)

## Goal

Editing/management sub-project C: manage a Stream video's captions from the detail drawer — list them (language label, auto-generated badge, status), **AI-generate** captions for a chosen language, **upload a `.vtt`** file, and **delete** a caption. The panel polls while a generated caption is processing.

## Mechanism (verified against Cloudflare docs)

- **List:** `GET /accounts/{id}/stream/{uid}/captions` → `{ result: [{ language, label, generated, status }] }`. `status` is `inprogress` → `ready` (or `error`); `generated` is `true` for AI captions; `label` is derived by Cloudflare from the language (e.g. `de` → "Deutsch", auto-generated ones get an "(auto-generated)" suffix).
- **AI generate:** `POST /accounts/{id}/stream/{uid}/captions/{lang}/generate` (Workers AI speech-to-text). Supported languages: `en, cs, nl, fr, de, it, ja, ko, pl, pt, ru, es`. **The plan verifies the exact endpoint path** (the SDK exposes `captions.generate(lang)`; the REST path is `…/captions/{lang}/generate`).
- **Upload:** `PUT /accounts/{id}/stream/{uid}/captions/{lang}` as `multipart/form-data` with `file=<.vtt>`. WebVTT only; ≤10 MB; one caption per language (re-PUT replaces). The plan verifies the multipart field name is `file`.
- **Delete:** `DELETE /accounts/{id}/stream/{uid}/captions/{lang}`.

Uploads/generate require the Cloudflare API token, so the worker proxies all of these (the `.vtt` is tiny — no large-payload concern).

## Scope

### In scope
- List existing captions with label, an "auto" badge for generated ones, and status.
- AI-generate a caption for a language chosen from the supported set.
- Upload a `.vtt` for a language chosen from a curated list.
- Delete a caption.
- Poll while any caption is `inprogress`.

### Out of scope (YAGNI)
- Editing/previewing the VTT text in-app (`GET …/captions/{lang}/vtt` is not surfaced).
- Free-text BCP-47 entry (curated dropdowns only).
- Bulk caption operations; translation between languages.

## Worker API (extends `worker/src/routes/stream.ts`)

Access-gated; `409` when not connected; `400` for a non-32-hex `:uid` (matching the existing clip/downloads guard) or a `:lang` failing `^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$`; `502` on Cloudflare failure.

- `GET /api/stream/:uid/captions` → CF `GET /stream/{uid}/captions` → `{ captions: Caption[] }`, `Caption = { language: string; label: string; generated: boolean; status: string }` (normalized: `generated ?? false`, `status ?? "unknown"`, `label ?? language`).
- `POST /api/stream/:uid/captions/:lang/generate` → CF `POST /stream/{uid}/captions/{lang}/generate` → `{ ok: true }`.
- `PUT /api/stream/:uid/captions/:lang` → read `c.req.formData()`; the `file` field must be a `File` (`400` otherwise); re-`PUT` to CF `/stream/{uid}/captions/{lang}` with a `FormData` containing `file` (via `cfFetch`, which omits `Content-Type` for `FormData` so the multipart boundary is set by the runtime — the existing behavior from the images-upload fix) → `{ ok: true }`.
- `DELETE /api/stream/:uid/captions/:lang` → CF `DELETE /stream/{uid}/captions/{lang}` → `{ ok: true }`.

Route paths (`/:uid/captions`, `/:uid/captions/:lang`, `/:uid/captions/:lang/generate`) don't collide with the existing `/:uid`, `/:uid/clip`, `/:uid/downloads`, `/upload-url`, or `/` (distinguished by depth + static segments).

## Client

- **`src/lib/captions.ts`** (new): `CAPTION_LANGUAGES: { value: string; label: string }[]` (broad common list for upload — e.g. en, es, fr, de, it, pt, ja, ko, ru, zh, ar, hi, nl, pl, cs, tr) and `GENERATE_LANGUAGES: { value: string; label: string }[]` (the 12 AI-supported: en, cs, nl, fr, de, it, ja, ko, pl, pt, ru, es). Plain data; no test needed.
- **`src/lib/cf-api.ts`**:
  - `type Caption = { language: string; label: string; generated: boolean; status: string }`.
  - `listCaptions(uid)` → `GET …/captions` → `{ captions: Caption[] }`.
  - `generateCaption(uid, lang)` → `POST …/captions/:lang/generate`.
  - `uploadCaption(uid, lang, file)` → `PUT …/captions/:lang` with a `FormData` (`file`).
  - `deleteCaption(uid, lang)` → `DELETE …/captions/:lang`.
- **`src/components/VideoCaptionPanel.tsx`** (new):
  - Props `{ item: MediaItem }`; renders only when `item.kind === "video" && item.readyToStream`.
  - `useQuery({ queryKey: ["captions", item.id], queryFn: () => listCaptions(item.id), enabled, refetchInterval: (q) => q.state.status !== "error" && (q.state.data?.captions.some((c) => c.status === "inprogress")) ? 5000 : false })`.
  - **List:** each caption row shows `label`, an "auto" `Badge` when `generated`, a status `Badge` (`ready`/`in progress`/`error`), and a **Delete** button (`deleteCaption` mutation).
  - **Generate row:** a `Select` (`GENERATE_LANGUAGES`) + **Generate** button (`generateCaption` mutation).
  - **Upload row:** a `Select` (`CAPTION_LANGUAGES`) + a `FileInput accept=".vtt,text/vtt"` + **Upload** button (`uploadCaption` mutation, disabled until both language and file are chosen).
  - All mutations: success → invalidate `["captions", item.id]`; error → red notification. Polling stops on error (matching the downloads-panel fix).
- **`src/components/MediaDetailDrawer.tsx`** — render `<VideoCaptionPanel item={item} />` in `VideoDetail`, after `<VideoDownloadPanel item={item} />`.

## Data flow

Panel mounts → `listCaptions` → render list + Generate/Upload controls. Generate → `POST` → invalidate → a new caption appears `inprogress` → `refetchInterval` polls every 5 s → `ready`. Upload → client builds `FormData(file)` → worker re-PUTs to CF → invalidate. Delete → `DELETE` → invalidate.

## Error handling
- Not connected → `409`; bad uid/lang → `400`; missing/`non-File` upload → `400`; CF failure → `502` → red notification.
- Non-VTT or oversize files: the `FileInput accept` filters extension; Cloudflare rejects truly invalid/oversize files → surfaced as a `502` + notification.
- Polling stops once no caption is `inprogress`, and also halts on a fetch error.
- Not-ready / non-video items → panel not rendered.

## Testing
- **Vitest (worker)** `worker/src/routes/stream.test.ts` additions:
  - `GET /:uid/captions` maps the CF list to `{ captions: [...] }` with normalized fields.
  - `POST /:uid/captions/:lang/generate` calls CF `…/stream/{uid}/captions/en/generate` (assert method `POST` + URL); `400` for an invalid `:lang`.
  - `PUT /:uid/captions/:lang` with a `FormData` `file` re-PUTs to CF `…/captions/en` (assert method `PUT` + that the body is `FormData`); `400` when no file.
  - `DELETE /:uid/captions/:lang` calls CF `DELETE …/captions/en`.
  - `409` when not connected.
- **Client** by `npm run typecheck` + manual: open a ready video → Generate (e.g. English) → caption appears "in progress" → becomes "ready" → shows the "auto" badge; upload a `.vtt` for another language → appears "ready"; delete a caption → it disappears.

## Files
- Worker: `worker/src/routes/stream.ts` (+4 handlers), `worker/src/routes/stream.test.ts`.
- Client: `src/lib/captions.ts` (new), `src/lib/cf-api.ts`, `src/components/VideoCaptionPanel.tsx` (new), `src/components/MediaDetailDrawer.tsx`.
- No new dependencies.
