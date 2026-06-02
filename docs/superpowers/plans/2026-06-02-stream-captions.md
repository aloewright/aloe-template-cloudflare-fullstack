# Stream Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage a Stream video's captions from the detail drawer — list, AI-generate, upload a `.vtt`, and delete.

**Architecture:** Worker endpoints proxy Cloudflare's `/stream/{uid}/captions` API (token-side); the client panel lists captions and polls while any is processing. Uploads send a multipart `.vtt` the worker re-PUTs to Cloudflare.

**Tech Stack:** Hono + Cloudflare Stream, Mantine (`Select`/`FileInput`), TanStack Query, Vitest.

**Conventions:** License header `/* AGPL-3.0-or-later */` on new files. `npm run check` (oxlint + Prettier). Worker logic TDD with Vitest. Single worker test: `npm run test -- <name>`.

**Verified against Cloudflare docs:** list `GET /stream/{uid}/captions` → `[{language,label,generated,status}]`; AI generate `POST /stream/{uid}/captions/{lang}/generate` (langs `en,cs,nl,fr,de,it,ja,ko,pl,pt,ru,es`); upload `PUT /stream/{uid}/captions/{lang}` multipart `file=<.vtt>`; delete `DELETE /stream/{uid}/captions/{lang}`. **Task 1 Step 6 re-confirms the generate path + upload field name.**

---

## File Structure
- `worker/src/routes/stream.ts` — add 4 caption handlers + a `LANG_RE`/`CfCaption`/`Caption` type.
- `worker/src/routes/stream.test.ts` — tests.
- `src/lib/captions.ts` — NEW; language lists.
- `src/lib/cf-api.ts` — `Caption` + `listCaptions`/`generateCaption`/`uploadCaption`/`deleteCaption`.
- `src/components/VideoCaptionPanel.tsx` — NEW.
- `src/components/MediaDetailDrawer.tsx` — render the panel in `VideoDetail`.

---

## Task 1: Worker — caption endpoints

**Files:**
- Modify: `worker/src/routes/stream.ts`, `worker/src/routes/stream.test.ts`

