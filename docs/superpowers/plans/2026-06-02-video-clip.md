# Video Clip Trimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trim a ready Cloudflare Stream video into a new clip from the detail drawer (start/end via a range slider), creating it through Cloudflare's `/stream/clip` API.

**Architecture:** A worker endpoint `POST /api/stream/:uid/clip` proxies CF `POST /stream/clip` and returns the new video mapped through the existing `toStreamItem`/`signStreamItems`. The client trim panel (range slider + synced numeric inputs) lives in the video detail drawer; on success it refreshes the media list so the processing clip appears.

**Tech Stack:** Hono + Cloudflare Stream, Mantine (`RangeSlider`/`NumberInput`), TanStack Query, Vitest.

**Conventions:** License header `/* AGPL-3.0-or-later */` on new files. `npm run check` (oxlint + Prettier). Worker + pure client logic TDD with Vitest. Single worker test: `npm run test -- <name>`.

**Verified against Cloudflare docs:** `POST /accounts/{id}/stream/clip` `{ clippedFromVideoUID, startTimeSeconds, endTimeSeconds }` creates a new async-processing video. The plan sends `meta: { name }` inline when a name is given; **Task 2 Step 6 verifies** that `/stream/clip` honors `meta` (if it doesn't, add a follow-up `POST /stream/{newUid}` `{ meta: { name } }`).

---

## File Structure
- `src/lib/clip.ts` — NEW; `isValidClipRange`, `clipSecondsLabel` (pure).
- `src/lib/clip.test.ts` — NEW.
- `worker/src/routes/stream.ts` — add `POST /:uid/clip`.
- `worker/src/routes/stream.test.ts` — tests.
- `src/lib/cf-api.ts` — `createClip`.
- `src/components/VideoClipPanel.tsx` — NEW; trim panel.
- `src/components/MediaDetailDrawer.tsx` — render the panel in `VideoDetail`.

---

## Task 1: Clip helpers (pure, TDD)

**Files:**
- Create: `src/lib/clip.ts`, `src/lib/clip.test.ts`

- [ ] **Step 1: Write failing tests** — `src/lib/clip.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { clipSecondsLabel, isValidClipRange } from "@/lib/clip";

describe("isValidClipRange", () => {
  it("accepts a range inside the duration", () => {
    expect(isValidClipRange(0, 5, 10)).toBe(true);
    expect(isValidClipRange(2, 10, 10)).toBe(true);
  });
  it("rejects end <= start", () => {
    expect(isValidClipRange(5, 5, 10)).toBe(false);
    expect(isValidClipRange(6, 5, 10)).toBe(false);
  });
  it("rejects end beyond duration and negative start", () => {
    expect(isValidClipRange(0, 15, 10)).toBe(false);
    expect(isValidClipRange(-1, 5, 10)).toBe(false);
  });
});

describe("clipSecondsLabel", () => {
  it("formats m:ss", () => {
    expect(clipSecondsLabel(0)).toBe("0:00");
    expect(clipSecondsLabel(9)).toBe("0:09");
    expect(clipSecondsLabel(75)).toBe("1:15");
  });
});
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- lib/clip`.

- [ ] **Step 3: Implement** — `src/lib/clip.ts`:
```ts
/* AGPL-3.0-or-later */
export function isValidClipRange(start: number, end: number, duration: number): boolean {
  return (
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    Number.isFinite(duration) &&
    start >= 0 &&
    end > start &&
    end <= duration
  );
}

export function clipSecondsLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- lib/clip`. Then `npx oxlint src/lib/clip.ts src/lib/clip.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/lib/clip.ts src/lib/clip.test.ts
git commit -m "feat(clip): pure clip-range validation + label (tested)"
```

---

## Task 2: Worker — create-clip endpoint

**Files:**
- Modify: `worker/src/routes/stream.ts`, `worker/src/routes/stream.test.ts`

- [ ] **Step 1: Write failing tests** — append inside the `describe("streamRoute", ...)` block in `worker/src/routes/stream.test.ts`:
```ts
  it("POST /:uid/clip creates a clip and returns the new item", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              uid: "newclip",
              meta: { name: "My clip" },
              duration: 15,
              readyToStream: false,
              status: { state: "queued" },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request("/api/stream/src1/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTimeSeconds: 10, endTimeSeconds: 25, name: "My clip" }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream/clip");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      clippedFromVideoUID: "src1",
      startTimeSeconds: 10,
      endTimeSeconds: 25,
      meta: { name: "My clip" },
    });
    const json = (await res.json()) as { uid: string; name: string };
    expect(json.uid).toBe("newclip");
    expect(json.name).toBe("My clip");
  });

  it("POST /:uid/clip returns 400 when end <= start", async () => {
    const res = await app(connected).request("/api/stream/src1/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTimeSeconds: 30, endTimeSeconds: 30 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:uid/clip returns 409 when not connected", async () => {
    const res = await app(disconnected).request("/api/stream/src1/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTimeSeconds: 0, endTimeSeconds: 5 }),
    });
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- routes/stream`.

- [ ] **Step 3: Implement** — in `worker/src/routes/stream.ts`, add immediately before `return app;`:
```ts
  app.post("/:uid/clip", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{ startTimeSeconds?: number; endTimeSeconds?: number; name?: string }>()
      .catch(() => ({}) as { startTimeSeconds?: number; endTimeSeconds?: number; name?: string });
    const { startTimeSeconds, endTimeSeconds, name } = body;
    if (
      typeof startTimeSeconds !== "number" ||
      typeof endTimeSeconds !== "number" ||
      !Number.isFinite(startTimeSeconds) ||
      !Number.isFinite(endTimeSeconds) ||
      startTimeSeconds < 0 ||
      endTimeSeconds <= startTimeSeconds
    ) {
      return c.json({ error: "Invalid clip range" }, 400);
    }
    let video: CfVideo;
    try {
      video = await cfJson<CfVideo>(creds, "/stream/clip", {
        method: "POST",
        body: JSON.stringify({
          clippedFromVideoUID: c.req.param("uid"),
          startTimeSeconds,
          endTimeSeconds,
          ...(name ? { meta: { name } } : {}),
        }),
      });
    } catch {
      return c.json({ error: "Failed to create clip" }, 502);
    }
    const item = toStreamItem(video);
    await signStreamItems([item], creds);
    return c.json(item);
  });
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- routes/stream`. Then `npx oxlint worker/src/routes/stream.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add worker/src/routes/stream.ts worker/src/routes/stream.test.ts
git commit -m "feat(worker): create a Stream clip from a source video"
```

- [ ] **Step 6: Verify `/stream/clip` honors `meta` (docs check)**

Use the Cloudflare docs (the `mcp__cloudflare__search_cloudflare_documentation` tool or https://developers.cloudflare.com/stream/edit-videos/video-clipping/ + the `/stream/clip` API reference) to confirm the create-clip body accepts `meta`. If it does **not**, change the implementation to set the name with a follow-up call after the clip is created:
```ts
      });
      if (name) {
        try {
          video = await cfJson<CfVideo>(creds, `/stream/${video.uid}`, {
            method: "POST",
            body: JSON.stringify({ meta: { name } }),
          });
        } catch {
          // Name is best-effort; the clip already exists.
        }
      }
```
and drop `meta` from the `/stream/clip` body + update the first test's body assertion to omit `meta`. If `meta` is accepted, leave Step 3 as-is. Re-run `npm run test -- routes/stream`; commit any change with `git commit -m "fix(worker): set clip name via follow-up edit"`.

---

## Task 3: Client API fetcher

**Files:**
- Modify: `src/lib/cf-api.ts`

- [ ] **Step 1: Add `createClip`** — append to `src/lib/cf-api.ts` (after the existing Stream fetchers; `StreamItem` is already exported in this file):
```ts
export const createClip = (
  uid: string,
  input: { startTimeSeconds: number; endTimeSeconds: number; name?: string },
) =>
  fetchJson<StreamItem>(`/api/stream/${encodeURIComponent(uid)}/clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
```

- [ ] **Step 2: Verify:** `npm run typecheck` (clean), `npx oxlint src/lib/cf-api.ts`.

- [ ] **Step 3: Commit**
```bash
git add src/lib/cf-api.ts
git commit -m "feat(client): createClip fetcher"
```

---

## Task 4: VideoClipPanel + drawer wiring

**Files:**
- Create: `src/components/VideoClipPanel.tsx`
- Modify: `src/components/MediaDetailDrawer.tsx`

- [ ] **Step 1: Create `src/components/VideoClipPanel.tsx`**
```tsx
/* AGPL-3.0-or-later */
import { Button, Group, NumberInput, RangeSlider, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createClip } from "@/lib/cf-api";
import { clipSecondsLabel, isValidClipRange } from "@/lib/clip";
import type { MediaItem } from "@/lib/media";

export function VideoClipPanel({ item }: { item: MediaItem }) {
  const duration = Math.floor(item.duration ?? 0);
  const queryClient = useQueryClient();
  const [range, setRange] = useState<[number, number]>([0, duration]);
  const [name, setName] = useState(`${item.name} (clip)`);
  const [start, end] = range;

  const clip = useMutation({
    mutationFn: () =>
      createClip(item.id, {
        startTimeSeconds: start,
        endTimeSeconds: end,
        name: name.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      notifications.show({ message: "Clip is processing — it'll appear shortly", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't create clip", color: "red" }),
  });

  // Hooks above run unconditionally; gate the render below.
  if (!(item.kind === "video" && item.readyToStream && duration > 0)) return null;

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Trim / Create clip
      </Text>
      <RangeSlider
        min={0}
        max={duration}
        step={1}
        minRange={1}
        value={range}
        onChange={setRange}
        label={clipSecondsLabel}
      />
      <Group grow>
        <NumberInput
          label="Start (s)"
          min={0}
          max={Math.max(0, end - 1)}
          value={start}
          onChange={(v) => setRange([typeof v === "number" ? v : 0, end])}
        />
        <NumberInput
          label="End (s)"
          min={start + 1}
          max={duration}
          value={end}
          onChange={(v) => setRange([start, typeof v === "number" ? v : start + 1])}
        />
      </Group>
      <Text size="xs" c="dimmed">
        Clip length: {clipSecondsLabel(Math.max(0, end - start))}
      </Text>
      <TextInput label="Clip name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <Button
        size="xs"
        disabled={!isValidClipRange(start, end, duration)}
        loading={clip.isPending}
        onClick={() => clip.mutate()}
        style={{ alignSelf: "flex-start" }}
      >
        Create clip
      </Button>
    </Stack>
  );
}
```

- [ ] **Step 2: Wire into `src/components/MediaDetailDrawer.tsx`**

(a) Add import:
```ts
import { VideoClipPanel } from "@/components/VideoClipPanel";
```
(b) In the `VideoDetail` component, render `<VideoClipPanel item={item} />` after the links block (the `{item.links.length > 0 && (...)}` expression) and before the trailing `Created` `<Text>`.

- [ ] **Step 3: Verify:** `npm run typecheck` (clean). If a Mantine prop type mismatches (`RangeSlider` `value`/`onChange` expects `[number, number]`; `NumberInput` `onChange` is `number | string`), the coercions above already handle it — adjust minimally if needed and report. Then `npx oxlint src/components/VideoClipPanel.tsx src/components/MediaDetailDrawer.tsx` and `npm run build` (green).

- [ ] **Step 4: Commit**
```bash
git add src/components/VideoClipPanel.tsx src/components/MediaDetailDrawer.tsx
git commit -m "feat(client): video trim panel (range slider) in the detail drawer"
```

---

## Task 5: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full verification**
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: oxlint/Prettier clean (pre-existing warnings only; if `npm run check` reformats files, include them in the commit, but `git checkout worker-configuration.d.ts` to avoid generated-file churn), types pass, all Vitest tests pass (existing + clip + worker), client + SSR build green.

- [ ] **Step 2: Manual pass** (deployed, Access-gated):
1. Open a ready video → "Trim / Create clip" appears.
2. Drag the range slider thumbs / type start & end seconds — slider and inputs stay in sync; clip-length updates.
3. Edit the clip name → Create clip → "processing" toast.
4. The new clip appears in the gallery (not-ready, then ready) and plays.
5. A not-ready or non-video item shows no trim panel.

- [ ] **Step 3: CHANGELOG** — under `## [Unreleased]` → `### Added`:
```markdown
- **Video clip trimming (editing phase, sub-project D):** trim a ready Stream video into a new clip from the detail drawer — a range slider over the source duration synced with start/end second inputs, a live clip-length readout, and a name field. The worker `POST /api/stream/:uid/clip` proxies Cloudflare's `/stream/clip` and returns the new video; on success the media list refreshes so the processing clip appears and becomes playable when ready.
```

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: changelog for video clip trimming"
```

---

## Self-Review

**Spec coverage:** worker `/:uid/clip` → CF `/stream/clip` with range + name → Task 2; range validation (`400`) + `409` → Task 2; client `createClip` → Task 3; range-slider trim panel synced with numeric inputs, clip-length, name, gated to ready videos → Task 4; success notify + `["media"]` refresh → Task 4; pure validation/label + tests → Task 1; worker tests → Task 2; meta-inline verification → Task 2 Step 6. ✓

**Placeholder scan:** none — complete code/commands. The single external uncertainty (`/stream/clip` honoring `meta`) has an explicit verify-and-fallback step.

**Type consistency:** `isValidClipRange(start, end, duration)` / `clipSecondsLabel(seconds)` defined in Task 1, consumed in Task 4. `createClip(uid, { startTimeSeconds, endTimeSeconds, name })` defined in Task 3 matches the worker body shape (Task 2) and the panel call (Task 4). The worker returns a `StreamItem` (via `toStreamItem`), which `createClip` types as the response.
