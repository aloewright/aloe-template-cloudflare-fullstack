# Manage & Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rename, metadata editing, require-signed-URLs toggle, and delete (single + bulk) for Cloudflare Images and Stream videos.

**Architecture:** New Hono `PATCH`/`DELETE` handlers on the existing `/api/images` and `/api/stream` routes proxy to the Cloudflare API; the React detail drawer gains inline edit controls and the table's row-selection drives a bulk-delete action. Mutations go through TanStack Query and invalidate the `["media"]` cache on success.

**Tech Stack:** Hono + Cloudflare REST (`cfJson`), TanStack Query/Table, Zustand, Mantine (`@mantine/modals` confirm, `@mantine/notifications`), Vitest.

**Conventions:** License header `/* AGPL-3.0-or-later */` on new files. `npm run check` (oxlint + Prettier) to format. Worker logic is TDD with Vitest; client UI verified by `npm run typecheck` + manual. Run a single worker test with `npm run test -- <name>`.

---

## File Structure
- `worker/src/routes/images.ts` — add `PATCH /:id`, `DELETE /:id` (alongside existing GET handlers + `toImageItem`/`signItemFull`).
- `worker/src/routes/stream.ts` — add `PATCH /:uid`, `DELETE /:uid` (alongside existing GET + `toStreamItem`/`signStreamItems`).
- `worker/src/routes/images.test.ts`, `worker/src/routes/stream.test.ts` — tests for the new handlers.
- `src/lib/cf-api.ts` — `updateImage`/`deleteImage`/`updateStream`/`deleteStream`.
- `src/lib/media.ts` — `updateMediaItem`/`deleteMediaItem`; image display-name = `meta.name ?? filename`.
- `src/lib/store.ts` — `selectedIds` + `setSelectedIds`.
- `src/components/MediaTable.tsx` — drive `rowSelection` from the store.
- `src/components/MediaEditPanel.tsx` — NEW; inline edit form (name/meta/signed/save/delete), used by the drawer.
- `src/components/MediaDetailDrawer.tsx` — render `MediaEditPanel` in both image/video details.
- `src/features/Gallery.tsx` — "Delete selected (N)" bulk action.

---

## Task 1: Worker — image PATCH + DELETE

**Files:**
- Modify: `worker/src/routes/images.ts`
- Test: `worker/src/routes/images.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe("imagesRoute", ...)` block in `worker/src/routes/images.test.ts` (before its closing `});`):

```ts
  it("PATCH composes metadata (incl. name) + requireSignedURLs and returns the item", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: "img1",
              filename: "cat.png",
              requireSignedURLs: true,
              meta: { name: "Kitty", tag: "x" },
              variants: ["https://imagedelivery.net/HASH/img1/public"],
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connectedService).request("/api/images/img1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Kitty", meta: { tag: "x" }, requireSignedURLs: true }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/img1");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(init!.body as string)).toEqual({
      metadata: { tag: "x", name: "Kitty" },
      requireSignedURLs: true,
    });
    const body = (await res.json()) as { id: string; meta: Record<string, string> };
    expect(body.id).toBe("img1");
    expect(body.meta.name).toBe("Kitty");
  });

  it("DELETE calls the CF delete endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connectedService).request("/api/images/img1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/img1");
    expect(init!.method).toBe("DELETE");
  });

  it("PATCH returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/img1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- routes/images`
Expected: FAIL — the PATCH/DELETE requests return 404 (no handler), so status assertions fail.

- [ ] **Step 3: Implement the handlers** — in `worker/src/routes/images.ts`, add these two handlers immediately **after** the existing `app.get("/:id", ...)` handler and **before** `return app;`:

