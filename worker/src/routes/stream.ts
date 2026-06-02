/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { type CfCreds, CfApiError, cfFetch, cfJson } from "../lib/cf";
import { parseStreamCode, sanitizeDownloadFilename } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;
const PAGE = 50;

type StreamLink = { label: string; sublabel: string; url: string };

// Build the standard delivery URLs for a Stream video. `ref` is the video uid
// (public) or a signed token (private). All routes hang off the same host.
function streamLinks(
  code: string,
  ref: string,
): { thumbnail: string; iframeUrl: string; links: StreamLink[] } {
  const host = `https://customer-${code}.cloudflarestream.com/${ref}`;
  return {
    thumbnail: `${host}/thumbnails/thumbnail.jpg`,
    iframeUrl: `${host}/iframe`,
    links: [
      { label: "HLS", sublabel: "adaptive .m3u8", url: `${host}/manifest/video.m3u8` },
      { label: "DASH", sublabel: "adaptive .mpd", url: `${host}/manifest/video.mpd` },
      { label: "Embed", sublabel: "iframe", url: `${host}/iframe` },
      { label: "Thumbnail", sublabel: ".jpg", url: `${host}/thumbnails/thumbnail.jpg` },
    ],
  };
}

// Private Stream videos need a signed token; rewrite the thumbnail/iframe and
// all delivery links to route through a per-video token so they work. Mints
// tokens in parallel; failures leave the item's unsigned URLs untouched.
async function signStreamItems(
  items: StreamItem[],
  creds: CfCreds & { streamCode: string | null },
): Promise<void> {
  const targets = items.filter((i) => i.requireSignedURLs);
  if (targets.length === 0) return;
  await Promise.all(
    targets.map(async (it) => {
      try {
        const res = await cfJson<{ token?: string }>(creds, `/stream/${it.uid}/token`, {
          method: "POST",
          body: "{}",
        });
        const token = res.token;
        const code =
          creds.streamCode ?? parseStreamCode(it.thumbnail) ?? parseStreamCode(it.iframeUrl);
        if (!token || !code) return;
        const built = streamLinks(code, token);
        it.thumbnail = built.thumbnail;
        it.iframeUrl = built.iframeUrl;
        it.links = built.links;
      } catch {
        // leave unsigned URLs; the UI surfaces a notice for unplayable items
      }
    }),
  );
}

type CfCaption = { language?: string; label?: string; generated?: boolean; status?: string };
const LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;

type CfDownload = { status?: string; url?: string; percentComplete?: number };
type CfDownloads = { default?: CfDownload; audio?: CfDownload };
type DownloadInfo = { status: string; percentComplete: number; url: string | null };

type CfVideo = {
  uid: string;
  meta?: Record<string, string>;
  thumbnail?: string;
  playback?: { hls?: string };
  duration?: number;
  input?: { width?: number; height?: number };
  status?: { state?: string };
  readyToStream?: boolean;
  requireSignedURLs?: boolean;
  thumbnailTimestampPct?: number;
  allowedOrigins?: string[];
  created?: string;
};

type StreamItem = {
  uid: string;
  name: string;
  thumbnail: string;
  duration: number;
  width: number | null;
  height: number | null;
  status: string;
  readyToStream: boolean;
  requireSignedURLs: boolean;
  thumbnailTimestampPct: number;
  allowedOrigins: string[];
  iframeUrl: string;
  links: StreamLink[];
  meta: Record<string, string>;
  created: string;
};

function toStreamItem(v: CfVideo): StreamItem {
  const code = parseStreamCode(v.thumbnail || v.playback?.hls || "");
  const built = code ? streamLinks(code, v.uid) : null;
  return {
    uid: v.uid,
    name: v.meta?.name ?? v.uid,
    thumbnail: v.thumbnail ?? built?.thumbnail ?? "",
    duration: v.duration ?? 0,
    width: v.input?.width ?? null,
    height: v.input?.height ?? null,
    status: v.status?.state ?? "unknown",
    readyToStream: v.readyToStream ?? false,
    requireSignedURLs: v.requireSignedURLs ?? false,
    thumbnailTimestampPct: v.thumbnailTimestampPct ?? 0,
    allowedOrigins: v.allowedOrigins ?? [],
    iframeUrl: built?.iframeUrl ?? "",
    links: built?.links ?? [],
    meta: v.meta ?? {},
    created: v.created ?? "",
  };
}

// UTF-8-safe base64 for TUS Upload-Metadata values.
const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));

export function streamRoute(makeService: MakeService) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const qs = new URLSearchParams({ limit: String(PAGE), asc: "false" });
    const cursor = c.req.query("cursor");
    if (cursor) qs.set("before", cursor);
    const videos = await cfJson<CfVideo[]>(creds, `/stream?${qs}`);
    const items = videos.map(toStreamItem);
    await signStreamItems(items, creds);
    const last = videos[videos.length - 1];
    const nextCursor = videos.length === PAGE && last?.created ? last.created : null;
    return c.json({ videos: items, cursor: nextCursor });
  });

  app.get("/:uid", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const video = await cfJson<CfVideo>(creds, `/stream/${c.req.param("uid")}`);
    const item = toStreamItem(video);
    await signStreamItems([item], creds);
    return c.json(item);
  });

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

  app.delete("/:uid", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    await cfJson(creds, `/stream/${c.req.param("uid")}`, { method: "DELETE" });
    return c.json({ ok: true });
  });

  app.post("/upload-url", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{ uploadLength?: number; name?: string; requireSignedURLs?: boolean }>()
      .catch(() => ({}) as { uploadLength?: number; name?: string; requireSignedURLs?: boolean });
    if (!body.uploadLength || body.uploadLength <= 0) {
      return c.json({ error: "uploadLength is required" }, 400);
    }
    const meta = [`maxDurationSeconds ${b64("21600")}`];
    if (body.name) meta.push(`name ${b64(body.name)}`);
    if (body.requireSignedURLs) meta.push(`requiresignedurls ${b64("true")}`);
    const res = await cfFetch(creds, "/stream?direct_user=true", {
      method: "POST",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(body.uploadLength),
        "Upload-Metadata": meta.join(","),
      },
    });
    const uploadURL = res.headers.get("Location");
    if (!res.ok || !uploadURL) return c.json({ error: "Failed to create upload" }, 502);
    const uid = res.headers.get("stream-media-id") ?? uploadURL.split("/").pop() ?? "";
    return c.json({ uploadURL, uid });
  });

  app.post("/:uid/clip", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const uid = c.req.param("uid");
    if (!/^[0-9a-f]{32}$/i.test(uid)) return c.json({ error: "Invalid uid" }, 400);
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
          clippedFromVideoUID: uid,
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

    const code = creds.streamCode ?? parseStreamCode(video.thumbnail || video.playback?.hls || "");
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
    const type = c.req.query("type") ?? "default";
    if (type !== "default" && type !== "audio") {
      return c.json({ error: "Invalid type" }, 400);
    }
    try {
      await cfJson(creds, `/stream/${uid}/downloads/${type}`, { method: "DELETE" });
    } catch {
      return c.json({ error: "Failed to remove download" }, 502);
    }
    return c.json({ ok: true });
  });

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

  return app;
}
