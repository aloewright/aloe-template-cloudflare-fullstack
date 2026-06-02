# Image Transform Builder — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template` (branch: `feature/image-transform`)

## Goal

First of the editing/management sub-projects: an interactive **image transform builder** in the image detail drawer. Adjust Cloudflare delivery-time transform options, see a **live preview**, **copy** the (signed) transform URL, and **download** the transformed image. When the account has flexible variants disabled, **enable them in one click**.

This is delivery-time transformation (the stored original is never modified) via Cloudflare **flexible variants**.

## Mechanism

Cloudflare Images flexible variants append a comma-separated options string to the delivery URL:

```
https://imagedelivery.net/<accountHash>/<imageId>/width=800,height=600,fit=cover,quality=80,format=auto
```

- `accountHash` is already in the stored creds (`creds.accountHash`).
- Flexible variants must be enabled on the account (the app already tracks `flexibleVariantsEnabled`, but never sets it true today — see "Flexible variants" below).
- For images with `requireSignedURLs`, the full options URL must be HMAC-signed; the worker reuses the existing `signImageUrl(url, key, expSeconds, nowSeconds)` and the cached signing key (`getSigningKey`).

**Verify in the plan against current Cloudflare docs** (the two genuinely uncertain externals):
1. The exact **flexible-variants enable** endpoint + payload (Images config API).
2. The exact flexible-variant **option key names and value formats** (`width`/`w`, `quality` ranges, `gravity` values, `trim` syntax, `background` color format, `format` set, etc.).

## Scope

### In scope
- Transform controls (the full "Everything" set), grouped in collapsible sections:
  - **Size & fit:** width, height, fit (`scale-down`/`contain`/`cover`/`crop`/`pad`), gravity, dpr, trim, background.
  - **Adjust:** rotate (0/90/180/270), blur, sharpen, brightness, contrast, gamma.
  - **Output:** format (`auto`/`webp`/`avif`/`jpeg`/`png`), quality, metadata (`keep`/`copyright`/`none`), anim, compression.
- Live, debounced preview of the transformed image.
- Copy the (signed, if needed) transform URL.
- Download the transformed image (worker-proxied for reliable cross-origin download).
- One-click "Enable flexible variants" when the account has them off.

