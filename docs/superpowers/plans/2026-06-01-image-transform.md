# Image Transform Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-drawer image transform builder (Cloudflare flexible variants) with live preview, copy-URL, and download — plus HEIC upload support.

**Architecture:** Public images only (flexible variants are unavailable for signed images). The client builds the delivery URL itself (`imagedelivery.net/<hash>/<id>/<options>`) for an instant preview; the worker only proxies the download and enables flexible variants. Signed images get a notice.

**Tech Stack:** Hono + Cloudflare Images, Mantine inputs, TanStack Query, Vitest.

**Conventions:** License header `/* AGPL-3.0-or-later */` on new files. `npm run check` (oxlint + Prettier). Worker + pure client logic are TDD with Vitest. Single worker test: `npm run test -- <name>`.

**Verified against current Cloudflare docs:** enable endpoint `PATCH /accounts/{id}/images/v1/config {"flexible_variants":true}`; transform URL form `…/<hash>/<id>/w=400,sharpen=3`; flexible variants **cannot** be used for images requiring signed URLs; HEIC is a supported input format.

---

## File Structure
- `src/lib/upload.ts` — HEIC detection + routing (Task 1).
- `src/components/UploadModal.tsx` — accept HEIC (Task 1).
- `src/lib/transform.ts` — NEW; `TransformOptions`, `buildOptionsString`, `parseAccountHash`, `buildDeliveryUrl` (Task 2).
- `src/lib/transform.test.ts` — NEW (Task 2).
- `worker/src/lib/connection-store.ts` — `setFlexibleVariants` setter (Task 3).
- `worker/src/services/connection.ts` — `setFlexibleVariants` on the service (Task 3).
- `worker/src/routes/images.ts` — `GET /:id/transform-download`, `POST /flexible-variants` (Task 3).
- `worker/src/routes/images.test.ts` — tests (Task 3).
- `src/lib/cf-api.ts` — `transformDownloadUrl`, `enableFlexibleVariants` (Task 4).
- `src/components/ImageTransformPanel.tsx` — NEW (Task 5).
- `src/components/MediaDetailDrawer.tsx` — render the panel (Task 5).

---

## Task 1: HEIC upload support

**Files:**
- Modify: `src/lib/upload.ts`, `src/components/UploadModal.tsx`

- [ ] **Step 1: Detect + route HEIC in `src/lib/upload.ts`**

(a) Add near the top (after imports):
```ts
// Browsers often report an empty MIME type for HEIC/HEIF; match by extension.
const HEIC_RE = /\.hei[cf]s?$/i;
export function isHeic(file: File): boolean {
  return file.type === "image/heic" || file.type === "image/heif" || HEIC_RE.test(file.name);
}
```
(b) In `isUploadable`, add HEIC:
```ts
export function isUploadable(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    file.type.startsWith("video/") ||
    file.type.startsWith("audio/") ||
    isHeic(file)
  );
}
```
(c) In `uploadFile`, route HEIC to the image path. Change the image branch (which currently reads `if (file.type.startsWith("image/"))`) to:
```ts
  if (file.type.startsWith("image/") || isHeic(file)) {
    return uploadImage(file, requireSignedURLs, onProgress);
  }
```
(The existing 0-byte guard above it still runs first; HEIC photos are non-empty.)

- [ ] **Step 2: Accept HEIC in the dropzone — `src/components/UploadModal.tsx`**

Replace the `accept={[...IMAGE_MIME_TYPE, ...VIDEO_MIME, ...AUDIO_MIME]}` prop with a record form so empty-MIME `.heic` files match by extension. Add this constant next to `AUDIO_MIME`:
```ts
// react-dropzone Accept record. Extension entries (e.g. ".heic") let files
// with an empty MIME type (common for HEIC) match by filename.
const ACCEPT: Record<string, string[]> = {
  ...Object.fromEntries(IMAGE_MIME_TYPE.map((m) => [m, [] as string[]])),
  "image/heic": [".heic", ".heics"],
  "image/heif": [".heif", ".heifs"],
  ...Object.fromEntries(VIDEO_MIME.map((m) => [m, [] as string[]])),
  ...Object.fromEntries(AUDIO_MIME.map((m) => [m, [] as string[]])),
};
```
and change the Dropzone:
```tsx
        <Dropzone onDrop={onDrop} accept={ACCEPT} loading={busy}>
```
Update the dropzone label text:
```tsx
            <Text>Drag images (incl. HEIC), videos, or audio here, or click to choose</Text>
```

