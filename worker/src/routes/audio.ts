/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { AudioRow, AudioStore } from "../lib/audio-store";
import type { AppEnv } from "../types";

type MakeStore = (env: AppEnv["Bindings"]) => AudioStore;

export type AudioFile = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
  src: string;
};

const toAudioFile = (r: AudioRow): AudioFile => ({
  id: r.id,
  name: r.name,
  contentType: r.content_type,
  size: r.size,
  createdAt: r.created_at,
  src: `/api/audio/${r.id}`,
});

export function audioRoute(makeStore: MakeStore) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const rows = await makeStore(c.env).list();
    return c.json({ files: rows.map(toAudioFile) });
  });

  app.post("/", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "file is required" }, 400);
    const id = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase() : "";
    const r2_key = `${id}${ext}`;
    const contentType = file.type || "application/octet-stream";
    await c.env.AUDIO_BUCKET.put(r2_key, file, { httpMetadata: { contentType } });
    const row: AudioRow = {
      id,
      r2_key,
      name: ((form?.get("name") as string | null) || file.name).trim() || file.name,
      content_type: contentType,
      size: file.size,
      created_at: new Date().toISOString(),
    };
    await makeStore(c.env).insert(row);
    return c.json(toAudioFile(row));
  });

  app.get("/:id", async (c) => {
    const row = await makeStore(c.env).get(c.req.param("id"));
    if (!row) return c.json({ error: "Not found" }, 404);
    const rangeHeader = c.req.header("Range");
    if (rangeHeader) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
      if (!m) return c.json({ error: "Range not satisfiable" }, 416);
      const start = Number(m[1]);
      const end = m[2] ? Number(m[2]) : row.size - 1;
      if (Number.isNaN(start) || start >= row.size || start > end) {
        return c.json({ error: "Range not satisfiable" }, 416);
      }
      const length = Math.min(end, row.size - 1) - start + 1;
      const obj = await c.env.AUDIO_BUCKET.get(row.r2_key, { range: { offset: start, length } });
      if (!obj?.body) return c.json({ error: "Not found" }, 404);
      return new Response(obj.body, {
        status: 206,
        headers: {
          "Content-Type": row.content_type,
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${start + length - 1}/${row.size}`,
          "Accept-Ranges": "bytes",
        },
      });
    }
    const obj = await c.env.AUDIO_BUCKET.get(row.r2_key);
    if (!obj?.body) return c.json({ error: "Not found" }, 404);
    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": row.content_type,
        "Content-Length": String(row.size),
        "Accept-Ranges": "bytes",
      },
    });
  });

  app.patch("/:id", async (c) => {
    const store = makeStore(c.env);
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
    const name = (body.name ?? "").trim();
    if (!name) return c.json({ error: "name is required" }, 400);
    const row = await store.get(id);
    if (!row) return c.json({ error: "Not found" }, 404);
    await store.rename(id, name);
    return c.json(toAudioFile({ ...row, name }));
  });

  app.delete("/:id", async (c) => {
    const store = makeStore(c.env);
    const id = c.req.param("id");
    const row = await store.get(id);
    if (row) {
      await c.env.AUDIO_BUCKET.delete(row.r2_key);
      await store.remove(id);
    }
    return c.json({ ok: true });
  });

  return app;
}
