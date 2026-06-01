/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { type CfCreds, cfJson } from "../lib/cf";
import { parseStreamCode, streamIframeUrl } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;
const PAGE = 50;

// Private Stream videos need a signed token; rewrite the thumbnail + iframe
// URLs to route through a per-video token so they load. Mints tokens in
// parallel; failures leave the item's unsigned URLs (which 401) untouched.
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
        const code = creds.streamCode ?? parseStreamCode(it.thumbnail) ?? parseStreamCode(it.iframeUrl);
        if (!token || !code) return;
        const host = `https://customer-${code}.cloudflarestream.com/${token}`;
        it.thumbnail = `${host}/thumbnails/thumbnail.jpg`;
        it.iframeUrl = `${host}/iframe`;
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
  status: string;
  readyToStream: boolean;
  requireSignedURLs: boolean;
  thumbnailTimestampPct: number;
  iframeUrl: string;
  meta: Record<string, string>;
  created: string;
};

function toStreamItem(v: CfVideo): StreamItem {
  const code = parseStreamCode(v.thumbnail || v.playback?.hls || "");
  return {
    uid: v.uid,
    name: v.meta?.name ?? v.uid,
    thumbnail: v.thumbnail ?? "",
    duration: v.duration ?? 0,
    status: v.status?.state ?? "unknown",
    readyToStream: v.readyToStream ?? false,
    requireSignedURLs: v.requireSignedURLs ?? false,
    thumbnailTimestampPct: v.thumbnailTimestampPct ?? 0,
    iframeUrl: code ? streamIframeUrl(code, v.uid) : "",
    meta: v.meta ?? {},
    created: v.created ?? "",
  };
}

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

  return app;
}
