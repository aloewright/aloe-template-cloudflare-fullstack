# MP4 / Audio Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable, poll, download (MP4 + audio M4A), and remove Stream video downloads from the detail drawer.

**Architecture:** Worker endpoints proxy Cloudflare's `/stream/{uid}/downloads` API and build the ready-to-use download URL (uid for public videos; a `downloadable:true` token for private ones). The client panel polls status while a download is processing and shows Enable → Preparing% → Download/Remove per type. Cloudflare's `?filename=` makes the URL an attachment, so no worker proxies large files.

**Tech Stack:** Hono + Cloudflare Stream, Mantine, TanStack Query, Vitest.

**Conventions:** License header `/* AGPL-3.0-or-later */` on new files. `npm run check` (oxlint + Prettier). Worker + pure logic TDD with Vitest. Single worker test: `npm run test -- <name>`.

**Verified against Cloudflare docs:** enable `POST /stream/{uid}/downloads` (+`/audio`); status `GET /stream/{uid}/downloads`; delete `DELETE /stream/{uid}/downloads/{type}`; signed download = token with `downloadable:true` placed in the URL in place of the uid; `?filename=` (charset `[A-Za-z0-9-_]`, extension auto-appended) forces attachment.

---

## File Structure
- `worker/src/lib/urls.ts` — add `sanitizeDownloadFilename`.
- `worker/src/lib/urls.test.ts` — tests.
- `worker/src/routes/stream.ts` — add `GET`/`POST`/`DELETE /:uid/downloads`.
- `worker/src/routes/stream.test.ts` — tests.
- `src/lib/cf-api.ts` — `DownloadInfo`/`DownloadsStatus` + `getDownloads`/`enableDownload`/`deleteDownload`.
- `src/components/VideoDownloadPanel.tsx` — NEW.
- `src/components/MediaDetailDrawer.tsx` — render the panel in `VideoDetail`.

---

## Task 1: Filename sanitizer (pure, TDD)

**Files:**
- Modify: `worker/src/lib/urls.ts`, `worker/src/lib/urls.test.ts`

- [ ] **Step 1: Append failing tests** — inside the `describe("urls", ...)` block in `worker/src/lib/urls.test.ts`:
```ts
  it("sanitizes download filenames", () => {
    expect(sanitizeDownloadFilename("My Vid.mp4")).toBe("My_Vid");
    expect(sanitizeDownloadFilename("a/b c.mov")).toBe("a_b_c");
    expect(sanitizeDownloadFilename("clip-01_final.webm")).toBe("clip-01_final");
    expect(sanitizeDownloadFilename("")).toBe("video");
    expect(sanitizeDownloadFilename("***")).toBe("video");
  });
```
And add `sanitizeDownloadFilename` to the import at the top:
```ts
import {
  parseAccountHash,
  parseStreamCode,
  pickImageThumbnail,
  sanitizeDownloadFilename,
  streamIframeUrl,
} from "./urls";
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- lib/urls`.

- [ ] **Step 3: Implement** — append to `worker/src/lib/urls.ts`:
```ts
// Cloudflare download `filename` must be [A-Za-z0-9-_]; the extension is
// appended automatically, so strip it and replace everything else.
export function sanitizeDownloadFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const safe = base
    .replace(/[^A-Za-z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return safe || "video";
}
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- lib/urls`. Then `npx oxlint worker/src/lib/urls.ts`.

- [ ] **Step 5: Commit**
```bash
git add worker/src/lib/urls.ts worker/src/lib/urls.test.ts
git commit -m "feat(stream): sanitizeDownloadFilename helper (tested)"
```

---

## Task 2: Worker — downloads endpoints

**Files:**
- Modify: `worker/src/routes/stream.ts`, `worker/src/routes/stream.test.ts`