```ts
  app.patch("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{ name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean }>()
      .catch(() => ({}) as { name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean });
    const metadata = {
      ...(body.meta ?? {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
    };
    const patchBody: Record<string, unknown> = { metadata };
    if (body.requireSignedURLs !== undefined) patchBody.requireSignedURLs = body.requireSignedURLs;
    const img = await cfJson<CfImage>(creds, `/images/v1/${c.req.param("id")}`, {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    });
    const item = toImageItem(img);
    await signItemFull(item, creds);
    return c.json(item);
  });

  app.delete("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    await cfJson(creds, `/images/v1/${c.req.param("id")}`, { method: "DELETE" });
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- routes/images`
Expected: PASS — all imagesRoute tests pass.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/images.ts worker/src/routes/images.test.ts
git commit -m "feat(worker): PATCH + DELETE for images"
```

---

## Task 2: Worker — stream PATCH + DELETE

**Files:**
- Modify: `worker/src/routes/stream.ts`
- Test: `worker/src/routes/stream.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside the existing `describe("streamRoute", ...)` block in `worker/src/routes/stream.test.ts` (before its closing `});`):

```ts
  it("PATCH composes meta (incl. name) via CF POST and returns the item", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              uid: "vid1",
              meta: { name: "Renamed", tag: "y" },
              thumbnail: "https://customer-CODE.cloudflarestream.com/vid1/thumbnails/thumbnail.jpg",
              status: { state: "ready" },
              readyToStream: true,
              requireSignedURLs: false,
              created: "2026-01-01T00:00:00Z",
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request("/api/stream/vid1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", meta: { tag: "y" }, requireSignedURLs: false }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream/vid1");
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({
      meta: { tag: "y", name: "Renamed" },
      requireSignedURLs: false,
    });
    const body = (await res.json()) as { uid: string; name: string };
    expect(body.uid).toBe("vid1");
    expect(body.name).toBe("Renamed");
  });

  it("DELETE calls the CF stream delete endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request("/api/stream/vid1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream/vid1");
    expect(init!.method).toBe("DELETE");
  });

  it("PATCH returns 409 when not connected", async () => {
    const res = await app(disconnected).request("/api/stream/vid1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -- routes/stream`
Expected: FAIL — no PATCH/DELETE handler (404).

- [ ] **Step 3: Implement the handlers** — in `worker/src/routes/stream.ts`, add immediately **after** the existing `app.get("/:uid", ...)` handler and **before** `return app;`:

```ts
  app.patch("/:uid", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{ name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean }>()
      .catch(() => ({}) as { name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean });
    const meta = { ...(body.meta ?? {}), ...(body.name !== undefined ? { name: body.name } : {}) };
    const updateBody: Record<string, unknown> = { meta };
    if (body.requireSignedURLs !== undefined) updateBody.requireSignedURLs = body.requireSignedURLs;
    const video = await cfJson<CfVideo>(creds, `/stream/${c.req.param("uid")}`, {
      method: "POST",
      body: JSON.stringify(updateBody),
    });
    const item = toStreamItem(video);
    await signStreamItems([item], creds);
    return c.json(item);
  });

  app.delete("/:uid", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    await cfJson(creds, `/stream/${c.req.param("uid")}`, { method: "DELETE" });
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test -- routes/stream`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/routes/stream.ts worker/src/routes/stream.test.ts
git commit -m "feat(worker): PATCH + DELETE for stream videos"
```

---

## Task 3: Client — API mutations, media helpers, display-name

**Files:**
- Modify: `src/lib/cf-api.ts`
- Modify: `src/lib/media.ts`

- [ ] **Step 1: Add mutation fetchers** — in `src/lib/cf-api.ts`, append after the existing `getImageVariants` export:

```ts
export type MediaPatch = {
  name?: string;
  meta?: Record<string, string>;
  requireSignedURLs?: boolean;
};