### Out of scope (YAGNI)
- Saving a transform as a named account variant (that's sub-project B, variant management).
- Pixel editing / canvas drawing, batch transforms, presets/history.
- Anything Stream-related (next sub-project is video clip trimming).

## Worker API (extends `worker/src/routes/images.ts`)

All routes are Access-gated and `409` when not connected (consistent with existing image routes).

- `POST /api/images/:id/transform-url` — body `{ options: string; requireSignedURLs?: boolean }`. Builds `https://imagedelivery.net/<creds.accountHash>/<id>/<options>`; if `requireSignedURLs` is true, signs via `getSigningKey` + `signImageUrl` (1-day exp). Returns `{ url }`. If `accountHash` is missing on creds, returns `{ error }` `409`.
- `GET /api/images/:id/transform-download?o=<encoded options>&signed=<0|1>&name=<filename>` — rebuilds + (optionally) signs the same URL server-side, `fetch`es it, and streams the bytes back with `Content-Disposition: attachment; filename="<name>"` and the upstream `Content-Type`. This makes Download reliable regardless of `imagedelivery.net` CORS. Non-OK upstream → `502`.
- `POST /api/images/flexible-variants` — enables flexible variants via the CF Images config API (exact endpoint verified in the plan), then persists the flag through a new connection-store setter and returns the updated `ConnectionStatus` (`{ ...status, flexibleVariantsEnabled: true }`). `409` when not connected; `502` if the CF call fails.

### Connection store
`worker/src/lib/connection-store.ts` gains a setter to persist the flexible-variants flag, e.g. `setFlexibleVariants(enabled: boolean): Promise<void>` (D1 `UPDATE`, and the in-memory test impl), mirroring the existing `patchDiscovered`. The connection service exposes a method the route calls, or the route updates the store directly via `makeService`.

## Client

- **`src/lib/transform.ts`** — pure logic, unit-tested:
  - `type TransformOptions` with all controls (numbers/enums/booleans, all optional).
  - `buildOptionsString(opts: TransformOptions): string` — emits only set, non-default keys as `key=value` joined by `,` (e.g. `width=800,fit=cover,quality=80`). Formats: integers for width/height/rotate/blur/dpr/quality; decimals for brightness/contrast/gamma; `background` as a URL-safe color; booleans as `true`/`false`. Returns `""` when nothing is set.
- **`src/lib/cf-api.ts`**:
  - `getTransformUrl(id: string, options: string, requireSignedURLs: boolean)` → `fetchJson<{ url: string }>` POST `/api/images/:id/transform-url`.
  - `transformDownloadUrl(id: string, options: string, signed: boolean, name: string): string` — returns the worker `GET …/transform-download?…` URL (for an `<a href download>`).
  - `enableFlexibleVariants()` → `fetchJson<ConnectionStatus>` POST `/api/images/flexible-variants`.
- **`src/components/ImageTransformPanel.tsx`** (new):
  - Local `TransformOptions` state driven by Mantine inputs (`NumberInput`, `Select`, `Slider`, `ColorInput`, `Switch`) grouped in an `Accordion` (Size & fit / Adjust / Output).
  - Reads `flexibleVariantsEnabled` from the existing settings query (`["settings"]` / `getSettings`). If **off**: render an `Alert` with an **Enable flexible variants** button → `enableFlexibleVariants()` → invalidate `["settings"]`; hide the controls until enabled.
  - When on: debounce (~350 ms) `buildOptionsString(opts)` → `getTransformUrl(item.id, options, item.requireSignedURLs)` → set the preview `<img src>`. Show the raw options string. Buttons: **Copy URL** (`CopyButton`) and **Download** (`<a>` to `transformDownloadUrl`). Preview `onError` → an inline "Couldn't render — check the options or that flexible variants are enabled" message.
  - Empty options → preview the base image (no options segment) so the panel always shows something.
- **`src/components/MediaDetailDrawer.tsx`** — in `ImageDetail`, render `<ImageTransformPanel item={item} />` after the variant copy boxes (images only; videos/audio unaffected).

## Data flow

Controls → `buildOptionsString` → debounced `getTransformUrl` (worker builds + signs) → preview `<img>` + Copy/Download targets. Download → browser hits the worker `transform-download` route → worker fetches the signed transform URL → streams bytes back as an attachment.

## Error handling
- Not connected → `409` on all three endpoints.
- Invalid option combinations → Cloudflare returns an error/empty image → preview `<img onError>` shows the inline notice.
- Flexible variants off → proactive `Alert` + Enable button (no broken previews).
- Download upstream failure → `502`; the client surfaces a red notification.

## Testing
- **Vitest (client lib):** `src/lib/transform.test.ts` — `buildOptionsString` across cases: empty → `""`; single/multiple keys; default omission; decimal vs integer formatting; color + boolean formatting; ordering is stable.
- **Vitest (worker):** `worker/src/routes/images.test.ts` additions —
  - `POST /upload-url`-style harness already exists. Add: `POST /:id/transform-url` builds the URL from `accountHash` and returns it unsigned for a public image; signs (URL differs / has `sig=` + `exp=`) when `requireSignedURLs`; `409` when not connected.
  - `POST /flexible-variants` calls the CF config endpoint (mock `fetch`; assert method/URL/body), persists via the store, and returns a status with `flexibleVariantsEnabled: true`; `409` when not connected.
- **Client** verified by `npm run typecheck` + manual: open an image → adjust width/fit/quality/format → preview updates → Copy URL works (and the signed URL loads) → Download saves the transformed file → for a signed image the preview still renders → toggling an account with flexible variants off shows the Enable button and enabling it reveals the controls.

## Files
- Worker: `worker/src/routes/images.ts` (+3 routes), `worker/src/lib/connection-store.ts` (+ setter), `worker/src/services/connection.ts` (+ enable/setter method if routed through the service), `worker/src/routes/images.test.ts`.
- Client: `src/lib/transform.ts` (new), `src/lib/transform.test.ts` (new), `src/lib/cf-api.ts`, `src/components/ImageTransformPanel.tsx` (new), `src/components/MediaDetailDrawer.tsx`.
- No new dependencies (Mantine inputs + existing signing/query stack).
