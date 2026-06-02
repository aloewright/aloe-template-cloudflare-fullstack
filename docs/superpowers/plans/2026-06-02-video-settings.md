# Thumbnail & Playback Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set a Stream video's poster-thumbnail timestamp (live-preview slider) and allowed embedding origins from the video detail drawer.

**Architecture:** Widen the existing `PATCH /api/stream/:uid` handler to also forward `thumbnailTimestampPct` + `allowedOrigins` to Cloudflare. Thread `allowedOrigins` through the worker `StreamItem` and the client `MediaItem`. A `VideoSettingsPanel` in `VideoDetail` edits both and refreshes the gallery.

**Tech Stack:** Hono + Cloudflare Stream, Mantine (`Slider`/`Textarea`/`Image`), TanStack Query, Vitest.

**Conventions:** License header `/* AGPL-3.0-or-later */` on new files. `npm run check` (oxlint + Prettier). Worker logic TDD with Vitest. Single worker test: `npm run test -- <name>`.

**Verified against Cloudflare docs:** `POST /stream/{uid}` accepts `{ thumbnailTimestampPct: 0.0–1.0 }`; the same edit endpoint takes `allowedOrigins` (camelCase array). **Task 1 Step 6 re-confirms the `allowedOrigins` field name.** Live preview uses `…/<uid>/thumbnails/thumbnail.jpg?time=<sec>s&height=240`.

---

## File Structure
- `worker/src/routes/stream.ts` — widen `PATCH /:uid`; add `allowedOrigins` to `CfVideo`/`StreamItem`/`toStreamItem`.
- `worker/src/routes/stream.test.ts` — tests.
- `src/lib/cf-api.ts` — `StreamItem.allowedOrigins`; `MediaPatch` thumbnail/origins fields.
- `src/lib/media.ts` — `MediaItem` thumbnail/origins fields + mapper updates.
- `src/components/VideoSettingsPanel.tsx` — NEW.
- `src/components/MediaDetailDrawer.tsx` — render the panel in `VideoDetail`.

---

## Task 1: Worker — widen the video edit handler

**Files:**
- Modify: `worker/src/routes/stream.ts`, `worker/src/routes/stream.test.ts`

- [ ] **Step 1: Append failing tests** — inside the `describe("streamRoute", ...)` block in `worker/src/routes/stream.test.ts`:
```ts
  it("PATCH /:uid forwards thumbnailTimestampPct", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, result: { uid: "vid1" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connected).request("/api/stream/vid1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thumbnailTimestampPct: 0.25 }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream/vid1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ thumbnailTimestampPct: 0.25 });
  });

  it("PATCH /:uid forwards trimmed allowedOrigins and surfaces them", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ success: true, result: { uid: "vid1", allowedOrigins: ["example.com"] } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connected).request("/api/stream/vid1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedOrigins: ["example.com", "  "] }),
    });
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ allowedOrigins: ["example.com"] });
    expect((await res.json()).allowedOrigins).toEqual(["example.com"]);
  });

  it("PATCH /:uid rejects an out-of-range thumbnailTimestampPct", async () => {
    const res = await app(connected).request("/api/stream/vid1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ thumbnailTimestampPct: 1.5 }),
    });
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- routes/stream`.

- [ ] **Step 3: Implement** — in `worker/src/routes/stream.ts`:

(a) `CfVideo`: add `allowedOrigins?: string[];`.
(b) `StreamItem`: add `allowedOrigins: string[];`.
(c) `toStreamItem`: add `allowedOrigins: v.allowedOrigins ?? [],` (alongside the other fields).
(d) Replace the `PATCH /:uid` handler body's `body` parse + validation/build section so it also handles the new fields. The full handler becomes:
```ts
  app.patch("/:uid", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{
        name?: string;
        meta?: Record<string, string>;
        requireSignedURLs?: boolean;
        thumbnailTimestampPct?: number;
        allowedOrigins?: string[];
      }>()
      .catch(() => ({}) as Record<string, never>);
    if (
      body.thumbnailTimestampPct !== undefined &&
      (typeof body.thumbnailTimestampPct !== "number" ||
        body.thumbnailTimestampPct < 0 ||
        body.thumbnailTimestampPct > 1)
    ) {
      return c.json({ error: "thumbnailTimestampPct must be between 0 and 1" }, 400);
    }
    const updateBody: Record<string, unknown> = {};
    // Only send meta when the caller provided some, so a requireSignedURLs-only
    // update never wipes existing video metadata.
    if (body.meta !== undefined || body.name !== undefined) {
      updateBody.meta = { ...body.meta, ...(body.name !== undefined ? { name: body.name } : {}) };
    }
    if (body.requireSignedURLs !== undefined) updateBody.requireSignedURLs = body.requireSignedURLs;
    if (body.thumbnailTimestampPct !== undefined) {
      updateBody.thumbnailTimestampPct = body.thumbnailTimestampPct;
    }
    if (Array.isArray(body.allowedOrigins)) {
      updateBody.allowedOrigins = body.allowedOrigins.map((o) => String(o).trim()).filter(Boolean);
    }
    const video = await cfJson<CfVideo>(creds, `/stream/${c.req.param("uid")}`, {
      method: "POST",
      body: JSON.stringify(updateBody),
    });
    const item = toStreamItem(video);
    await signStreamItems([item], creds);
    return c.json(item);
  });
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- routes/stream` (new + existing name/meta/signed tests pass). Then `npx oxlint worker/src/routes/stream.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add worker/src/routes/stream.ts worker/src/routes/stream.test.ts
git commit -m "feat(worker): video thumbnail-timestamp + allowed-origins edits"
```

