# Image Transform Builder — Design

**Status:** Approved (revised after Cloudflare-docs verification), awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template` (branch: `feature/image-transform`)

## Goal

First of the editing/management sub-projects: an interactive **image transform builder** in the image detail drawer. Adjust Cloudflare delivery-time transform options, see a **live preview**, **copy** the transform URL, and **download** the transformed image. When the account has flexible variants disabled, **enable them in one click**.

This is delivery-time transformation (the stored original is never modified) via Cloudflare **flexible variants**.

## Mechanism (verified against Cloudflare docs)

Flexible variants append a comma-separated options string to the delivery URL:

```
https://imagedelivery.net/<accountHash>/<imageId>/w=800,height=600,fit=cover,quality=80,format=auto
```

- `accountHash` is parseable from the image's own existing delivery URL (`item.thumbnailUrl` / `item.variants[0]`, via the same regex `worker/src/lib/urls.ts#parseAccountHash` uses) and is also in the stored creds. **The client builds the transform URL itself** — no signing, no per-keystroke worker round-trip, so the preview is instant.
- **Flexible variants must be enabled** on the account: `PATCH /accounts/{account_id}/images/v1/config` with `{"flexible_variants": true}` (the app tracks `flexibleVariantsEnabled` but never sets it true today — this fills that gap).
- **Public images only.** Per Cloudflare: *"Flexible variants cannot be used for images that require a signed delivery URL."* So the builder is unavailable for images with `requireSignedURLs: true` — those get a clear notice (with a pointer to toggle signed URLs off in the existing edit panel, or to use named variants). **No URL signing is involved anywhere in this feature.**

Transform option names (from `/images/optimization/features`): `w`/`width`, `h`/`height`, `fit` (`scale-down`/`contain`/`cover`/`crop`/`pad`), `gravity`, `quality`, `format` (`auto`/`webp`/`avif`/`jpeg`/`png`), `rotate` (`90`/`180`/`270`), `blur`, `sharpen`, `brightness`, `contrast`, `gamma`, `trim`, `background`, `dpr`, `anim`, `metadata` (`keep`/`copyright`/`none`), `compression` (`fast`). The plan uses full names where they exist (`width`, `height`, …) since those are valid for flexible variants too.

## Scope

### In scope
- Transform controls (the full "Everything" set), grouped in collapsible sections:
  - **Size & fit:** width, height, fit, gravity, dpr, trim, background.
  - **Adjust:** rotate, blur, sharpen, brightness, contrast, gamma.
  - **Output:** format, quality, metadata, anim, compression.
- Live, debounced (~350 ms) preview of the transformed image (client-built URL).
- Copy the transform URL.
- Download the transformed image (worker-proxied for reliable cross-origin download).
- One-click "Enable flexible variants" when the account has them off.
- Clear gating for signed images (flexible variants not applicable) and for the empty/default options state.
- **HEIC upload support** (small, related): accept `.heic`/`.heif` in the upload dropzone and route them to the image-upload path. Cloudflare ingests HEIC and serves web formats on delivery, so once uploaded these display and transform like any other image.

### Out of scope (YAGNI)
- Saving a transform as a named account variant (sub-project B).
- Pixel editing, batch transforms, presets/history.
- Signed-image transforms (not possible with flexible variants).
- Anything Stream-related (next sub-project is video clip trimming).

## Worker API (extends `worker/src/routes/images.ts`)

Access-gated; `409` when not connected.

- `GET /api/images/:id/transform-download?o=<encoded options>&name=<filename>` — builds `https://imagedelivery.net/<creds.accountHash>/<id>/<options>`, `fetch`es it, and streams the bytes back with `Content-Disposition: attachment; filename="<name>"` and the upstream `Content-Type`. Reliable regardless of `imagedelivery.net` CORS. Non-OK upstream → `502`. (No signing — public images only.)
- `POST /api/images/flexible-variants` — `PATCH /accounts/{id}/images/v1/config` `{"flexible_variants": true}` via `cfJson`, then persists the flag through a new connection-store setter and returns the updated `ConnectionStatus`. `409` not connected; `502` on CF failure.

### Connection store
`worker/src/lib/connection-store.ts` gains `setFlexibleVariants(enabled: boolean): Promise<void>` (D1 `UPDATE` + the in-memory test impl), mirroring `patchDiscovered`. The connection service exposes a small method the route calls.

(There is intentionally **no** `transform-url` endpoint — the client builds the delivery URL directly.)

## Client

