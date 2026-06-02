/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { type CfCreds, cfJson } from "../lib/cf";
import { signImageUrl } from "../lib/sign";
import { pickImageThumbnail } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;
const DAY = 60 * 60 * 24;

// Cache the account's Images signing key for the isolate's lifetime so we
// don't refetch it on every request when signing private-image URLs.
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

// Sign just the thumbnail URLs (for grid/table) of private images, in place.
async function signThumbnails(items: ImageItem[], creds: CfCreds): Promise<void> {
  if (!items.some((i) => i.requireSignedURLs && i.thumbnailUrl)) return;
  const key = await getSigningKey(creds);
  if (!key) return;
  const now = Math.floor(Date.now() / 1000);
  for (const it of items) {
    if (it.requireSignedURLs && it.thumbnailUrl) {
      it.thumbnailUrl = await signImageUrl(it.thumbnailUrl, key, DAY, now);
    }
  }
}

// Sign the thumbnail AND every variant URL of a private image (for the detail
// drawer, where the user copies per-variant URLs that must actually work).
async function signItemFull(item: ImageItem, creds: CfCreds): Promise<void> {
  if (!item.requireSignedURLs) return;
  const key = await getSigningKey(creds);
  if (!key) return;
  const now = Math.floor(Date.now() / 1000);
  if (item.thumbnailUrl) item.thumbnailUrl = await signImageUrl(item.thumbnailUrl, key, DAY, now);
  item.variants = await Promise.all(item.variants.map((v) => signImageUrl(v, key, DAY, now)));
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

type CfVariants = {
  variants?: Record<string, { options?: { width?: number; height?: number; fit?: string } }>;
};

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

  // Variant definitions → name -> { width, height } so the UI can label each
  // variant by its configured resolution. Registered before "/:id".
  app.get("/variants", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const res = await cfJson<CfVariants>(creds, "/images/v1/variants");
    const variants: Record<string, { width: number | null; height: number | null }> = {};
    for (const [name, def] of Object.entries(res.variants ?? {})) {
      variants[name] = { width: def.options?.width ?? null, height: def.options?.height ?? null };
    }
    return c.json({ variants });
  });

  app.get("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const img = await cfJson<CfImage>(creds, `/images/v1/${c.req.param("id")}`);
    const item = toImageItem(img);
    await signItemFull(item, creds);
    return c.json(item);
  });

  app.patch("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{ name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean }>()
      .catch(
        () => ({}) as { name?: string; meta?: Record<string, string>; requireSignedURLs?: boolean },
      );
    const patchBody: Record<string, unknown> = {};
    // Only send metadata when the caller actually provided some, so a
    // requireSignedURLs-only update never wipes existing metadata.
    if (body.meta !== undefined || body.name !== undefined) {
      patchBody.metadata = {
        ...body.meta,
        ...(body.name !== undefined ? { name: body.name } : {}),
      };
    }
    if (body.requireSignedURLs !== undefined) patchBody.requireSignedURLs = body.requireSignedURLs;
    const img = await cfJson<CfImage>(creds, `/images/v1/${c.req.param("id")}`, {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    });
    const item = toImageItem(img);
    await signItemFull(item, creds);
    return c.json(item);
  });

  app.delete("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    await cfJson(creds, `/images/v1/${c.req.param("id")}`, { method: "DELETE" });
    return c.json({ ok: true });
  });

  app.post("/upload-url", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const body = await c.req
      .json<{ requireSignedURLs?: boolean }>()
      .catch(() => ({}) as { requireSignedURLs?: boolean });
    // CF Images direct_upload expects multipart/form-data, not JSON.
    const form = new FormData();
    form.append("requireSignedURLs", String(body.requireSignedURLs ?? false));
    const result = await cfJson<{ uploadURL: string; id: string }>(
      creds,
      "/images/v2/direct_upload",
      {
        method: "POST",
        body: form,
      },
    );
    return c.json({ uploadURL: result.uploadURL, id: result.id });
  });

  return app;
}