- [ ] **Step 6: Verify `allowedOrigins` field (docs check)**

Use `mcp__cloudflare__search_cloudflare_documentation` ("Cloudflare Stream video allowedOrigins restrict embedding API") and/or the Stream API reference to confirm the edit endpoint field is `allowedOrigins` (camelCase, array of domain strings). If it differs, fix the handler + `CfVideo`/`StreamItem`/`toStreamItem` + the test, re-run `npm run test -- routes/stream`, and commit `fix(worker): correct allowedOrigins field`.

---

## Task 2: Client — thread the fields through the model

**Files:**
- Modify: `src/lib/cf-api.ts`, `src/lib/media.ts`

- [ ] **Step 1: `src/lib/cf-api.ts`**

(a) In `StreamItem`, add (after `thumbnailTimestampPct: number;`):
```ts
  allowedOrigins: string[];
```
(b) In `MediaPatch` (currently `{ name?; meta?; requireSignedURLs? }`), add:
```ts
  thumbnailTimestampPct?: number;
  allowedOrigins?: string[];
```

- [ ] **Step 2: `src/lib/media.ts`**

(a) In the `MediaItem` type, add (after the existing video-only fields like `iframeUrl`):
```ts
  thumbnailTimestampPct: number | null;
  allowedOrigins: string[];
```
(b) In `streamToMedia`, add:
```ts
    thumbnailTimestampPct: v.thumbnailTimestampPct,
    allowedOrigins: v.allowedOrigins,
```
(c) In `imageToMedia` AND `audioToMedia`, add:
```ts
    thumbnailTimestampPct: null,
    allowedOrigins: [],
```

- [ ] **Step 3: Verify:** `npm run typecheck` (clean — every `MediaItem` literal now has the two new fields), `npx oxlint src/lib/cf-api.ts src/lib/media.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/lib/cf-api.ts src/lib/media.ts
git commit -m "feat(client): thumbnailTimestampPct + allowedOrigins on the media model"
```

---

## Task 3: VideoSettingsPanel + drawer wiring

**Files:**
- Create: `src/components/VideoSettingsPanel.tsx`
- Modify: `src/components/MediaDetailDrawer.tsx`

- [ ] **Step 1: Create `src/components/VideoSettingsPanel.tsx`**
```tsx
/* AGPL-3.0-or-later */
import { Button, Image, Slider, Stack, Text, Textarea } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { updateStream } from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";

export function VideoSettingsPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const [pct, setPct] = useState(Math.round((item.thumbnailTimestampPct ?? 0) * 100));
  const [origins, setOrigins] = useState(item.allowedOrigins.join("\n"));
  const [debouncedPct] = useDebouncedValue(pct, 300);
  const [previewFailed, setPreviewFailed] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      updateStream(item.id, {
        thumbnailTimestampPct: pct / 100,
        allowedOrigins: origins
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      notifications.show({ message: "Settings saved", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't save settings", color: "red" }),
  });

  if (item.kind !== "video") return null;

  const duration = item.duration ?? 0;
  const canPreview = !item.requireSignedURLs && !!item.thumbnailUrl && duration > 0;
  const sec = Math.round((debouncedPct / 100) * duration);
  const previewUrl =
    canPreview && !previewFailed ? `${item.thumbnailUrl}?time=${sec}s&height=240` : item.thumbnailUrl;

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Thumbnail &amp; playback
      </Text>
      {item.thumbnailUrl && (
        <Image
          src={previewUrl}
          alt="thumbnail preview"
          radius="md"
          h={160}
          fit="contain"
          onError={() => setPreviewFailed(true)}
        />
      )}
      <Text size="xs" c="dimmed">
        Thumbnail timestamp: {pct}%
        {item.requireSignedURLs ? " (preview updates after saving)" : ""}
      </Text>
      <Slider
        min={0}
        max={100}
        value={pct}
        onChange={(v) => {
          setPct(v);
          setPreviewFailed(false);
        }}
      />
      <Textarea
        label="Allowed origins"
        description="One domain per line. Empty = allow all origins."
        autosize
        minRows={2}
        value={origins}
        onChange={(e) => setOrigins(e.currentTarget.value)}
      />
      <Button
        size="xs"
        loading={save.isPending}
        onClick={() => save.mutate()}
        style={{ alignSelf: "flex-start" }}
      >
        Save settings
      </Button>
    </Stack>
  );
}
```