- [ ] **Step 3: Verify:** `npm run typecheck` (clean), `npx oxlint src/lib/upload.ts src/components/UploadModal.tsx` (no new errors), `npm run build` (green).

- [ ] **Step 4: Commit**
```bash
git add src/lib/upload.ts src/components/UploadModal.tsx
git commit -m "feat(upload): accept HEIC/HEIF images"
```

---

## Task 2: Transform options library (pure, TDD)

**Files:**
- Create: `src/lib/transform.ts`, `src/lib/transform.test.ts`

- [ ] **Step 1: Write failing tests** — `src/lib/transform.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { buildDeliveryUrl, buildOptionsString, parseAccountHash } from "@/lib/transform";

describe("buildOptionsString", () => {
  it("returns empty string when nothing is set", () => {
    expect(buildOptionsString({})).toBe("");
  });
  it("emits set keys in a stable order", () => {
    expect(buildOptionsString({ width: 800, height: 600, fit: "cover", quality: 80, format: "auto" })).toBe(
      "width=800,height=600,fit=cover,format=auto,quality=80",
    );
  });
  it("url-encodes background and formats booleans + decimals", () => {
    expect(buildOptionsString({ background: "#ffffff", anim: false, brightness: 1.2 })).toBe(
      "background=%23ffffff,brightness=1.2,anim=false",
    );
  });
});

describe("parseAccountHash", () => {
  it("extracts the hash from a delivery URL", () => {
    expect(parseAccountHash("https://imagedelivery.net/ABC123/img-1/public")).toBe("ABC123");
  });
  it("returns null for a non-delivery URL", () => {
    expect(parseAccountHash("https://example.com/x")).toBeNull();
  });
});

describe("buildDeliveryUrl", () => {
  it("omits the options segment when empty", () => {
    expect(buildDeliveryUrl("ABC", "img1", "")).toBe("https://imagedelivery.net/ABC/img1");
  });
  it("appends options when present", () => {
    expect(buildDeliveryUrl("ABC", "img1", "width=800,fit=cover")).toBe(
      "https://imagedelivery.net/ABC/img1/width=800,fit=cover",
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- lib/transform` (module not found).

- [ ] **Step 3: Implement** — `src/lib/transform.ts`:
```ts
/* AGPL-3.0-or-later */
export type Fit = "scale-down" | "contain" | "cover" | "crop" | "pad";
export type Format = "auto" | "webp" | "avif" | "jpeg" | "png";
export type Metadata = "keep" | "copyright" | "none";

export type TransformOptions = {
  width?: number;
  height?: number;
  fit?: Fit;
  gravity?: string;
  dpr?: number;
  trim?: string;
  background?: string; // hex like #ffffff
  rotate?: 90 | 180 | 270;
  blur?: number;
  sharpen?: number;
  brightness?: number;
  contrast?: number;
  gamma?: number;
  format?: Format;
  quality?: number;
  metadata?: Metadata;
  anim?: boolean;
  compression?: "fast";
};

// Comma-separated flexible-variant options, only for keys that are set.
export function buildOptionsString(o: TransformOptions): string {
  const parts: string[] = [];
  const add = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === "") return;
    parts.push(`${k}=${v}`);
  };
  add("width", o.width);
  add("height", o.height);
  add("fit", o.fit);
  add("gravity", o.gravity);
  add("dpr", o.dpr);
  add("trim", o.trim);
  if (o.background) parts.push(`background=${encodeURIComponent(o.background)}`);
  add("rotate", o.rotate);
  add("blur", o.blur);
  add("sharpen", o.sharpen);
  add("brightness", o.brightness);
  add("contrast", o.contrast);
  add("gamma", o.gamma);
  add("format", o.format);
  add("quality", o.quality);
  add("metadata", o.metadata);
  if (o.anim !== undefined) parts.push(`anim=${o.anim}`);
  add("compression", o.compression);
  return parts.join(",");
}

export function parseAccountHash(deliveryUrl: string): string | null {
  return deliveryUrl.match(/imagedelivery\.net\/([^/]+)\//)?.[1] ?? null;
}

export function buildDeliveryUrl(accountHash: string, imageId: string, options: string): string {
  const base = `https://imagedelivery.net/${accountHash}/${imageId}`;
  return options ? `${base}/${options}` : base;
}
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- lib/transform`. Then `npx oxlint src/lib/transform.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/transform.ts src/lib/transform.test.ts
git commit -m "feat(transform): flexible-variant options builder (pure, tested)"
```

---

## Task 3: Worker — transform-download + flexible-variants enable

**Files:**
- Modify: `worker/src/lib/connection-store.ts`, `worker/src/services/connection.ts`, `worker/src/routes/images.ts`, `worker/src/routes/images.test.ts`

- [ ] **Step 1: Add the store setter** — `worker/src/lib/connection-store.ts`:

(a) In the `ConnectionStore` interface, after `patchDiscovered(...)`:
```ts
  setFlexibleVariants(enabled: boolean): Promise<void>;