- **`src/lib/transform.ts`** — pure logic, unit-tested:
  - `type TransformOptions` (all controls, all optional).
  - `buildOptionsString(opts): string` — emits only set, non-default keys as `key=value` joined by `,`; integer vs decimal formatting; URL-safe `background`; booleans `true`/`false`; returns `""` when nothing is set.
  - `parseAccountHash(deliveryUrl): string | null` — same regex the worker uses (or import a shared helper).
  - `buildDeliveryUrl(accountHash, imageId, optionsString): string` — `https://imagedelivery.net/<hash>/<id>` plus `/<options>` when non-empty.
- **`src/lib/cf-api.ts`**:
  - `transformDownloadUrl(id, options, name): string` — the worker `GET …/transform-download?…` URL (for `<a href download>`).
  - `enableFlexibleVariants()` → `fetchJson<ConnectionStatus>` POST `/api/images/flexible-variants`.
- **`src/components/ImageTransformPanel.tsx`** (new):
  - If `item.requireSignedURLs`: render an `Alert` — flexible-variant transforms aren't available for images that require signed URLs; suggest turning signed URLs off (edit panel above) or using named variants. No controls.
  - Else read `flexibleVariantsEnabled` from the settings query (`getSettings`). If **off**: `Alert` + **Enable flexible variants** button → `enableFlexibleVariants()` → invalidate `["settings"]`; hide controls until enabled.
  - When available: `TransformOptions` state via Mantine inputs (`NumberInput`, `Select`, `Slider`, `ColorInput`, `Switch`) grouped in an `Accordion` (Size & fit / Adjust / Output). Debounce (~350 ms) → `buildDeliveryUrl(parseAccountHash(item.thumbnailUrl ?? item.variants[0]), item.id, buildOptionsString(opts))` → preview `<img src>`. Show the raw options string. Buttons: **Copy URL** (`CopyButton`) and **Download** (`<a>` to `transformDownloadUrl`). Preview `onError` → inline "Couldn't render — check the options."
  - Empty options → preview the base image (no options segment).
- **`src/components/MediaDetailDrawer.tsx`** — in `ImageDetail`, render `<ImageTransformPanel item={item} />` after the variant copy boxes.

## HEIC upload (related addition)

- `src/lib/upload.ts` — treat `.heic`/`.heif` files as images: `isHeic(file)` (extension test, since browsers often report empty `file.type` for HEIC); `isUploadable` returns true for them; `uploadFile` routes them to `uploadImage`.
- `src/components/UploadModal.tsx` — the dropzone `accept` includes `image/heic`, `image/heif` and the `.heic`/`.heif` extensions (extension entries let react-dropzone match empty-MIME HEIC files).

## Data flow

Controls → `buildOptionsString` → `buildDeliveryUrl` (client) → debounced preview `<img>` + Copy target. Download → browser hits the worker `transform-download` route → worker fetches the transform URL → streams bytes back as an attachment. Enable → worker `PATCH config` → persist flag → invalidate settings.

## Error handling
- Not connected → `409` (download + enable).
- Signed image → proactive notice, no broken preview.
- Flexible variants off → proactive `Alert` + Enable.
- Invalid option combos → CF error image → preview `<img onError>` inline notice.
- Download upstream failure → `502` → red notification.

## Testing
- **Vitest (client lib)** `src/lib/transform.test.ts` — `buildOptionsString` (empty → `""`; single/multiple; default omission; decimal vs integer; color/boolean formatting; stable ordering) and `buildDeliveryUrl` (with/without options) and `parseAccountHash`.
- **Vitest (worker)** `worker/src/routes/images.test.ts` additions —
  - `GET /:id/transform-download` builds the URL from `accountHash`, fetches (mock `fetch`), streams back with `Content-Disposition: attachment`; `409` when not connected; `502` on non-OK upstream.
  - `POST /flexible-variants` calls `PATCH …/images/v1/config` with `{"flexible_variants":true}` (assert method/URL/body), persists via the store, returns status with `flexibleVariantsEnabled: true`; `409` when not connected.
- **Client** by `npm run typecheck` + manual: open a **public** image → adjust width/fit/quality/format → preview updates → Copy URL loads → Download saves the file → a **signed** image shows the notice → an account with flexible variants off shows Enable, and enabling reveals controls → a `.heic` file uploads and appears in the gallery.

## Files
- Worker: `worker/src/routes/images.ts` (+2 routes), `worker/src/lib/connection-store.ts` (+ setter), `worker/src/services/connection.ts` (+ method), `worker/src/routes/images.test.ts`.
- Client: `src/lib/transform.ts` (new), `src/lib/transform.test.ts` (new), `src/lib/cf-api.ts`, `src/components/ImageTransformPanel.tsx` (new), `src/components/MediaDetailDrawer.tsx`, `src/lib/upload.ts` (HEIC), `src/components/UploadModal.tsx` (HEIC).
- No new dependencies.