- [ ] **Step 2: Wire into `src/components/MediaDetailDrawer.tsx`**

(a) Add `import { VideoSettingsPanel } from "@/components/VideoSettingsPanel";`.
(b) In `VideoDetail`, render `<VideoSettingsPanel item={item} />` alongside the other video panels (e.g. after `<VideoCaptionPanel item={item} />`).

- [ ] **Step 3: Verify:** `npm run typecheck` (clean). If a Mantine prop type mismatches (`Slider`/`Textarea`/`Image` onError), fix minimally and report. Then `npx oxlint src/components/VideoSettingsPanel.tsx src/components/MediaDetailDrawer.tsx` and `npm run build` (green).

- [ ] **Step 4: Commit**
```bash
git add src/components/VideoSettingsPanel.tsx src/components/MediaDetailDrawer.tsx
git commit -m "feat(client): video thumbnail + allowed-origins settings panel"
```

---

## Task 4: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full verification**
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: oxlint/Prettier clean (pre-existing warnings only; if `npm run check` reformats files, include them, but `git checkout worker-configuration.d.ts` to avoid generated-file churn), types pass, all Vitest tests pass (existing + new stream tests), client + SSR build green.

- [ ] **Step 2: Manual pass** (deployed, Access-gated):
1. Open a public, ready video → "Thumbnail & playback".
2. Drag the thumbnail slider → the preview frame updates (~300 ms debounce).
3. Set an allowed origin (e.g. `example.com`) → **Save settings** → toast.
4. Reopen / refresh → the gallery thumbnail reflects the new timestamp.
5. A signed video shows the current thumbnail + the "updates after saving" note; saving still works.

- [ ] **Step 3: CHANGELOG** — under `## [Unreleased]` → `### Added`:
```markdown
- **Video thumbnail & playback settings (editing phase, sub-project F):** set a Stream video's poster-thumbnail timestamp (a live-preview slider over the video's duration) and its allowed embedding origins, from the detail drawer. The existing video-edit endpoint now also forwards `thumbnailTimestampPct` and `allowedOrigins`; saving refreshes the gallery so the new thumbnail appears.
```

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: changelog for video thumbnail/playback settings"
```

---

## Self-Review

**Spec coverage:** widen PATCH for `thumbnailTimestampPct` (validated `0–1`) + `allowedOrigins` → Task 1; `allowedOrigins` on `CfVideo`/`StreamItem`/`toStreamItem` → Task 1; client `StreamItem`/`MediaPatch`/`MediaItem` threading → Task 2; `VideoSettingsPanel` slider + live preview (public) + origins textarea + save→invalidate → Task 3; signed-video note → Task 3; worker tests → Task 1; manual → Task 4; `allowedOrigins` field re-verify → Task 1 Step 6. ✓

**Placeholder scan:** none — complete code/commands. The `allowedOrigins` field-name uncertainty has a verify-and-adjust step.

**Type consistency:** `allowedOrigins`/`thumbnailTimestampPct` added consistently across worker `CfVideo`/`StreamItem`/`toStreamItem` (Task 1), client `StreamItem`/`MediaPatch` (Task 2), and `MediaItem` + all three mappers (Task 2) — so every `MediaItem` literal stays valid. `updateStream(uid, MediaPatch)` (existing) carries the new patch fields used by the panel (Task 3). The panel reads `item.thumbnailTimestampPct`/`item.allowedOrigins`/`item.thumbnailUrl`/`item.duration`/`item.requireSignedURLs`, all present on `MediaItem`.