export const updateImage = (id: string, patch: MediaPatch) =>
  fetchJson<ImageItem>(`/api/images/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const deleteImage = (id: string) =>
  fetchJson<{ ok: true }>(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });

export const updateStream = (uid: string, patch: MediaPatch) =>
  fetchJson<StreamItem>(`/api/stream/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const deleteStream = (uid: string) =>
  fetchJson<{ ok: true }>(`/api/stream/${encodeURIComponent(uid)}`, { method: "DELETE" });
```

- [ ] **Step 2: Add media helpers + fix image display-name** — in `src/lib/media.ts`:

(a) Update the imports at the top to add the mutation fns:
```ts
import {
  deleteImage,
  deleteStream,
  type ImageItem,
  listImages,
  listStream,
  type MediaPatch,
  type StreamItem,
  type StreamLink,
  updateImage,
  updateStream,
} from "@/lib/cf-api";
```

(b) In `imageToMedia`, change the `name` line to prefer the metadata display-name:
```ts
    name: i.meta?.name ?? i.filename,
```

(c) Append these helpers at the end of the file:
```ts
export function updateMediaItem(item: MediaItem, patch: MediaPatch): Promise<ImageItem | StreamItem> {
  return item.kind === "image" ? updateImage(item.id, patch) : updateStream(item.id, patch);
}

export function deleteMediaItem(item: MediaItem): Promise<{ ok: true }> {
  return item.kind === "image" ? deleteImage(item.id) : deleteStream(item.id);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/cf-api.ts src/lib/media.ts
git commit -m "feat(client): media update/delete fetchers + display-name from meta.name"
```

---

## Task 4: Client — lift table selection into the store

**Files:**
- Modify: `src/lib/store.ts`
- Modify: `src/components/MediaTable.tsx`

- [ ] **Step 1: Add selection state to the store** — in `src/lib/store.ts`:

(a) Add to the `UIState` type (after `selected: MediaItem | null;`):
```ts
  selectedIds: Record<string, boolean>;
```
and (after `setSelected: ...;`):
```ts
  setSelectedIds: (ids: Record<string, boolean>) => void;
```

(b) Add to the `create<UIState>` initial object (after `selected: null,`):
```ts
  selectedIds: {},
```
and (after `setSelected: (selected) => set({ selected }),`):
```ts
  setSelectedIds: (selectedIds) => set({ selectedIds }),
```

- [ ] **Step 2: Drive the table's rowSelection from the store** — in `src/components/MediaTable.tsx`:

(a) Add the store import after the existing imports:
```ts
import { useUIStore } from "@/lib/store";
```

(b) Replace the local selection state line:
```ts
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
```
with:
```ts
  const rowSelection = useUIStore((s) => s.selectedIds);
  const setRowSelection = useUIStore((s) => s.setSelectedIds);
```

(c) The existing `onRowSelectionChange: setRowSelection,` must accept the updater form. Replace it with:
```ts
    onRowSelectionChange: (updater) =>
      setRowSelection(typeof updater === "function" ? updater(rowSelection) : updater),
```

(d) Remove the now-unused `RowSelectionState` import if `useState<RowSelectionState>` was its only use (keep `SortingState`). If oxlint/tsc flags `RowSelectionState` as unused, delete it from the `@tanstack/react-table` import list.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/store.ts src/components/MediaTable.tsx
git commit -m "feat(client): lift table row-selection into the Zustand store"
```

---

## Task 5: Client — inline edit panel in the detail drawer

**Files:**
- Create: `src/components/MediaEditPanel.tsx`
- Modify: `src/components/MediaDetailDrawer.tsx`

- [ ] **Step 1: Create `src/components/MediaEditPanel.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { ActionIcon, Button, Group, Stack, Switch, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteMediaItem, type MediaItem, updateMediaItem } from "@/lib/media";
import { useUIStore } from "@/lib/store";

type Row = { key: string; value: string };

export function MediaEditPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const setSelected = useUIStore((s) => s.setSelected);

  const [name, setName] = useState(item.meta.name ?? item.name);
  const [rows, setRows] = useState<Row[]>(
    Object.entries(item.meta)
      .filter(([k]) => k !== "name")
      .map(([key, value]) => ({ key, value })),
  );
  const [requireSignedURLs, setRequireSignedURLs] = useState(item.requireSignedURLs);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["media"] });
    if (item.kind === "image") queryClient.invalidateQueries({ queryKey: ["image", item.id] });
  };

  const save = useMutation({
    mutationFn: () => {
      const meta: Record<string, string> = {};
      for (const r of rows) if (r.key.trim()) meta[r.key.trim()] = r.value;
      return updateMediaItem(item, { name, meta, requireSignedURLs });
    },
    onSuccess: () => {
      invalidate();
      notifications.show({ message: "Saved", color: "green" });
    },
    onError: () => notifications.show({ message: "Save failed", color: "red" }),
  });

  const del = useMutation({
    mutationFn: () => deleteMediaItem(item),
    onSuccess: () => {
      invalidate();
      setSelected(null);
      notifications.show({ message: "Deleted", color: "green" });
    },
    onError: () => notifications.show({ message: "Delete failed", color: "red" }),
  });

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: "Delete this item?",
      children: <Text size="sm">This permanently deletes “{item.name}” from Cloudflare. This cannot be undone.</Text>,
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => del.mutate(),
    });

  return (
    <Stack gap="sm">
      <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />

      <div>
        <Text size="sm" fw={600} mb={4}>
          Metadata
        </Text>
        <Stack gap="xs">
          {rows.map((r, i) => (
            <Group key={i} gap="xs" wrap="nowrap">
              <TextInput
                placeholder="key"
                value={r.key}
                onChange={(e) =>
                  setRows((rs) => rs.map((x, j) => (j === i ? { ...x, key: e.currentTarget.value } : x)))
                }
                w={140}
              />
              <TextInput
                placeholder="value"
                value={r.value}
                onChange={(e) =>
                  setRows((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)))
                }
                style={{ flex: 1 }}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label="Remove"
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}
          <Button
            variant="subtle"
            size="xs"
            leftSection={<IconPlus size={14} />}
            onClick={() => setRows((rs) => [...rs, { key: "", value: "" }])}
            style={{ alignSelf: "flex-start" }}
          >
            Add field
          </Button>
        </Stack>
      </div>

      <Switch
        label="Require signed URLs"
        checked={requireSignedURLs}
        onChange={(e) => setRequireSignedURLs(e.currentTarget.checked)}
      />

      <Group justify="space-between" mt="xs">
        <Button color="red" variant="light" onClick={confirmDelete} loading={del.isPending}>
          Delete
        </Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save changes
        </Button>
      </Group>
    </Stack>
  );
}
```

- [ ] **Step 2: Render it in the drawer** — in `src/components/MediaDetailDrawer.tsx`:

(a) Add the import after the existing imports:
```ts
import { MediaEditPanel } from "@/components/MediaEditPanel";
```

(b) In `ImageDetail`, replace `<MetaTable meta={item.meta} />` with:
```tsx
      <MediaEditPanel item={item} />
```

(c) In `VideoDetail`, replace `<MetaTable meta={item.meta} />` with:
```tsx
      <MediaEditPanel item={item} />
```

(d) If `MetaTable` is now unused, delete its function definition and any now-unused imports (`Table`) — run `npm run check` and let oxlint flag them, or remove manually.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/MediaEditPanel.tsx src/components/MediaDetailDrawer.tsx
git commit -m "feat(client): inline edit (name/metadata/signed/delete) in detail drawer"
```

---

## Task 6: Client — bulk delete from the table selection

**Files:**
- Modify: `src/features/Gallery.tsx`

- [ ] **Step 1: Add the bulk-delete control** — in `src/features/Gallery.tsx`:

(a) Add/extend imports: ensure `Button` is imported from `@mantine/core`, and add:
```ts
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { deleteMediaItem } from "@/lib/media";
```
(`Button` joins the existing `@mantine/core` import; `useQuery`/`useMemo` are already imported.)

(b) Inside the `Gallery` component, after the existing store selectors, add:
```ts
  const selectedIds = useUIStore((s) => s.selectedIds);
  const setSelectedIds = useUIStore((s) => s.setSelectedIds);
  const queryClient = useQueryClient();
  const selectedItems = useMemo(
    () => items.filter((i) => selectedIds[`${i.kind}-${i.id}`]),
    [items, selectedIds],
  );

  const bulkDelete = () =>
    modals.openConfirmModal({
      title: `Delete ${selectedItems.length} item(s)?`,
      children: <Text size="sm">This permanently deletes the selected media from Cloudflare. This cannot be undone.</Text>,
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        const results = await Promise.allSettled(selectedItems.map((i) => deleteMediaItem(i)));
        const failed = results.filter((r) => r.status === "rejected").length;
        setSelectedIds({});
        queryClient.invalidateQueries({ queryKey: ["media"] });
        notifications.show({
          message:
            failed === 0
              ? `Deleted ${results.length} item(s)`
              : `Deleted ${results.length - failed} of ${results.length} (${failed} failed)`,
          color: failed === 0 ? "green" : "orange",
        });
      },
    });
```

(c) In the controls `Group` (the row with the `SegmentedControl` + filter/sort `Select`s), add a bulk-delete button that only shows when rows are selected. Place it as the first child of the left side — wrap the existing `SegmentedControl` and the button in a `Group`:
```tsx
        <Group gap="sm">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as "grid" | "table")}
            data={[
              { value: "grid", label: "Grid" },
              { value: "table", label: "Table" },
            ]}
          />
          {selectedItems.length > 0 && (
            <Button color="red" variant="light" onClick={bulkDelete}>
              Delete selected ({selectedItems.length})
            </Button>
          )}
        </Group>
