/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { type CfCreds, cfJson } from "../lib/cf";
import { signImageUrl } from "../lib/sign";
import { pickImageThumbnail } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;

// Cache the account's Images signing key for the isolate's lifetime so we
// don't refetch it on every request when signing private-image thumbnails.
let signingKeyCache: string | null = null;
async function getSigningKey(creds: CfCreds): Promise<string | null> {
  if (signingKeyCache) return signingKeyCache;
  try {
    const res = await cfJson<{ keys?: Array<{ value?: string }> }>(creds, "/images/v1/keys");
    signingKeyCache = res.keys?.[0]?.value ?? null;
    return signingKeyCache;
  } catch {
    return null;
  }
}

// Sign the thumbnail URLs of any items that require signed delivery, in place.
async function signThumbnails(items: ImageItem[], creds: CfCreds): Promise<void> {
  if (!items.some((i) => i.requireSignedURLs && i.thumbnailUrl)) return;
  const key = await getSigningKey(creds);
  if (!key) return;
  const now = Math.floor(Date.now() / 1000);
  const day = 60 * 60 * 24;
  for (const it of items) {
    if (it.requireSignedURLs && it.thumbnailUrl) {
      it.thumbnailUrl = await signImageUrl(it.thumbnailUrl, key, day, now);
    }
  }
}

type CfImage = {
  id: string;
  filename?: string;
  uploaded?: string;
  requireSignedURLs?: boolean;
  meta?: Record<string, string>;
  variants?: string[];
};

type ImageItem = {
  id: string;
  filename: string;
  uploaded: string;
  requireSignedURLs: boolean;
  meta: Record<string, string>;
  variants: string[];
  thumbnailUrl: string;
};

function toImageItem(img: CfImage): ImageItem {
  const variants = img.variants ?? [];
  return {
    id: img.id,
    filename: img.filename ?? img.id,
    uploaded: img.uploaded ?? "",
    requireSignedURLs: img.requireSignedURLs ?? false,
    meta: img.meta ?? {},
    variants,
    thumbnailUrl: pickImageThumbnail(variants),
  };
}

export function imagesRoute(makeService: MakeService) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const qs = new URLSearchParams({ per_page: "50" });
    const cursor = c.req.query("cursor");
    if (cursor) qs.set("continuation_token", cursor);
    const result = await cfJson<{ images?: CfImage[]; continuation_token?: string | null }>(
      creds,
      `/images/v2?${qs}`,
    );
    const images = (result.images ?? []).map(toImageItem);
    await signThumbnails(images, creds);
    return c.json({ images, continuationToken: result.continuation_token ?? null });
  });

  app.get("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const img = await cfJson<CfImage>(creds, `/images/v1/${c.req.param("id")}`);
    const item = toImageItem(img);
    await signThumbnails([item], creds);
    return c.json(item);
  });

  return app;
}