- [ ] **Step 1: Append failing tests** — inside the `describe("streamRoute", ...)` block in `worker/src/routes/stream.test.ts`. (`UID` is a 32-hex id matching the route guard; the `fetchMock` routes by URL since the handler makes multiple CF calls.)
```ts
  const UID = "0ea62994907491cf9ebefb0a34c1e2c6";

  it("GET /:uid/downloads (public) returns statuses + a uid-based ready URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/downloads"))
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              default: { status: "ready", percentComplete: 100, url: "ignored" },
              audio: { status: "inprogress", percentComplete: 40, url: "ignored" },
            },
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({
          success: true,
          result: { uid: UID, requireSignedURLs: false, meta: { name: "My Vid.mp4" }, thumbnail: "" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request(`/api/stream/${UID}/downloads`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      default: { status: string; url: string | null };
      audio: { status: string; url: string | null };
    };
    expect(body.default.status).toBe("ready");
    expect(body.default.url).toBe(
      `https://customer-CODE.cloudflarestream.com/${UID}/downloads/default.mp4?filename=My_Vid`,
    );
    expect(body.audio.status).toBe("inprogress");
    expect(body.audio.url).toBeNull();
  });

  it("GET /:uid/downloads (signed) mints a downloadable token and uses it in the URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/downloads"))
        return new Response(
          JSON.stringify({
            success: true,
            result: { default: { status: "ready", percentComplete: 100, url: "x" } },
          }),
          { status: 200 },
        );
      if (url.endsWith("/token"))
        return new Response(JSON.stringify({ success: true, result: { token: "TOKENXYZ" } }), {
          status: 200,
        });
      return new Response(
        JSON.stringify({
          success: true,
          result: { uid: UID, requireSignedURLs: true, meta: { name: "Clip" }, thumbnail: "" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request(`/api/stream/${UID}/downloads`);
    expect(res.status).toBe(200);
    const tokenCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/token"))!;
    expect((tokenCall[1] as RequestInit).method).toBe("POST");
    expect(JSON.parse((tokenCall[1] as RequestInit).body as string)).toEqual({ downloadable: true });
    const body = (await res.json()) as { default: { url: string | null } };
    expect(body.default.url).toBe(
      `https://customer-CODE.cloudflarestream.com/TOKENXYZ/downloads/default.mp4?filename=Clip`,
    );
  });

  it("POST /:uid/downloads enables the requested type", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await app(connected).request(`/api/stream/${UID}/downloads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "audio" }),
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc1/stream/${UID}/downloads/audio`,
    );
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("DELETE /:uid/downloads?type=audio removes that download", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connected).request(`/api/stream/${UID}/downloads?type=audio`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc1/stream/${UID}/downloads/audio`,
    );
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("DELETE");
  });

  it("downloads endpoints return 409 when not connected", async () => {
    const res = await app(disconnected).request(`/api/stream/${UID}/downloads`);
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- routes/stream`.

- [ ] **Step 3: Implement** — in `worker/src/routes/stream.ts`:

(a) Add `CfApiError` + `sanitizeDownloadFilename` to imports:
```ts
import { type CfCreds, CfApiError, cfFetch, cfJson } from "../lib/cf";
import { parseStreamCode, sanitizeDownloadFilename } from "../lib/urls";
```
(b) Add these types near the other `type` declarations (e.g. after `CfVideo`):
```ts
type CfDownload = { status?: string; url?: string; percentComplete?: number };
type CfDownloads = { default?: CfDownload; audio?: CfDownload };
type DownloadInfo = { status: string; percentComplete: number; url: string | null };
```
(c) Add the three handlers immediately before `return app;`:
```ts
  app.get("/:uid/downloads", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);

    let dl: CfDownloads;
    try {
      dl = await cfJson<CfDownloads>(creds, `/stream/${uid}/downloads`);
    } catch (e) {
      if (e instanceof CfApiError && e.status === 404) dl = {};
      else return c.json({ error: "Failed to load downloads" }, 502);
    }
    let video: CfVideo;
    try {
      video = await cfJson<CfVideo>(creds, `/stream/${uid}`);
    } catch {
      return c.json({ error: "Failed to load video" }, 502);
    }

    const code =
      creds.streamCode ?? parseStreamCode(video.thumbnail || video.playback?.hls || "");
    const anyReady = dl.default?.status === "ready" || dl.audio?.status === "ready";
    let ref = uid;
    if (video.requireSignedURLs && anyReady) {
      try {
        const t = await cfJson<{ token?: string }>(creds, `/stream/${uid}/token`, {
          method: "POST",
          body: JSON.stringify({ downloadable: true }),
        });
        if (t.token) ref = t.token;
      } catch {
        // leave ref = uid; the URL may not authorize, surfaced client-side
      }
    }
    const name = sanitizeDownloadFilename(video.meta?.name ?? uid);
    const info = (d: CfDownload | undefined, file: string): DownloadInfo | null => {
      if (!d) return null;
      const url =
        d.status === "ready" && code
          ? `https://customer-${code}.cloudflarestream.com/${ref}/downloads/${file}?filename=${name}`
          : null;
      return { status: d.status ?? "unknown", percentComplete: d.percentComplete ?? 0, url };
    };
    return c.json({ default: info(dl.default, "default.mp4"), audio: info(dl.audio, "audio.m4a") });
  });

  app.post("/:uid/downloads", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);
    const body = await c.req
      .json<{ type?: "default" | "audio" }>()
      .catch(() => ({}) as { type?: "default" | "audio" });
    const path =
      body.type === "audio" ? `/stream/${uid}/downloads/audio` : `/stream/${uid}/downloads`;
    try {
      await cfJson(creds, path, { method: "POST" });
    } catch {
      return c.json({ error: "Failed to enable download" }, 502);
    }
    return c.json({ ok: true });
  });

  app.delete("/:uid/downloads", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);
    const type = c.req.query("type") === "audio" ? "audio" : "default";
    try {
      await cfJson(creds, `/stream/${uid}/downloads/${type}`, { method: "DELETE" });
    } catch {
      return c.json({ error: "Failed to remove download" }, 502);
    }
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- routes/stream`. Then `npx oxlint worker/src/routes/stream.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add worker/src/routes/stream.ts worker/src/routes/stream.test.ts
git commit -m "feat(worker): Stream MP4/audio download enable/status/remove"
```

---

## Task 3: Client API fetchers

**Files:**
- Modify: `src/lib/cf-api.ts`

- [ ] **Step 1: Append** to `src/lib/cf-api.ts` (after the existing Stream fetchers):
```ts
export type DownloadInfo = { status: string; percentComplete: number; url: string | null };
export type DownloadsStatus = { default: DownloadInfo | null; audio: DownloadInfo | null };

