# Manage & Metadata — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-01
**Repo:** `aloewright/my-cf-template` (branch: `feature/manage-metadata`)

## Goal

First sub-project of the editing phase: let the owner **rename, edit metadata, toggle require-signed-URLs, and delete** images and videos — per-item from the detail drawer, plus **bulk delete** of selected rows in the table. Establishes the mutation + cache-invalidation pattern (Hono `PATCH/DELETE` → Cloudflare API → TanStack Query invalidation) that the later editing sub-projects reuse.

Runs on the current stack (TanStack Start SSR + Hono on one Worker; Mantine; TanStack Query/Table; Zustand). No user-facing changes to existing read/browse behavior.

## Scope

### In scope
- **Per-item manage** in the detail drawer (both images + videos): editable name, metadata key/value editor, require-signed-URLs switch, delete.
- **Bulk delete** of table-selected rows.
- Worker endpoints: `PATCH`/`DELETE` for images and stream.
- Mutation UX: confirm modal for deletes, success/error notifications, query invalidation.

### Out of scope
- Image transforms, in-browser pixel editor, uploads, Stream clip/thumbnail/captions (later sub-projects).
- Optimistic updates (invalidate-on-success is sufficient).
- Bulk metadata edit (only bulk *delete* this pass).

## Cloudflare constraints
- **Images:** `filename` is immutable. "Rename" = set a `name` key in the image's `metadata`; the UI displays `meta.name ?? filename`. CF `PATCH /images/v1/{id}` accepts `{ metadata, requireSignedURLs }` and **replaces** `metadata` wholesale.
- **Videos:** name *is* `meta.name`, natively editable. Updates via `POST /stream/{uid}` with `{ meta, requireSignedURLs }` (meta replaced).
- Both support `DELETE`.

## Worker API (extend existing Hono routes)
- `PATCH /api/images/:id` — body `{ name?: string; meta?: Record<string,string>; requireSignedURLs?: boolean }`. Composes `metadata = { ...(meta ?? {}), ...(name !== undefined ? { name } : {}) }`; calls CF `PATCH /images/v1/{id}` with `{ metadata, requireSignedURLs }`. Returns the re-fetched, signed `ImageItem` (reuses existing detail mapping + `signItemFull`).
- `DELETE /api/images/:id` — CF `DELETE /images/v1/{id}` → `{ ok: true }`.
- `PATCH /api/stream/:uid` — body `{ name?, meta?, requireSignedURLs? }`. Composes `meta = { ...(meta ?? {}), ...(name !== undefined ? { name } : {}) }`; calls CF `POST /stream/{uid}` with `{ meta, requireSignedURLs }`. Returns the re-fetched, signed `StreamItem`.
- `DELETE /api/stream/:uid` — CF `DELETE /stream/{uid}` → `{ ok: true }`.
- All return `409` when not connected (consistent with existing GET handlers). `cfFetch`/`cfJson` carry method + JSON body.

## Display-name change
`imageToMedia` (in `lib/media.ts`) maps `name: i.meta?.name ?? i.filename` so renamed images show their display name in grid, table, and drawer. Videos already use `meta.name`.

## Client
- `lib/cf-api.ts`: `updateImage(id, body)`, `deleteImage(id)`, `updateStream(uid, body)`, `deleteStream(uid)` (typed to `ImageItem`/`StreamItem`/`{ok:true}`).
- `lib/media.ts`: `updateMediaItem(item, patch)` and `deleteMediaItem(item)` branching on `item.kind`; `patch` is `{ name?; meta?; requireSignedURLs? }`.
- `lib/store.ts`: add `selectedIds: Record<string, boolean>` + `setSelectedIds` (the table's row-selection state, lifted so Gallery can act on it).
- `MediaTable.tsx`: drive `rowSelection` from the store (`selectedIds`/`setSelectedIds`) instead of local state.
- `MediaDetailDrawer.tsx` (inline edit, both kinds): local editable copy of `{ name, metaRows, requireSignedURLs }` seeded from the item; a **Name** `TextInput`, a **metadata key/value editor** (add/edit/remove rows, excludes the `name` key), a **require-signed-URLs** `Switch`, a **Save changes** button (`useMutation` → `updateMediaItem`), and a **Delete** danger button → `modals.openConfirmModal` → `deleteMediaItem`. On success: invalidate `["media"]` (+ `["image", id]` for images), toast, and on delete close the drawer (clear `selected`).
- `features/Gallery.tsx`: when `selectedIds` has ≥1 entry, show **“Delete selected (N)”** in the controls bar → confirm modal → `Promise.all(items.filter(selected).map(deleteMediaItem))` → invalidate `["media"]` + clear `selectedIds` + toast (report any failures).

## Data flow
Drawer/Gallery `useMutation` → `lib/media` helper → `fetchJson` `PATCH/DELETE` → Start `/api/$` server route → Hono → `cfJson` → Cloudflare. Success → `queryClient.invalidateQueries` → gallery refetches (`fetchAllMedia`) → re-signed URLs + updated names.

## Error handling
- Deletes (single + bulk) always behind `modals.openConfirmModal` ("This cannot be undone").
- Mutation errors → red notification; queries stay as-is.
- Bulk delete tolerates partial failure: report `"Deleted X of N (Y failed)"`.

## Testing
- **Vitest** (worker): for each of the 4 handlers — correct CF method/path/body (PATCH images composes `metadata` incl. `name`; stream uses `POST` with `meta`; DELETE hits the right path), `409` when `credentials()` is null, and metadata composition (name merged; name omitted when undefined). Mock `fetch`; reuse the existing route-test harness.
- Client verified by `typecheck` + live manual pass: rename an image (name updates in grid/table/drawer), edit a metadata key, toggle signed, delete a single item, select rows in the table and bulk-delete.

## Files
- Worker: `worker/src/routes/images.ts`, `worker/src/routes/stream.ts` (+ test files).
- Client: `src/lib/cf-api.ts`, `src/lib/media.ts`, `src/lib/store.ts`, `src/components/MediaDetailDrawer.tsx`, `src/components/MediaTable.tsx`, `src/features/Gallery.tsx`.