```
(Replace the existing standalone `<SegmentedControl ... />` element with this `Group`.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/Gallery.tsx
git commit -m "feat(client): bulk delete selected rows from the table"
```

---

## Task 7: Verify, changelog, deploy-ready

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full local verification**

Run:
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: oxlint/Prettier clean, types pass, all Vitest tests pass (existing + new), client+SSR build succeeds.

- [ ] **Step 2: Manual pass** (`npm run dev`, with `.dev.vars` `DEV_BYPASS_ACCESS=1`; connect a token if local D1 is empty, or test against the deployed site after merge):
1. Open an image → drawer → change Name → Save → name updates in grid/table/drawer.
2. Add a metadata field → Save → persists (reopen shows it).
3. Toggle "Require signed URLs" → Save → no error.
4. Delete a single item → confirm → it disappears from the gallery.
5. Switch to Table, select 2–3 rows → "Delete selected (N)" → confirm → they disappear and selection clears.

- [ ] **Step 3: Add a CHANGELOG entry** — under `## [Unreleased]` → `### Added` in `CHANGELOG.md`:
```markdown
- **Manage & metadata (editing phase):** rename, edit metadata key/values, toggle require-signed-URLs, and delete images + videos inline from the detail drawer; bulk-delete selected rows from the table. New Worker endpoints `PATCH`/`DELETE` for `/api/images/:id` and `/api/stream/:uid`. Image "rename" sets a `meta.name` display name (the Cloudflare filename is immutable).
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for manage & metadata"
```

