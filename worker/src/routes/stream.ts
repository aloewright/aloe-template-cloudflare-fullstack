/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { type CfCreds, cfFetch, cfJson } from "../lib/cf";
import { parseStreamCode } from "../lib/urls";
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
      .json<{ name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean }>()
      .catch(
        () => ({}) as { name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean },
      );
    const updateBody: Record<string, unknown> = {};
    // Only send meta when the caller provided some, so a requireSignedURLs-only
    // update never wipes existing video metadata.
    if (body.meta !== undefined || body.name !== undefined) {
      updateBody.meta = { ...body.meta, ...(body.name !== undefined ? { name: body.name } : {}) };
    }
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

  return app;
}