```
(b) In `d1ConnectionStore`, after the `patchDiscovered` method:
```ts
    async setFlexibleVariants(enabled) {
      await db
        .update(cfConnection)
        .set({ flexibleVariantsEnabled: enabled, updatedAt: new Date() })
        .where(eq(cfConnection.id, 1));
    },
```
(c) In `inMemoryConnectionStore`, after its `patchDiscovered`:
```ts
    async setFlexibleVariants(enabled) {
      if (row) row.flexibleVariantsEnabled = enabled;
    },
```

- [ ] **Step 2: Add the service method** — `worker/src/services/connection.ts`:

(a) In the `ConnectionService` interface, after `credentials(): ...`:
```ts
  setFlexibleVariants(enabled: boolean): Promise<void>;
```
(b) In `createConnectionService`'s returned object (alongside `getStatus`, `connect`, etc.):
```ts
    async setFlexibleVariants(enabled: boolean) {
      await store.setFlexibleVariants(enabled);
    },
```

- [ ] **Step 3: Write failing tests** — append inside the `describe("imagesRoute", ...)` block in `worker/src/routes/images.test.ts`:
```ts
  it("GET /:id/transform-download streams the transformed image as an attachment", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/webp" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request(
      "/api/images/img1/transform-download?o=width%3D800%2Cfit%3Dcover&name=img1.webp",
    );
    expect(res.status).toBe(200);
    const [url] = fetchMock.mock.calls[0]! as unknown as [string];
    expect(url).toBe("https://imagedelivery.net/HASH/img1/width=800,fit=cover");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="img1.webp"');
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("GET /:id/transform-download returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/img1/transform-download?o=");
    expect(res.status).toBe(409);
  });

  it("GET /:id/transform-download returns 502 when the upstream fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const res = await app(connectedService).request("/api/images/img1/transform-download?o=width%3D800");
    expect(res.status).toBe(502);
  });

  it("POST /flexible-variants enables via the CF config endpoint and returns status", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const setFlex = vi.fn(async () => {});
    const svc = {
      credentials: async () => creds,
      setFlexibleVariants: setFlex,
      getStatus: async () => ({ connected: true, accountId: "acc1", flexibleVariantsEnabled: true }),
    } as unknown as ConnectionService;
    const res = await app(svc).request("/api/images/flexible-variants", { method: "POST" });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/config");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ flexible_variants: true });
    expect(setFlex).toHaveBeenCalledWith(true);
    expect(await res.json()).toEqual({ connected: true, accountId: "acc1", flexibleVariantsEnabled: true });
  });

  it("POST /flexible-variants returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/flexible-variants", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 4: Run, expect FAIL:** `npm run test -- routes/images`.

- [ ] **Step 5: Implement** — in `worker/src/routes/images.ts`, add both handlers immediately before `return app;`:
```ts
  app.get("/:id/transform-download", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds || !creds.accountHash) return c.json({ error: "Not connected" }, 409);
    const id = c.req.param("id");
    const options = c.req.query("o") ?? "";
    const name = c.req.query("name") || id;
    const base = `https://imagedelivery.net/${creds.accountHash}/${id}`;
    const url = options ? `${base}/${options}` : `${base}/public`;
    const res = await fetch(url);
    if (!res.ok || !res.body) return c.json({ error: "Failed to fetch image" }, 502);
    return new Response(res.body, {
      status: 200,
      headers: {
        "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  });

  app.post("/flexible-variants", async (c) => {
    const svc = makeService(c.env);
    const creds = await svc.credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    try {
      await cfJson(creds, "/images/v1/config", {
        method: "PATCH",
        body: JSON.stringify({ flexible_variants: true }),
      });
    } catch {
      return c.json({ error: "Failed to enable flexible variants" }, 502);
    }
    await svc.setFlexibleVariants(true);
    return c.json(await svc.getStatus());
  });
```
(`cfJson` is already imported in this file; `ConnectionService` is imported in the test file — if not, add `import type { ConnectionService } from "../services/connection";` to `images.test.ts`.)

- [ ] **Step 6: Run, expect PASS:** `npm run test -- routes/images` and `npm run test -- connection` (store/service still pass). Then `npx oxlint worker/src/routes/images.ts worker/src/lib/connection-store.ts worker/src/services/connection.ts`. `npm run typecheck`.

- [ ] **Step 7: Commit**
```bash
git add worker/src/lib/connection-store.ts worker/src/services/connection.ts worker/src/routes/images.ts worker/src/routes/images.test.ts
git commit -m "feat(worker): image transform-download proxy + enable flexible variants"
```

---

## Task 4: Client API fetchers

**Files:**
- Modify: `src/lib/cf-api.ts`

- [ ] **Step 1: Add fetchers** — append to `src/lib/cf-api.ts`:
```ts
export const transformDownloadUrl = (id: string, options: string, name: string): string => {
  const q = new URLSearchParams({ o: options, name }).toString();
  return `/api/images/${encodeURIComponent(id)}/transform-download?${q}`;
};

export const enableFlexibleVariants = () =>
  fetchJson<ConnectionStatus>("/api/images/flexible-variants", { method: "POST" });
```
(`ConnectionStatus` is already exported from this file.)

- [ ] **Step 2: Verify:** `npm run typecheck` (clean), `npx oxlint src/lib/cf-api.ts`.

- [ ] **Step 3: Commit**
```bash
git add src/lib/cf-api.ts
git commit -m "feat(client): transform-download + enable-flexible-variants fetchers"
```

---

## Task 5: ImageTransformPanel + drawer wiring

**Files:**
- Create: `src/components/ImageTransformPanel.tsx`
- Modify: `src/components/MediaDetailDrawer.tsx`

- [ ] **Step 1: Create `src/components/ImageTransformPanel.tsx`**
```tsx
/* AGPL-3.0-or-later */
import {
  Accordion,
  Alert,
  Button,
  ColorInput,
  CopyButton,
  Group,
  Image,
  NumberInput,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCopy, IconDownload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { enableFlexibleVariants, getSettings, transformDownloadUrl } from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";
import {
  buildDeliveryUrl,
  buildOptionsString,
  parseAccountHash,
  type TransformOptions,
} from "@/lib/transform";

const FIT = ["scale-down", "contain", "cover", "crop", "pad"];
const FORMAT = ["auto", "webp", "avif", "jpeg", "png"];
const META = ["keep", "copyright", "none"];
const GRAVITY = ["auto", "left", "right", "top", "bottom"];

export function ImageTransformPanel({ item }: { item: MediaItem }) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const queryClient = useQueryClient();
  const [opts, setOpts] = useState<TransformOptions>({});
  const [debounced] = useDebouncedValue(opts, 350);
  const [failed, setFailed] = useState(false);

  const enable = useMutation({
    mutationFn: enableFlexibleVariants,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
    onError: () => notifications.show({ message: "Could not enable flexible variants", color: "red" }),
  });

  const hash = useMemo(
    () => parseAccountHash(item.thumbnailUrl || item.variants[0] || ""),
    [item.thumbnailUrl, item.variants],
  );
  const optionsStr = useMemo(() => buildOptionsString(debounced), [debounced]);
  const previewUrl = hash ? buildDeliveryUrl(hash, item.id, optionsStr) : "";
  const set = (patch: Partial<TransformOptions>) => setOpts((o) => ({ ...o, ...patch }));

  if (item.requireSignedURLs) {
    return (
      <Alert color="yellow" title="Transforms unavailable">
        Flexible-variant transforms can't be used on images that require signed URLs. Turn off
        “Require signed URLs” above, or use a named variant.
      </Alert>
    );
  }
  if (!settings.data?.flexibleVariantsEnabled) {
    return (
      <Alert color="blue" title="Flexible variants are off">
        <Stack gap="xs">
          <Text size="sm">Enable flexible variants to transform images on the fly.</Text>
          <Button size="xs" loading={enable.isPending} onClick={() => enable.mutate()}>
            Enable flexible variants
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (!hash) {
    return (
      <Alert color="yellow">Couldn't determine the account hash for this image.</Alert>
    );
  }

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        Transform
      </Text>
      {previewUrl && (
        <Image
          src={previewUrl}
          alt={item.name}
          radius="md"
          onLoad={() => setFailed(false)}
          onError={() => setFailed(true)}
        />
      )}
      {failed && (
        <Text size="xs" c="red">
          Couldn't render — check the options.
        </Text>
      )}
      <Accordion multiple defaultValue={["size"]} variant="contained">
        <Accordion.Item value="size">
          <Accordion.Control>Size &amp; fit</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Group grow>
                <NumberInput label="Width" min={1} value={opts.width} onChange={(v) => set({ width: typeof v === "number" ? v : undefined })} />
                <NumberInput label="Height" min={1} value={opts.height} onChange={(v) => set({ height: typeof v === "number" ? v : undefined })} />
              </Group>
              <Select label="Fit" data={FIT} clearable value={opts.fit ?? null} onChange={(v) => set({ fit: (v as TransformOptions["fit"]) ?? undefined })} />
              <Select label="Gravity" data={GRAVITY} clearable value={opts.gravity ?? null} onChange={(v) => set({ gravity: v ?? undefined })} />
              <NumberInput label="DPR" min={1} max={3} value={opts.dpr} onChange={(v) => set({ dpr: typeof v === "number" ? v : undefined })} />
              <ColorInput label="Background (for pad)" format="hex" value={opts.background ?? ""} onChange={(v) => set({ background: v || undefined })} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="adjust">
          <Accordion.Control>Adjust</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Select label="Rotate" data={["90", "180", "270"]} clearable value={opts.rotate ? String(opts.rotate) : null} onChange={(v) => set({ rotate: v ? (Number(v) as 90 | 180 | 270) : undefined })} />
              <Text size="xs">Blur</Text>
              <Slider min={0} max={250} value={opts.blur ?? 0} onChange={(v) => set({ blur: v || undefined })} />
              <Text size="xs">Sharpen</Text>
              <Slider min={0} max={10} step={0.5} value={opts.sharpen ?? 0} onChange={(v) => set({ sharpen: v || undefined })} />
              <NumberInput label="Brightness" step={0.1} value={opts.brightness} onChange={(v) => set({ brightness: typeof v === "number" ? v : undefined })} />
              <NumberInput label="Contrast" step={0.1} value={opts.contrast} onChange={(v) => set({ contrast: typeof v === "number" ? v : undefined })} />
              <NumberInput label="Gamma" step={0.1} value={opts.gamma} onChange={(v) => set({ gamma: typeof v === "number" ? v : undefined })} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="output">
          <Accordion.Control>Output</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Select label="Format" data={FORMAT} clearable value={opts.format ?? null} onChange={(v) => set({ format: (v as TransformOptions["format"]) ?? undefined })} />
              <NumberInput label="Quality" min={1} max={100} value={opts.quality} onChange={(v) => set({ quality: typeof v === "number" ? v : undefined })} />
              <Select label="Metadata" data={META} clearable value={opts.metadata ?? null} onChange={(v) => set({ metadata: (v as TransformOptions["metadata"]) ?? undefined })} />
              <Switch label="Keep animation (anim)" checked={opts.anim ?? true} onChange={(e) => set({ anim: e.currentTarget.checked ? undefined : false })} />
              <Switch label="Fast compression" checked={opts.compression === "fast"} onChange={(e) => set({ compression: e.currentTarget.checked ? "fast" : undefined })} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      {optionsStr && (
        <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
          {optionsStr}
        </Text>
      )}
      <Group>
        <CopyButton value={previewUrl} timeout={1500}>
          {({ copied, copy }) => (
            <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={copy}>
              {copied ? "Copied!" : "Copy URL"}
            </Button>
          )}
        </CopyButton>
        <Button
          size="xs"
          variant="light"
          component="a"
          href={transformDownloadUrl(item.id, optionsStr, `${item.name || item.id}`)}
          leftSection={<IconDownload size={14} />}
        >
          Download
        </Button>
      </Group>
    </Stack>
  );
}
```

- [ ] **Step 2: Render it in the drawer** — `src/components/MediaDetailDrawer.tsx`:

(a) Add import:
```ts
import { ImageTransformPanel } from "@/components/ImageTransformPanel";
```
(b) In `ImageDetail`, render `<ImageTransformPanel item={item} />` after the variants `SimpleGrid` block (the last element inside the `ImageDetail` `<Stack>`).

- [ ] **Step 3: Verify:** `npm run typecheck` (clean), `npx oxlint src/components/ImageTransformPanel.tsx src/components/MediaDetailDrawer.tsx`, `npm run build` (green). If any Mantine prop types mismatch (e.g. `NumberInput onChange` value is `number | string`), adjust minimally to satisfy types (the guards above already coerce).

- [ ] **Step 4: Commit**
```bash
git add src/components/ImageTransformPanel.tsx src/components/MediaDetailDrawer.tsx
git commit -m "feat(client): in-drawer image transform builder (live preview, copy, download)"
```

---

## Task 6: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full verification**
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: oxlint/Prettier clean (pre-existing warnings only), types pass, all Vitest tests pass (existing + transform + worker), client + SSR build green. If `npm run check` reformats files, include them in the commit.

- [ ] **Step 2: Manual pass** (deployed, Access-gated):
1. Open a **public** image → expand Transform → set width/fit/quality/format → preview updates (~350 ms debounce).
2. Copy URL → paste in a new tab → the transformed image loads.
3. Download → the transformed file saves.
4. Open a **signed** image → see the "transforms unavailable" notice (no broken preview).
5. If the account had flexible variants off → the Enable button appears; click → controls appear.
6. Upload a `.heic` photo → it appears in the gallery (served as a web format).

- [ ] **Step 3: CHANGELOG** — under `## [Unreleased]` → `### Added`:
```markdown
- **Image transform builder (editing phase, sub-project A):** an in-drawer tool to transform public images on the fly via Cloudflare flexible variants — width/height/fit/gravity/dpr/trim/background, rotate/blur/sharpen/brightness/contrast/gamma, and format/quality/metadata/anim/compression — with a live debounced preview, copy-URL, and a worker-proxied download. One-click "Enable flexible variants" (`PATCH /images/v1/config`) when off; signed images show a notice (flexible variants don't apply to them). Also: the upload modal now accepts **HEIC/HEIF** images (Cloudflare ingests them and serves web formats).
```

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: changelog for image transform builder + HEIC upload"
```

---

## Self-Review

**Spec coverage:** flexible-variant transforms (public only) → Tasks 2/5; live preview client-built URL → Task 5; copy + worker-proxied download → Tasks 3/4/5; one-click enable (`PATCH images/v1/config` + persisted flag) → Task 3; signed-image notice → Task 5; full "Everything" control set grouped in an Accordion → Task 5; HEIC upload → Task 1; tests → Tasks 2/3 + manual. ✓

**Placeholder scan:** none — complete code/commands throughout. The one runtime-typing caveat (Mantine `NumberInput`/`Select` onChange union types) is handled by explicit coercion in the component, with a fix note in Task 5 Step 3.

**Type consistency:** `TransformOptions`/`buildOptionsString`/`buildDeliveryUrl`/`parseAccountHash` defined in Task 2 and consumed in Task 5. `transformDownloadUrl(id, options, name)` and `enableFlexibleVariants()` defined in Task 4, used in Task 5; their worker counterparts (`GET /:id/transform-download?o=&name=`, `POST /flexible-variants`) defined in Task 3 with matching shapes. `setFlexibleVariants` added to the store interface, both store impls, and the service (Task 3). `isHeic`/`isUploadable`/`uploadFile` (Task 1) self-consistent.
