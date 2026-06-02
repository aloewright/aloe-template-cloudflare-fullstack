# Image Variant Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage account-level Cloudflare Images variants (list/create/edit/delete) from a Variants section on the Settings page.

**Architecture:** Worker endpoints proxy Cloudflare's `/images/v1/variants` API; the existing `GET /api/images/variants` is widened to return full variant defs. A `VariantManager` component in Settings does CRUD, with global-effect confirms on edit/delete.

**Tech Stack:** Hono + Cloudflare Images, Mantine (`Table`/`Select`/`NumberInput`/`Switch`), `@mantine/modals`, TanStack Query, Vitest.

**Conventions:** License header `/* AGPL-3.0-or-later */` on new files. `npm run check` (oxlint + Prettier). Worker logic TDD with Vitest. Single worker test: `npm run test -- <name>`.

**Verified against Cloudflare docs:** list `GET /images/v1/variants`; create `POST /images/v1/variants` `{id, options:{fit,metadata,width,height}, neverRequireSignedURLs}`; edit `PATCH /images/v1/variants/{name}` `{options, neverRequireSignedURLs}`; delete `DELETE /images/v1/variants/{name}` (`public` can't be deleted). **Task 1 Step 6 re-confirms the PATCH body + the create `id` key.**

---

## File Structure
- `worker/src/routes/images.ts` — widen `GET /variants`; add `POST /variants`, `PATCH /variants/:name`, `DELETE /variants/:name`.
- `worker/src/routes/images.test.ts` — update the existing GET test + add tests.
- `src/lib/cf-api.ts` — rename `VariantDims`→`VariantDef` (+fields); `VariantInput`; `createVariant`/`updateVariant`/`deleteVariant`.
- `src/components/MediaDetailDrawer.tsx` — update the `VariantDims` import/usage.
- `src/components/VariantManager.tsx` — NEW.
- `src/features/Settings.tsx` — render `<VariantManager />` when connected.

---

## Task 1: Worker — variant CRUD

**Files:**
- Modify: `worker/src/routes/images.ts`, `worker/src/routes/images.test.ts`

- [ ] **Step 1: Update the existing GET test + add new tests** — in `worker/src/routes/images.test.ts`:

(a) Find the existing test that requests `/api/images/variants` and update its mock + assertion to the full-def shape. Replace that test with:
```ts
  it("GET /variants returns full variant defs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              variants: {
                thumbnail: {
                  options: { fit: "cover", metadata: "none", width: 100, height: 100 },
                  neverRequireSignedURLs: true,
                },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );
    const res = await app(connectedService).request("/api/images/variants");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      variants: {
        thumbnail: {
          fit: "cover",
          metadata: "none",
          width: 100,
          height: 100,
          neverRequireSignedURLs: true,
        },
      },
    });
  });
```
(b) Append inside the `describe("imagesRoute", ...)` block:
```ts
  it("POST /variants creates a variant", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request("/api/images/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "square",
        fit: "cover",
        width: 512,
        height: 512,
        metadata: "none",
        neverRequireSignedURLs: true,
      }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/variants");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      id: "square",
      options: { fit: "cover", metadata: "none", width: 512, height: 512 },
      neverRequireSignedURLs: true,
    });
  });

  it("POST /variants returns 400 for an invalid fit", async () => {
    const res = await app(connectedService).request("/api/images/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", fit: "bogus", metadata: "none" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /variants/:name edits a variant", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request("/api/images/variants/thumbnail", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fit: "contain", metadata: "keep" }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/variants/thumbnail",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      options: { fit: "contain", metadata: "keep" },
      neverRequireSignedURLs: false,
    });
  });

  it("DELETE /variants/public is rejected with 400", async () => {
    const res = await app(connectedService).request("/api/images/variants/public", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /variants/:name deletes a variant", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request("/api/images/variants/thumbnail", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/variants/thumbnail",
    );
    expect(init.method).toBe("DELETE");
  });

  it("variant write endpoints return 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- routes/images`.

- [ ] **Step 3: Implement** — in `worker/src/routes/images.ts`:

(a) Widen the `CfVariants` type:
```ts
type CfVariants = {
  variants?: Record<
    string,
    {
      options?: { width?: number; height?: number; fit?: string; metadata?: string };
      neverRequireSignedURLs?: boolean;
    }
  >;
};
```
(b) Add validation constants near the top of the route module (after `const DAY = ...` or similar):
```ts
const VARIANT_FIT = new Set(["scale-down", "contain", "cover", "crop", "pad"]);
const VARIANT_META = new Set(["keep", "copyright", "none"]);
const VARIANT_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
```
(c) Replace the body of the existing `GET /variants` handler so it returns full defs:
```ts
  app.get("/variants", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const res = await cfJson<CfVariants>(creds, "/images/v1/variants");
    const variants: Record<
      string,
      {
        fit: string | null;
        metadata: string | null;
        width: number | null;
        height: number | null;
        neverRequireSignedURLs: boolean;
      }
    > = {};
    for (const [name, def] of Object.entries(res.variants ?? {})) {
      variants[name] = {
        fit: def.options?.fit ?? null,
        metadata: def.options?.metadata ?? null,
        width: def.options?.width ?? null,
        height: def.options?.height ?? null,
        neverRequireSignedURLs: def.neverRequireSignedURLs ?? false,
      };
    }
    return c.json({ variants });
  });
```
(d) Add three handlers immediately before `return app;`:
```ts
  app.post("/variants", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{
        name?: string;
        fit?: string;
        width?: number;
        height?: number;
        metadata?: string;
        neverRequireSignedURLs?: boolean;
      }>()
      .catch(() => ({}) as Record<string, never>);
    const { name, fit, metadata } = body;
    if (!name || !VARIANT_NAME_RE.test(name) || !fit || !VARIANT_FIT.has(fit) || !metadata || !VARIANT_META.has(metadata)) {
      return c.json({ error: "Invalid variant" }, 400);
    }
    const options: Record<string, unknown> = { fit, metadata };
    if (typeof body.width === "number") options.width = body.width;
    if (typeof body.height === "number") options.height = body.height;
    try {
      await cfJson(creds, "/images/v1/variants", {
        method: "POST",
        body: JSON.stringify({ id: name, options, neverRequireSignedURLs: !!body.neverRequireSignedURLs }),
      });
    } catch {
      return c.json({ error: "Failed to create variant" }, 502);
    }
    return c.json({ ok: true });
  });

  app.patch("/variants/:name", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const name = c.req.param("name");
    if (!VARIANT_NAME_RE.test(name)) return c.json({ error: "Invalid variant name" }, 400);
    const body = await c.req
      .json<{ fit?: string; width?: number; height?: number; metadata?: string; neverRequireSignedURLs?: boolean }>()
      .catch(() => ({}) as Record<string, never>);
    const { fit, metadata } = body;
    if (!fit || !VARIANT_FIT.has(fit) || !metadata || !VARIANT_META.has(metadata)) {
      return c.json({ error: "Invalid variant" }, 400);
    }
    const options: Record<string, unknown> = { fit, metadata };
    if (typeof body.width === "number") options.width = body.width;
    if (typeof body.height === "number") options.height = body.height;
    try {
      await cfJson(creds, `/images/v1/variants/${name}`, {
        method: "PATCH",
        body: JSON.stringify({ options, neverRequireSignedURLs: !!body.neverRequireSignedURLs }),
      });
    } catch {
      return c.json({ error: "Failed to update variant" }, 502);
    }
    return c.json({ ok: true });
  });

  app.delete("/variants/:name", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const name = c.req.param("name");
    if (name === "public") return c.json({ error: "Cannot delete the public variant" }, 400);
    if (!VARIANT_NAME_RE.test(name)) return c.json({ error: "Invalid variant name" }, 400);
    try {
      await cfJson(creds, `/images/v1/variants/${name}`, { method: "DELETE" });
    } catch {
      return c.json({ error: "Failed to delete variant" }, 502);
    }
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- routes/images`. Then `npx oxlint worker/src/routes/images.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add worker/src/routes/images.ts worker/src/routes/images.test.ts
git commit -m "feat(worker): image variant CRUD + full variant defs"
```

- [ ] **Step 6: Verify PATCH body + create id key (docs check)**

Use `mcp__cloudflare__search_cloudflare_documentation` ("Cloudflare Images update variant API PATCH body options") and/or the API reference to confirm: (1) edit is `PATCH /images/v1/variants/{name}` with `{ options, neverRequireSignedURLs }`, and (2) create keys the name as `id` in the body. The create+delete docs already confirm `id`/delete-path. If PATCH differs (e.g. it also requires `id` in the body, or uses PUT), adjust the handler + the PATCH test, re-run `npm run test -- routes/images`, and commit `fix(worker): correct variant edit request`.

---

## Task 2: Client — fetchers + VariantDef rename

**Files:**
- Modify: `src/lib/cf-api.ts`, `src/components/MediaDetailDrawer.tsx`

- [ ] **Step 1: Update `src/lib/cf-api.ts`**

(a) Replace the `VariantDims` type + `getImageVariants` (currently `export type VariantDims = { width: number | null; height: number | null };` and the `getImageVariants` returning `Record<string, VariantDims>`) with:
```ts
export type VariantDef = {
  fit: string | null;
  metadata: string | null;
  width: number | null;
  height: number | null;
  neverRequireSignedURLs: boolean;
};
export const getImageVariants = () =>
  fetchJson<{ variants: Record<string, VariantDef> }>("/api/images/variants");

export type VariantInput = {
  name: string;
  fit: string;
  width?: number;
  height?: number;
  metadata: string;
  neverRequireSignedURLs?: boolean;
};
export const createVariant = (input: VariantInput) =>
  fetchJson<{ ok: true }>("/api/images/variants", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
export const updateVariant = (name: string, input: Omit<VariantInput, "name">) =>
  fetchJson<{ ok: true }>(`/api/images/variants/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
export const deleteVariant = (name: string) =>
  fetchJson<{ ok: true }>(`/api/images/variants/${encodeURIComponent(name)}`, { method: "DELETE" });
```

- [ ] **Step 2: Update `src/components/MediaDetailDrawer.tsx`**

Change the import `import { getImage, getImageVariants, type VariantDims } from "@/lib/cf-api";` → `type VariantDef`, and change the `dimsLabel` signature `function dimsLabel(d: VariantDims | undefined): string` → `function dimsLabel(d: VariantDef | undefined): string`. (Its body reads `d?.width`/`d?.height` — unchanged.)

- [ ] **Step 3: Verify:** `npm run typecheck` (clean — the rename must have no dangling `VariantDims`), `npx oxlint src/lib/cf-api.ts src/components/MediaDetailDrawer.tsx`.

- [ ] **Step 4: Commit**
```bash
git add src/lib/cf-api.ts src/components/MediaDetailDrawer.tsx
git commit -m "feat(client): variant CRUD fetchers + full VariantDef"
```

---

## Task 3: VariantManager + Settings wiring

**Files:**
- Create: `src/components/VariantManager.tsx`
- Modify: `src/features/Settings.tsx`

- [ ] **Step 1: Create `src/components/VariantManager.tsx`**
```tsx
/* AGPL-3.0-or-later */
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createVariant,
  deleteVariant,
  getImageVariants,
  updateVariant,
  type VariantDef,
  type VariantInput,
} from "@/lib/cf-api";