---

## Self-Review

**Spec coverage:**
- Per-item rename/metadata/signed/delete (images + videos) → Tasks 1, 2 (worker), 3 (helpers), 5 (drawer UI). ✓
- Bulk delete via table selection → Tasks 4 (store-lifted selection), 6 (Gallery action). ✓
- Worker `PATCH`/`DELETE` for images + stream; `409` when not connected; metadata composition → Tasks 1, 2 with tests. ✓
- Image display-name = `meta.name ?? filename` → Task 3 (b). ✓
- Confirm modals + notifications + query invalidation → Tasks 5, 6. ✓
- Tests (worker) + typecheck/manual (client) → Tasks 1–2 (Vitest), 3–6 (typecheck), 7 (full + manual). ✓

**Placeholder scan:** none — every step has complete code/commands.

**Type consistency:** `MediaPatch` (`{name?, meta?, requireSignedURLs?}`) defined in Task 3 and consumed by `updateMediaItem` (Task 3) and the drawer (Task 5). `selectedIds: Record<string, boolean>` + `setSelectedIds` defined in Task 4, consumed by `MediaTable` (Task 4) and `Gallery` (Task 6). Row id key `` `${kind}-${id}` `` matches the table's existing `getRowId: (r) => \`${r.kind}-${r.id}\``. Worker handlers return `ImageItem`/`StreamItem` (via existing `toImageItem`/`toStreamItem`) and `{ ok: true }`, matching the client fetcher return types.
