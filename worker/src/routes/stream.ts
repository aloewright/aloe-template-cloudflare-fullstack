/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { cfJson } from "../lib/cf";
import { parseStreamCode, streamIframeUrl } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;
const PAGE = 50;

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
    const last = videos[videos.length - 1];
    const nextCursor = videos.length === PAGE && last?.created ? last.created : null;
    return c.json({ videos: items, cursor: nextCursor });
  });

  app.get("/:uid", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const video = await cfJson<CfVideo>(creds, `/stream/${c.req.param("uid")}`);
    return c.json(toStreamItem(video));
  });

  return app;
}
