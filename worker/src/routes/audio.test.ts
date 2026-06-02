/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AudioRow, AudioStore } from "../lib/audio-store";
import { audioRoute } from "./audio";

function fakeStore(seed: AudioRow[] = []) {
  const m = new Map(seed.map((r) => [r.id, r]));
  const store: AudioStore = {
    list: async () => [...m.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    insert: async (r) => void m.set(r.id, r),
    get: async (id) => m.get(id) ?? null,
    rename: async (id, name) => {
      const r = m.get(id);
      if (r) m.set(id, { ...r, name });
    },
    remove: async (id) => void m.delete(id),
  };
  return { store, map: m };
}

function fakeBucket(seed: Record<string, Uint8Array> = {}) {
  const m = new Map(Object.entries(seed));
  const bucket = {
    put: async (key: string, value: unknown) => {
      const buf =
        value instanceof Uint8Array
          ? value
          : new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
      m.set(key, buf);
      return {};
    },
    get: async (key: string, opts?: { range?: { offset?: number; length?: number } }) => {
      const buf = m.get(key);
      if (!buf) return null;
      if (opts?.range) {
        const offset = opts.range.offset ?? 0;
        const end = opts.range.length != null ? offset + opts.range.length : buf.length;
        return { body: new Response(buf.slice(offset, end)).body, size: buf.length };
      }
      return { body: new Response(buf).body, size: buf.length };
    },
    delete: async (key: string) => void m.delete(key),
  };
  return { bucket: bucket as unknown as R2Bucket, map: m };
}

function makeApp(store: AudioStore, bucket: R2Bucket) {
  const a = new Hono();
  a.route(
    "/api/audio",
    audioRoute(() => store),
  );
  return {
    request: (path: string, init?: RequestInit) =>
      a.request(path, init, { AUDIO_BUCKET: bucket } as never),
  };
}

describe("audioRoute list + upload", () => {
  it("POST / stores the object + a row and returns the AudioFile", async () => {
    const { store, map } = fakeStore();
    const { bucket, map: blobs } = fakeBucket();
    const fd = new FormData();
    fd.append("file", new File([new Uint8Array([1, 2, 3, 4])], "song.mp3", { type: "audio/mpeg" }));

    const res = await makeApp(store, bucket).request("/api/audio", { method: "POST", body: fd });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      contentType: string;
      size: number;
      src: string;
    };
    expect(body.name).toBe("song.mp3");
    expect(body.contentType).toBe("audio/mpeg");
    expect(body.size).toBe(4);
    expect(body.src).toBe(`/api/audio/${body.id}`);
    expect(map.size).toBe(1);
    expect(blobs.size).toBe(1);
  });

  it("POST / returns 400 when no file is provided", async () => {
    const { store } = fakeStore();
    const { bucket } = fakeBucket();
    const res = await makeApp(store, bucket).request("/api/audio", {
      method: "POST",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it("GET / lists files with a src URL", async () => {
    const { store } = fakeStore([
      { id: "a1", r2_key: "a1.mp3", name: "One", content_type: "audio/mpeg", size: 10, created_at: "2026-01-01T00:00:00Z" },
    ]);
    const { bucket } = fakeBucket();
    const res = await makeApp(store, bucket).request("/api/audio");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        { id: "a1", name: "One", contentType: "audio/mpeg", size: 10, createdAt: "2026-01-01T00:00:00Z", src: "/api/audio/a1" },
      ],
    });
  });
});