export const getDownloads = (uid: string) =>
  fetchJson<DownloadsStatus>(`/api/stream/${encodeURIComponent(uid)}/downloads`);

export const enableDownload = (uid: string, type: "default" | "audio") =>
  fetchJson<{ ok: true }>(`/api/stream/${encodeURIComponent(uid)}/downloads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });

export const deleteDownload = (uid: string, type: "default" | "audio") =>
  fetchJson<{ ok: true }>(
    `/api/stream/${encodeURIComponent(uid)}/downloads?type=${type}`,
    { method: "DELETE" },
  );
```

- [ ] **Step 2: Verify:** `npm run typecheck` (clean), `npx oxlint src/lib/cf-api.ts`.

- [ ] **Step 3: Commit**
```bash
git add src/lib/cf-api.ts
git commit -m "feat(client): downloads fetchers + types"
```

---

## Task 4: VideoDownloadPanel + drawer wiring

**Files:**
- Create: `src/components/VideoDownloadPanel.tsx`
- Modify: `src/components/MediaDetailDrawer.tsx`

- [ ] **Step 1: Create `src/components/VideoDownloadPanel.tsx`**
```tsx
/* AGPL-3.0-or-later */
import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DownloadInfo,
  type DownloadsStatus,
  deleteDownload,
  enableDownload,
  getDownloads,
} from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";

const hasInProgress = (d: DownloadsStatus | undefined) =>
  d?.default?.status === "inprogress" || d?.audio?.status === "inprogress";

function TypeRow({
  uid,
  label,
  type,
  info,
  onChange,
}: {
  uid: string;
  label: string;
  type: "default" | "audio";
  info: DownloadInfo | null;
  onChange: () => void;
}) {
  const enable = useMutation({
    mutationFn: () => enableDownload(uid, type),
    onSuccess: onChange,
    onError: () => notifications.show({ message: "Couldn't enable download", color: "red" }),
  });
  const remove = useMutation({
    mutationFn: () => deleteDownload(uid, type),
    onSuccess: onChange,
    onError: () => notifications.show({ message: "Couldn't remove download", color: "red" }),
  });

  if (!info) {
    return (
      <Button size="xs" variant="light" loading={enable.isPending} onClick={() => enable.mutate()}>
        Enable {label}
      </Button>
    );
  }
  if (info.status === "ready" && info.url) {
    return (
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          component="a"
          href={info.url}
          target="_blank"
          rel="noopener"
          leftSection={<IconDownload size={14} />}
        >
          Download {label}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="red"
          loading={remove.isPending}
          onClick={() => remove.mutate()}
          leftSection={<IconTrash size={14} />}
        >
          Remove
        </Button>
      </Group>
    );
  }
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}: preparing {Math.round(info.percentComplete)}%
      </Text>
      <Progress value={info.percentComplete} />
    </div>
  );
}

export function VideoDownloadPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const ready = item.kind === "video" && Boolean(item.readyToStream);
  const q = useQuery({
    queryKey: ["downloads", item.id],
    queryFn: () => getDownloads(item.id),
    enabled: ready,
    refetchInterval: (query) => (hasInProgress(query.state.data) ? 4000 : false),
  });
  if (!ready) return null;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["downloads", item.id] });
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Downloads
      </Text>
      <TypeRow uid={item.id} label="MP4" type="default" info={q.data?.default ?? null} onChange={invalidate} />
      <TypeRow uid={item.id} label="Audio (M4A)" type="audio" info={q.data?.audio ?? null} onChange={invalidate} />
    </Stack>
  );
}
```

- [ ] **Step 2: Wire into `src/components/MediaDetailDrawer.tsx`**

(a) Add `import { VideoDownloadPanel } from "@/components/VideoDownloadPanel";`.
(b) In the `VideoDetail` component, render `<VideoDownloadPanel item={item} />` right after `<VideoClipPanel item={item} />`.

- [ ] **Step 3: Verify:** `npm run typecheck` (clean). If the TanStack Query `refetchInterval` callback type complains, the `(query) => …` form returning `number | false` is correct for v5 — adjust minimally if needed and report. Then `npx oxlint src/components/VideoDownloadPanel.tsx src/components/MediaDetailDrawer.tsx` and `npm run build` (green).

- [ ] **Step 4: Commit**
```bash
git add src/components/VideoDownloadPanel.tsx src/components/MediaDetailDrawer.tsx
git commit -m "feat(client): video downloads panel (enable/poll/download/remove)"
```

---

## Task 5: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full verification**
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: oxlint/Prettier clean (pre-existing warnings only; if `npm run check` reformats files, include them, but `git checkout worker-configuration.d.ts` to avoid generated-file churn), types pass, all Vitest tests pass (existing + downloads + sanitizer), client + SSR build green.

- [ ] **Step 2: Manual pass** (deployed, Access-gated):
1. Open a ready video → "Downloads" with **Enable MP4** / **Enable Audio (M4A)**.
2. Enable MP4 → "preparing %" updates (polls) → **Download MP4** → file saves.
3. Enable Audio → downloads `.m4a`.
4. **Remove** → returns to Enable.
5. A signed (require-signed-URLs) video's download link still works.
6. A video with no downloads shows the Enable buttons (no error) — confirms the no-downloads GET is handled (empty/`404` → empty).

- [ ] **Step 3: CHANGELOG** — under `## [Unreleased]` → `### Added`:
```markdown
- **Video downloads (editing phase, sub-project E):** enable, poll, download (MP4 + audio-only M4A), and remove Stream video downloads from the detail drawer. The worker proxies Cloudflare's `/stream/:uid/downloads` API and builds the ready URL — using a `downloadable` signed token for private videos and `?filename=` (so Cloudflare serves it as an attachment); large files stream straight from Cloudflare's CDN, not through the worker.
```

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: changelog for video downloads"
```

---

## Self-Review

**Spec coverage:** worker GET (status + public uid URL / signed-token URL) → Task 2; POST enable (default + audio) → Task 2; DELETE remove → Task 2; `409`/`400`(uid)/`502` + no-downloads `404`→empty → Task 2; client fetchers + types → Task 3; per-type Enable→Preparing%→Download/Remove panel polling while in-progress, gated to ready videos → Task 4; signed-token URL → Task 2; `sanitizeDownloadFilename` + tests → Task 1; worker tests → Task 2; manual → Task 5. ✓

**Placeholder scan:** none — complete code/commands. The no-downloads response shape is handled defensively (`404` → empty `{}`) and re-confirmed in the Task 5 manual pass.

**Type consistency:** `DownloadInfo`/`DownloadsStatus` match between worker (`stream.ts` return shape) and client (`cf-api.ts`). `getDownloads`/`enableDownload(uid,type)`/`deleteDownload(uid,type)` (Task 3) match the worker routes (Task 2) and the panel calls (Task 4). `sanitizeDownloadFilename` defined in Task 1, used in Task 2. The 32-hex uid guard matches the existing clip route.
