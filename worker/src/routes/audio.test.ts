/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AudioRow, AudioStore } from "../lib/audio-store";
import { audioRoute } from "./audio";

function fakeStore(seed: AudioRow[] = []) {
  const m = new Map(seed.map((r) => [r.id, r]));
  const store: AudioStore = {
    list: async () => [...m.values()].toSorted((a, b) => b.created_at.localeCompare(a.created_at)),
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
        return {
          body: new Response(buf.slice(offset, end) as unknown as BodyInit).body,
          size: buf.length,
        };
      }
      return { body: new Response(buf as unknown as BodyInit).body, size: buf.length };
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
      {
        id: "a1",
        r2_key: "a1.mp3",
        name: "One",
        content_type: "audio/mpeg",
        size: 10,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const { bucket } = fakeBucket();
    const res = await makeApp(store, bucket).request("/api/audio");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      files: [
        {
          id: "a1",
          name: "One",
          contentType: "audio/mpeg",
          size: 10,
          createdAt: "2026-01-01T00:00:00Z",
          src: "/api/audio/a1",
        },
      ],
    });
  });
});

describe("audioRoute stream + edit", () => {
  const row: AudioRow = {
    id: "a1",
    r2_key: "a1.mp3",
    name: "One",
    content_type: "audio/mpeg",
    size: 4,
    created_at: "2026-01-01T00:00:00Z",
  };

  it("GET /:id streams the object with Accept-Ranges", async () => {
    const { store } = fakeStore([row]);
    const { bucket } = fakeBucket({ "a1.mp3": new Uint8Array([1, 2, 3, 4]) });
    const res = await makeApp(store, bucket).request("/api/audio/a1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Accept-Ranges")).toBe("bytes");
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(res.headers.get("Content-Length")).toBe("4");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("GET /:id honors a Range header with 206", async () => {
    const { store } = fakeStore([row]);
    const { bucket } = fakeBucket({ "a1.mp3": new Uint8Array([1, 2, 3, 4]) });
    const res = await makeApp(store, bucket).request("/api/audio/a1", {
      headers: { Range: "bytes=1-2" },
    });
    expect(res.status).toBe(206);
    expect(res.headers.get("Content-Range")).toBe("bytes 1-2/4");
    expect(res.headers.get("Content-Length")).toBe("2");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([2, 3]));
  });

  it("GET /:id returns 404 for an unknown id", async () => {
    const { store } = fakeStore();
    const { bucket } = fakeBucket();
    const res = await makeApp(store, bucket).request("/api/audio/nope");
    expect(res.status).toBe(404);
  });

  it("PATCH /:id renames; 400 on empty; 404 on unknown", async () => {
    const { store, map } = fakeStore([{ ...row }]);
    const { bucket } = fakeBucket();
    const app = makeApp(store, bucket);
    const ok = await app.request("/api/audio/a1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(ok.status).toBe(200);
    expect(map.get("a1")?.name).toBe("Renamed");

    const empty = await app.request("/api/audio/a1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "  " }),
    });
    expect(empty.status).toBe(400);

    const missing = await app.request("/api/audio/nope", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X" }),
    });
    expect(missing.status).toBe(404);
  });

  it("DELETE /:id removes the object + row", async () => {
    const { store, map } = fakeStore([{ ...row }]);
    const { bucket, map: blobs } = fakeBucket({ "a1.mp3": new Uint8Array([1]) });
    const res = await makeApp(store, bucket).request("/api/audio/a1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(map.size).toBe(0);
    expect(blobs.size).toBe(0);
  });
});
