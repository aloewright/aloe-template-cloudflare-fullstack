# Image Variant Management — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-02
**Repo:** `aloewright/my-cf-template` (branch: `feature/variant-management`)

## Goal

Editing/management sub-project B: a **Variants** section on the `/settings` page to manage account-level named Cloudflare Images variants — list, create, edit, delete. Because a variant is account-wide, a change affects every image; edits and deletes are gated by a confirm modal that says so.

## Mechanism (verified against Cloudflare docs)

- **List:** `GET /accounts/{id}/images/v1/variants` → `{ result: { variants: { <name>: { id, options: { fit, metadata, width, height }, neverRequireSignedURLs } } } }`.
- **Create:** `POST /accounts/{id}/images/v1/variants` body `{ id: "<name>", options: { fit, metadata, width, height }, neverRequireSignedURLs }`.
- **Edit:** `PATCH /accounts/{id}/images/v1/variants/{name}` body `{ options: { fit, metadata, width, height }, neverRequireSignedURLs }`. **The plan verifies the exact edit body** (options + `neverRequireSignedURLs`).
- **Delete:** `DELETE /accounts/{id}/images/v1/variants/{name}`. The `public` variant cannot be deleted (Cloudflare rejects it; we also block it client- and worker-side).

Variant options: `fit` ∈ {`scale-down`, `contain`, `cover`, `crop`, `pad`}; `metadata` ∈ {`keep`, `copyright`, `none`}; `width`/`height` positive integers (either may be omitted); `neverRequireSignedURLs` (always-public, even for signed images).

## Scope

### In scope
- List all account variants (name, fit, `w×h`, metadata, "always public" flag).
- Create a variant; edit an existing one; delete one (not `public`).
- Global-effect confirms on edit + delete.

### Out of scope (YAGNI)
- The `blur` variant option (uncommon; can be added later).
- Per-image variant overrides; bulk operations; reordering.
- Surfacing variant usage counts.

## Worker API (extends `worker/src/routes/images.ts`)

Access-gated; `409` when not connected; `502` on Cloudflare failure.

- **Extend** `GET /api/images/variants` → return full defs:
  `{ variants: Record<string, { fit: string | null; metadata: string | null; width: number | null; height: number | null; neverRequireSignedURLs: boolean }> }`. Additive — existing consumers (the detail drawer's dimension labels) still read `width`/`height`.
- `POST /api/images/variants` — body `{ name: string; fit: string; width?: number; height?: number; metadata: string; neverRequireSignedURLs?: boolean }`. Validate `name` (`^[A-Za-z0-9_-]{1,64}$`), `fit` and `metadata` against the allowed sets → `400`. CF `POST /images/v1/variants` with `{ id: name, options: { fit, metadata, ...(width?{width}:{}) , ...(height?{height}:{}) }, neverRequireSignedURLs: !!neverRequireSignedURLs }`. Returns `{ ok: true }`.
- `PATCH /api/images/variants/:name` — same validated body (sans `name`, which comes from the path). CF `PATCH /images/v1/variants/{name}` with `{ options, neverRequireSignedURLs }`. `400` for an invalid `:name`/fit/metadata. Returns `{ ok: true }`.
- `DELETE /api/images/variants/:name` — `400` when `name === "public"`; else CF `DELETE /images/v1/variants/{name}`. Returns `{ ok: true }`.

Route paths: `GET`/`POST /variants` (static, prioritized over `/:id`), `PATCH`/`DELETE /variants/:name` (two-segment, distinct from `PATCH`/`DELETE /:id`). No collision with existing image routes.

## Client

- **`src/lib/cf-api.ts`:**
  - Rename `VariantDims` → `VariantDef = { fit: string | null; metadata: string | null; width: number | null; height: number | null; neverRequireSignedURLs: boolean }` (superset of the old `{width,height}`); update the two usages in `MediaDetailDrawer.tsx` (`getImageVariants` typing + `dimsLabel`).
  - `getImageVariants()` → `{ variants: Record<string, VariantDef> }` (now full defs).
  - `type VariantInput = { name: string; fit: string; width?: number; height?: number; metadata: string; neverRequireSignedURLs?: boolean }`.
  - `createVariant(input: VariantInput)` → `POST /api/images/variants`.
  - `updateVariant(name, input: Omit<VariantInput, "name">)` → `PATCH /api/images/variants/:name`.
  - `deleteVariant(name)` → `DELETE /api/images/variants/:name`.
- **`src/components/VariantManager.tsx`** (new):
  - `useQuery(["imageVariants"], getImageVariants)`. Renders a table: each variant row shows `name`, `fit`, `w×h` (or "auto"), `metadata`, and an "always public" `Badge` when `neverRequireSignedURLs`. Row actions: **Edit** (all) and **Delete** (hidden for `public`).
  - **Create/Edit form** (inline `Stack` or a `Modal`): `name` `TextInput` (read-only when editing), `fit` `Select` (FIT set), `width`/`height` `NumberInput` (optional), `metadata` `Select` (META set), "Always public" `Switch`. Submit → `createVariant`/`updateVariant`.
  - **Edit** and **Delete** open a `modals.openConfirmModal` warning the change is global (affects all images) before mutating.
  - All mutations: success → invalidate `["imageVariants"]` + success notification; error → red notification.
- **`src/features/Settings.tsx`** — render `<VariantManager />` (in the Stack) when `status.data?.connected`.

## Data flow

Settings mounts → `getImageVariants` → table. Create/Edit → validated worker call → CF → invalidate `["imageVariants"]` → table refreshes. Delete → confirm (global warning) → worker → CF → invalidate.

## Error handling
- Not connected → `409`; invalid name/fit/metadata → `400`; delete `public` → `400` (and the UI hides its Delete button); CF failure (incl. duplicate-name create) → `502` → red notification.
- The `public` variant: shown in the list, Edit allowed, Delete suppressed.

## Testing
- **Vitest (worker)** `worker/src/routes/images.test.ts` additions:
  - `GET /variants` maps CF's nested shape to full defs (`fit`/`metadata`/`width`/`height`/`neverRequireSignedURLs`).
  - `POST /variants` sends `{ id, options: { fit, metadata, width, height }, neverRequireSignedURLs }` (assert method/URL/body); `400` for an invalid `fit`/`name`.
  - `PATCH /variants/:name` sends `{ options, neverRequireSignedURLs }`.
  - `DELETE /variants/public` → `400` (no CF call); `DELETE /variants/thumb` → CF `DELETE …/variants/thumb`.
  - `409` when not connected.
- **Client** by `npm run typecheck` + manual: open Settings → see the variant list → create a `square` variant (cover, 512×512, metadata none) → appears → edit it → delete it (confirm warns it's global) → `public` shows no Delete.

## Files
- Worker: `worker/src/routes/images.ts` (extend GET + 3 handlers), `worker/src/routes/images.test.ts`.
- Client: `src/lib/cf-api.ts` (rename + fetchers), `src/components/MediaDetailDrawer.tsx` (rename usage), `src/components/VariantManager.tsx` (new), `src/features/Settings.tsx`.
- No new dependencies.