const FIT = ["scale-down", "contain", "cover", "crop", "pad"];
const META = ["keep", "copyright", "none"];
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

type FormState = {
  name: string;
  fit: string;
  width: number | undefined;
  height: number | undefined;
  metadata: string;
  neverRequireSignedURLs: boolean;
};
const EMPTY: FormState = {
  name: "",
  fit: "scale-down",
  width: undefined,
  height: undefined,
  metadata: "none",
  neverRequireSignedURLs: false,
};

export function VariantManager() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["imageVariants"], queryFn: getImageVariants });
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["imageVariants"] });
  const reset = () => {
    setForm({ ...EMPTY });
    setEditing(null);
  };
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: (v: VariantInput) => createVariant(v),
    onSuccess: () => {
      invalidate();
      reset();
      notifications.show({ message: "Variant created", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't create variant", color: "red" }),
  });
  const update = useMutation({
    mutationFn: (args: { name: string; input: Omit<VariantInput, "name"> }) =>
      updateVariant(args.name, args.input),
    onSuccess: () => {
      invalidate();
      reset();
      notifications.show({ message: "Variant updated", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't update variant", color: "red" }),
  });
  const del = useMutation({
    mutationFn: (name: string) => deleteVariant(name),
    onSuccess: () => {
      invalidate();
      notifications.show({ message: "Variant deleted", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't delete variant", color: "red" }),
  });

  const variants = q.data?.variants ?? {};
  const inputFromForm = (): Omit<VariantInput, "name"> => ({
    fit: form.fit,
    width: form.width,
    height: form.height,
    metadata: form.metadata,
    neverRequireSignedURLs: form.neverRequireSignedURLs,
  });

  const submit = () => {
    if (editing) {
      const name = editing;
      modals.openConfirmModal({
        title: `Update variant "${name}"?`,
        children: (
          <Text size="sm">This is a global change affecting every image that uses this variant.</Text>
        ),
        labels: { confirm: "Update", cancel: "Cancel" },
        onConfirm: () => update.mutate({ name, input: inputFromForm() }),
      });
    } else {
      create.mutate({ name: form.name, ...inputFromForm() });
    }
  };

  const startEdit = (name: string, def: VariantDef) => {
    setEditing(name);
    setForm({
      name,
      fit: def.fit ?? "scale-down",
      width: def.width ?? undefined,
      height: def.height ?? undefined,
      metadata: def.metadata ?? "none",
      neverRequireSignedURLs: def.neverRequireSignedURLs,
    });
  };

  const confirmDelete = (name: string) =>
    modals.openConfirmModal({
      title: `Delete variant "${name}"?`,
      children: (
        <Text size="sm">Deleting a variant is global and affects every image. This cannot be undone.</Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => del.mutate(name),
    });

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Image variants</Title>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Fit</Table.Th>
              <Table.Th>Size</Table.Th>
              <Table.Th>Metadata</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.entries(variants).map(([name, def]) => (
              <Table.Tr key={name}>
                <Table.Td>
                  <Group gap="xs">
                    {name}
                    {def.neverRequireSignedURLs && (
                      <Badge size="xs" color="green" variant="light">
                        public
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{def.fit ?? "—"}</Table.Td>
                <Table.Td>
                  {def.width || def.height ? `${def.width ?? "auto"}×${def.height ?? "auto"}` : "auto"}
                </Table.Td>
                <Table.Td>{def.metadata ?? "—"}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <ActionIcon variant="subtle" aria-label={`Edit ${name}`} onClick={() => startEdit(name, def)}>
                      <IconPencil size={16} />
                    </ActionIcon>
                    {name !== "public" && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Delete ${name}`}
                        onClick={() => confirmDelete(name)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Text size="sm" fw={600}>
          {editing ? `Edit "${editing}"` : "Create variant"}
        </Text>
        <Group grow>
          <TextInput
            label="Name"
            value={form.name}
            disabled={!!editing}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
          <Select
            label="Fit"
            data={FIT}
            value={form.fit}
            onChange={(v) => set({ fit: v ?? "scale-down" })}
            allowDeselect={false}
          />
        </Group>
        <Group grow>
          <NumberInput
            label="Width"
            min={1}
            value={form.width}
            onChange={(v) => set({ width: typeof v === "number" ? v : undefined })}
          />
          <NumberInput
            label="Height"
            min={1}
            value={form.height}
            onChange={(v) => set({ height: typeof v === "number" ? v : undefined })}
          />
          <Select
            label="Metadata"
            data={META}
            value={form.metadata}
            onChange={(v) => set({ metadata: v ?? "none" })}
            allowDeselect={false}
          />
        </Group>
        <Switch
          label="Always public (ignore signed URLs)"
          checked={form.neverRequireSignedURLs}
          onChange={(e) => set({ neverRequireSignedURLs: e.currentTarget.checked })}
        />
        <Group>
          <Button
            size="xs"
            loading={create.isPending || update.isPending}
            disabled={!editing && !NAME_RE.test(form.name)}
            onClick={submit}
          >
            {editing ? "Save changes" : "Create variant"}
          </Button>
          {editing && (
            <Button size="xs" variant="subtle" onClick={reset}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
```

- [ ] **Step 2: Wire into `src/features/Settings.tsx`**

(a) Add `import { VariantManager } from "@/components/VariantManager";`.
(b) Inside the outer `<Stack gap="lg">`, after the `<form>…</form>`, add:
```tsx
        {status.data?.connected && <VariantManager />}
```

- [ ] **Step 3: Verify:** `npm run typecheck` (clean). If a Mantine prop type mismatches (`NumberInput`/`Select`/`Switch` onChange, `Table` subcomponents), adjust minimally and report. Then `npx oxlint src/components/VariantManager.tsx src/features/Settings.tsx` and `npm run build` (green).

- [ ] **Step 4: Commit**
```bash
git add src/components/VariantManager.tsx src/features/Settings.tsx
git commit -m "feat(client): variant manager (CRUD) in Settings"
```

---

## Task 4: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full verification**
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: oxlint/Prettier clean (pre-existing warnings only; if `npm run check` reformats files, include them, but `git checkout worker-configuration.d.ts` to avoid generated-file churn), types pass, all Vitest tests pass (existing + new variant tests), client + SSR build green.

- [ ] **Step 2: Manual pass** (deployed, Access-gated):
1. Open **Settings** → "Image variants" lists the account's variants (including `public`, which has no Delete).
2. Create a `square` variant (cover, 512×512, metadata none, public on) → it appears.
3. Edit it (change fit) → confirm warns it's global → saved.
4. Delete it → confirm warns it's global → removed.
5. The new variant shows up in the image detail drawer's variant copy boxes (after a refetch).

- [ ] **Step 3: CHANGELOG** — under `## [Unreleased]` → `### Added`:
```markdown
- **Image variant management (editing phase, sub-project B):** a Variants section on the Settings page to manage account-level Cloudflare Images variants — list, create, edit, and delete (the `public` variant is protected). Variant changes are account-wide, so edits and deletes are gated by a confirm. New worker endpoints under `/api/images/variants` (the existing GET now returns full defs: fit, metadata, size, always-public).
```

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: changelog for image variant management"
```

---

## Self-Review

**Spec coverage:** list full defs (widened GET) → Task 1; create → Task 1 POST; edit → Task 1 PATCH (+ Step 6 docs re-verify); delete with `public` block → Task 1 DELETE; validation `400` + `409`/`502` → Task 1; `VariantDef` rename + fetchers → Task 2; `VariantManager` table + create/edit form + global-effect confirms + `public`-no-delete → Task 3; Settings wiring → Task 3; worker tests (incl. updating the existing GET test) → Task 1; manual → Task 4. ✓

**Placeholder scan:** none — complete code/commands. The PATCH-body/create-`id` uncertainties are handled by Task 1 Step 6 (verify-and-adjust).

**Type consistency:** `VariantDef` defined once in `cf-api.ts` (Task 2), consumed by `MediaDetailDrawer` (rename, Task 2) and `VariantManager` (Task 3). `VariantInput` (Task 2) matches the worker POST body (Task 1) and `createVariant`/`updateVariant` calls (Task 3). The worker GET return shape matches `getImageVariants`'s `Record<string, VariantDef>`. `FIT`/`META`/`NAME_RE` mirror the worker's `VARIANT_FIT`/`VARIANT_META`/`VARIANT_NAME_RE`.
