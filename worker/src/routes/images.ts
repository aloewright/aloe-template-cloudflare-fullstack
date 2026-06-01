/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { cfJson } from "../lib/cf";
import { pickImageThumbnail } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;

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
    return c.json({
      images: (result.images ?? []).map(toImageItem),
      continuationToken: result.continuation_token ?? null,
    });
  });

  app.get("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const img = await cfJson<CfImage>(creds, `/images/v1/${c.req.param("id")}`);
    return c.json(toImageItem(img));
  });

  return app;
}