- [ ] **Step 1: Append failing tests** — inside the `describe("streamRoute", ...)` block in `worker/src/routes/stream.test.ts` (reuse the existing `UID` constant if present from the downloads tests; otherwise define `const UID = "0ea62994907491cf9ebefb0a34c1e2c6";` at the top of the block):
```ts
  it("GET /:uid/captions maps the caption list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: [
              { language: "en", label: "English (auto-generated)", generated: true, status: "ready" },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const res = await app(connected).request(`/api/stream/${UID}/captions`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      captions: [
        { language: "en", label: "English (auto-generated)", generated: true, status: "ready" },
      ],
    });
  });

  it("POST /:uid/captions/:lang/generate calls the CF generate endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connected).request(`/api/stream/${UID}/captions/en/generate`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc1/stream/${UID}/captions/en/generate`,
    );
    expect((fetchMock.mock.calls[0]![1] as unknown as RequestInit).method).toBe("POST");
  });

  it("POST generate returns 400 for an invalid language", async () => {
    const res = await app(connected).request(`/api/stream/${UID}/captions/zz!/generate`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  it("PUT /:uid/captions/:lang uploads the vtt as multipart", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const fd = new FormData();
    fd.append("file", new File(["WEBVTT\n\n1\n00:00.000 --> 00:01.000\nhi"], "en.vtt", { type: "text/vtt" }));
    const res = await app(connected).request(`/api/stream/${UID}/captions/en`, {
      method: "PUT",
      body: fd,
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/acc1/stream/${UID}/captions/en`);
    expect(init.method).toBe("PUT");
    expect(init.body).toBeInstanceOf(FormData);
  });

  it("PUT /:uid/captions/:lang returns 400 when no file", async () => {
    const res = await app(connected).request(`/api/stream/${UID}/captions/en`, {
      method: "PUT",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /:uid/captions/:lang removes the caption", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: "" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connected).request(`/api/stream/${UID}/captions/en`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/acc1/stream/${UID}/captions/en`);
    expect(init.method).toBe("DELETE");
  });

  it("captions endpoints return 409 when not connected", async () => {
    const res = await app(disconnected).request(`/api/stream/${UID}/captions`);
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: Run, expect FAIL:** `npm run test -- routes/stream`.

- [ ] **Step 3: Implement** — in `worker/src/routes/stream.ts`:

(a) Near the other `type` declarations add:
```ts
type CfCaption = { language?: string; label?: string; generated?: boolean; status?: string };
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
```
(`CfApiError` is already imported from the downloads work; if not, add it to the `../lib/cf` import.)

(b) Add these four handlers immediately before `return app;`:
```ts
  app.get("/:uid/captions", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);
    let list: CfCaption[];
    try {
      list = await cfJson<CfCaption[]>(creds, `/stream/${uid}/captions`);
    } catch (e) {
      if (e instanceof CfApiError && e.status === 404) list = [];
      else return c.json({ error: "Failed to load captions" }, 502);
    }
    const captions = (list ?? []).map((x) => ({
      language: x.language ?? "",
      label: x.label ?? x.language ?? "",
      generated: x.generated ?? false,
      status: x.status ?? "unknown",
    }));
    return c.json({ captions });
  });

  app.post("/:uid/captions/:lang/generate", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);
    const lang = c.req.param("lang");
    if (!LANG_RE.test(lang)) return c.json({ error: "Invalid language" }, 400);
    try {
      await cfJson(creds, `/stream/${uid}/captions/${lang}/generate`, { method: "POST" });
    } catch {
      return c.json({ error: "Failed to generate captions" }, 502);
    }
    return c.json({ ok: true });
  });

  app.put("/:uid/captions/:lang", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);
    const lang = c.req.param("lang");
    if (!LANG_RE.test(lang)) return c.json({ error: "Invalid language" }, 400);
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
    const out = new FormData();
    out.append("file", file, file.name || `${lang}.vtt`);
    try {
      await cfJson(creds, `/stream/${uid}/captions/${lang}`, { method: "PUT", body: out });
    } catch {
      return c.json({ error: "Failed to upload caption" }, 502);
    }
    return c.json({ ok: true });
  });

  app.delete("/:uid/captions/:lang", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);
    const lang = c.req.param("lang");
    if (!LANG_RE.test(lang)) return c.json({ error: "Invalid language" }, 400);
    try {
      await cfJson(creds, `/stream/${uid}/captions/${lang}`, { method: "DELETE" });
    } catch {
      return c.json({ error: "Failed to delete caption" }, 502);
    }
    return c.json({ ok: true });
  });
```

- [ ] **Step 4: Run, expect PASS:** `npm run test -- routes/stream`. Then `npx oxlint worker/src/routes/stream.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit**
```bash
git add worker/src/routes/stream.ts worker/src/routes/stream.test.ts
git commit -m "feat(worker): Stream captions list/generate/upload/delete"
```

- [ ] **Step 6: Verify the generate path + upload field (docs check)**

Use `mcp__cloudflare__search_cloudflare_documentation` (query "Stream generate caption REST endpoint path captions language generate") and/or https://developers.cloudflare.com/stream/edit-videos/adding-captions/ to confirm: (1) AI generate is `POST …/stream/{uid}/captions/{lang}/generate`, and (2) upload multipart field is `file`. The docs already show upload as `-F file=@…` to `…/captions/{lang}` (PUT) — confirm generate. If the generate path differs (e.g. a body flag on the PUT/POST to `…/captions/{lang}` instead of a `/generate` suffix), adjust the `POST /:uid/captions/:lang/generate` handler's CF path accordingly, update the test URL assertion, re-run `npm run test -- routes/stream`, and commit `fix(worker): correct caption generate endpoint`.

---

## Task 2: Client — language lists + API fetchers

**Files:**
- Create: `src/lib/captions.ts`
- Modify: `src/lib/cf-api.ts`

- [ ] **Step 1: Create `src/lib/captions.ts`**
```ts
/* AGPL-3.0-or-later */
export type LangOption = { value: string; label: string };

// Broad list for manual .vtt upload (BCP-47 codes).
export const CAPTION_LANGUAGES: LangOption[] = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "pt", label: "Portuguese" },
  { value: "nl", label: "Dutch" },
  { value: "pl", label: "Polish" },
  { value: "cs", label: "Czech" },
  { value: "ru", label: "Russian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "zh", label: "Chinese" },
  { value: "ar", label: "Arabic" },
  { value: "hi", label: "Hindi" },
  { value: "tr", label: "Turkish" },
];

// Languages Cloudflare can AI-generate captions for.
export const GENERATE_LANGUAGES: LangOption[] = [
  { value: "en", label: "English" },
  { value: "cs", label: "Czech" },
  { value: "nl", label: "Dutch" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
  { value: "es", label: "Spanish" },
];
```

- [ ] **Step 2: Add fetchers** — append to `src/lib/cf-api.ts`:
```ts
export type Caption = { language: string; label: string; generated: boolean; status: string };

export const listCaptions = (uid: string) =>
  fetchJson<{ captions: Caption[] }>(`/api/stream/${encodeURIComponent(uid)}/captions`);

export const generateCaption = (uid: string, lang: string) =>
  fetchJson<{ ok: true }>(
    `/api/stream/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}/generate`,
    { method: "POST" },
  );

export const uploadCaption = (uid: string, lang: string, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return fetchJson<{ ok: true }>(
    `/api/stream/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}`,
    { method: "PUT", body: fd },
  );
};

export const deleteCaption = (uid: string, lang: string) =>
  fetchJson<{ ok: true }>(
    `/api/stream/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}`,
    { method: "DELETE" },
  );
```

- [ ] **Step 3: Verify:** `npm run typecheck` (clean), `npx oxlint src/lib/captions.ts src/lib/cf-api.ts`.

- [ ] **Step 4: Commit**
```bash
git add src/lib/captions.ts src/lib/cf-api.ts
git commit -m "feat(client): caption fetchers + language lists"
```

---

## Task 3: VideoCaptionPanel + drawer wiring

**Files:**
- Create: `src/components/VideoCaptionPanel.tsx`
- Modify: `src/components/MediaDetailDrawer.tsx`

- [ ] **Step 1: Create `src/components/VideoCaptionPanel.tsx`**
```tsx
/* AGPL-3.0-or-later */
import { ActionIcon, Badge, Button, FileInput, Group, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type Caption,
  deleteCaption,
  generateCaption,
  listCaptions,
  uploadCaption,
} from "@/lib/cf-api";
import { CAPTION_LANGUAGES, GENERATE_LANGUAGES } from "@/lib/captions";
import type { MediaItem } from "@/lib/media";

export function VideoCaptionPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const ready = item.kind === "video" && Boolean(item.readyToStream);
  const [genLang, setGenLang] = useState<string | null>("en");
  const [upLang, setUpLang] = useState<string | null>("en");
  const [file, setFile] = useState<File | null>(null);

  const q = useQuery({
    queryKey: ["captions", item.id],
    queryFn: () => listCaptions(item.id),
    enabled: ready,
    refetchInterval: (query) =>
      query.state.status !== "error" &&
      (query.state.data?.captions.some((c) => c.status === "inprogress") ?? false)
        ? 5000
        : false,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["captions", item.id] });

  const gen = useMutation({
    mutationFn: () => generateCaption(item.id, genLang ?? "en"),
    onSuccess: invalidate,
    onError: () => notifications.show({ message: "Couldn't generate captions", color: "red" }),
  });
  const up = useMutation({
    mutationFn: () => uploadCaption(item.id, upLang ?? "en", file as File),
    onSuccess: () => {
      setFile(null);
      invalidate();
    },
    onError: () => notifications.show({ message: "Couldn't upload caption", color: "red" }),
  });
  const del = useMutation({
    mutationFn: (lang: string) => deleteCaption(item.id, lang),
    onSuccess: invalidate,
    onError: () => notifications.show({ message: "Couldn't delete caption", color: "red" }),
  });

  if (!ready) return null;
  const captions = q.data?.captions ?? [];

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Captions
      </Text>
      {captions.length === 0 ? (
        <Text size="xs" c="dimmed">
          No captions yet.
        </Text>
      ) : (
        captions.map((cap: Caption) => (
          <Group key={cap.language} justify="space-between" wrap="nowrap" gap="xs">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Text size="sm" lineClamp={1}>
                {cap.label || cap.language}
              </Text>
              {cap.generated && (
                <Badge size="xs" variant="light" color="grape">
                  auto
                </Badge>
              )}
              <Badge
                size="xs"
                variant="light"
                color={cap.status === "ready" ? "green" : cap.status === "error" ? "red" : "gray"}
              >
                {cap.status}
              </Badge>
            </Group>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`Delete ${cap.label}`}
              loading={del.isPending && del.variables === cap.language}
              onClick={() => del.mutate(cap.language)}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))
      )}

      <Group gap="xs" align="end">
        <Select
          label="Generate (AI)"
          data={GENERATE_LANGUAGES}
          value={genLang}
          onChange={setGenLang}
          allowDeselect={false}
          w={150}
        />
        <Button size="xs" loading={gen.isPending} disabled={!genLang} onClick={() => gen.mutate()}>
          Generate
        </Button>
      </Group>

      <Group gap="xs" align="end">
        <Select
          label="Upload .vtt"
          data={CAPTION_LANGUAGES}
          value={upLang}
          onChange={setUpLang}
          allowDeselect={false}
          w={150}
        />
        <FileInput
          placeholder=".vtt file"
          accept=".vtt,text/vtt"
          value={file}
          onChange={setFile}
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          loading={up.isPending}
          disabled={!upLang || !file}
          onClick={() => up.mutate()}
        >
          Upload
        </Button>
      </Group>
    </Stack>
  );
}
```

- [ ] **Step 2: Wire into `src/components/MediaDetailDrawer.tsx`**

(a) Add `import { VideoCaptionPanel } from "@/components/VideoCaptionPanel";`.
(b) In `VideoDetail`, render `<VideoCaptionPanel item={item} />` immediately after `<VideoDownloadPanel item={item} />`.

- [ ] **Step 3: Verify:** `npm run typecheck` (clean). If a Mantine prop type mismatches (`FileInput` `value`/`onChange` are `File | null`; `Select onChange` is `(value: string | null) => void`; `del.variables` typing), adjust minimally and report. Then `npx oxlint src/components/VideoCaptionPanel.tsx src/components/MediaDetailDrawer.tsx` and `npm run build` (green).

- [ ] **Step 4: Commit**
```bash
git add src/components/VideoCaptionPanel.tsx src/components/MediaDetailDrawer.tsx
git commit -m "feat(client): video captions panel (list/generate/upload/delete)"
```

---

## Task 4: Full verification + changelog

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Full verification**
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: oxlint/Prettier clean (pre-existing warnings only; if `npm run check` reformats files, include them, but `git checkout worker-configuration.d.ts` to avoid generated-file churn), types pass, all Vitest tests pass (existing + caption worker tests), client + SSR build green.

- [ ] **Step 2: Manual pass** (deployed, Access-gated):
1. Open a ready video → "Captions".
2. Generate → pick English → Generate → a caption appears "in progress" → polls → "ready" with an "auto" badge.
3. Upload → pick a language → choose a `.vtt` → Upload → appears "ready".
4. Delete a caption → it disappears.
5. The captions show in the player's track menu.

- [ ] **Step 3: CHANGELOG** — under `## [Unreleased]` → `### Added`:
```markdown
- **Video captions (editing phase, sub-project C):** manage a Stream video's captions from the detail drawer — list (with an auto-generated badge + status), AI-generate captions for a chosen language (Workers AI), upload a `.vtt` file, and delete. The worker proxies Cloudflare's `/stream/:uid/captions` API; the panel polls while a generated caption is processing.
```

- [ ] **Step 4: Commit**
```bash
git add CHANGELOG.md
git commit -m "docs: changelog for video captions"
```

---

## Self-Review

**Spec coverage:** list (normalized) → Task 1 GET; AI generate → Task 1 POST `/generate` (+ docs re-verify Step 6); upload `.vtt` multipart → Task 1 PUT; delete → Task 1 DELETE; `409`/`400`(uid/lang)/`502` + no-captions `404`→empty → Task 1; language lists → Task 2; fetchers + `Caption` type → Task 2; panel (list+auto badge+status+delete, Generate row, Upload row) polling while in-progress, gated to ready videos → Task 3; worker tests → Task 1; manual → Task 4. ✓

**Placeholder scan:** none — complete code/commands. The generate-path/upload-field uncertainties are handled by Task 1 Step 6 (verify-and-adjust).

**Type consistency:** `Caption` matches between worker GET return shape and client `cf-api.ts`. `listCaptions`/`generateCaption(uid,lang)`/`uploadCaption(uid,lang,file)`/`deleteCaption(uid,lang)` (Task 2) match the worker routes (Task 1) and the panel calls (Task 3). `CAPTION_LANGUAGES`/`GENERATE_LANGUAGES` (Task 2) consumed in Task 3. The 32-hex uid guard + `LANG_RE` match the existing route guards. `refetchInterval` error-stop mirrors the downloads panel.
