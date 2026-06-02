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

  return app;
}
