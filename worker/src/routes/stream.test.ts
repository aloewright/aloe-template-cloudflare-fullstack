/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../services/connection";
import { streamRoute } from "./stream";

const creds = { accountId: "acc1", token: "tok1", accountHash: null, streamCode: "CODE" };
const connected = { credentials: async () => creds } as unknown as ConnectionService;
const disconnected = { credentials: async () => null } as unknown as ConnectionService;

function app(service: ConnectionService) {
  const a = new Hono();
  a.route(
    "/api/stream",
    streamRoute(() => service),
  );
  return a;
}

afterEach(() => vi.unstubAllGlobals());

describe("streamRoute", () => {
  it("returns 409 when not connected", async () => {
    const res = await app(disconnected).request("/api/stream");
    expect(res.status).toBe(409);
  });

  it("lists and normalizes videos with an iframe URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              result: [
                {
                  uid: "vid1",
                  meta: { name: "Clip One" },
                  thumbnail:
                    "https://customer-CODE.cloudflarestream.com/vid1/thumbnails/thumbnail.jpg",
                  duration: 12.5,
                  status: { state: "ready" },
                  readyToStream: true,
                  requireSignedURLs: false,
                  thumbnailTimestampPct: 0.5,
                  created: "2026-01-01T00:00:00Z",
                },
              ],
            }),
            { status: 200 },
          ),
      ),
    );

    const res = await app(connected).request("/api/stream");
    const body = (await res.json()) as {
      videos: Array<{ uid: string; name: string; status: string; iframeUrl: string }>;
      cursor: string | null;
    };
    expect(body.videos[0]).toMatchObject({
      uid: "vid1",
      name: "Clip One",
      status: "ready",
      iframeUrl: "https://customer-CODE.cloudflarestream.com/vid1/iframe",
    });
    expect(body.cursor).toBeNull();
  });

  it("PATCH composes meta (incl. name) via CF POST and returns the item", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              uid: "vid1",
              meta: { name: "Renamed", tag: "y" },
              thumbnail: "https://customer-CODE.cloudflarestream.com/vid1/thumbnails/thumbnail.jpg",
              status: { state: "ready" },
              readyToStream: true,
              requireSignedURLs: false,
              created: "2026-01-01T00:00:00Z",
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request("/api/stream/vid1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", meta: { tag: "y" }, requireSignedURLs: false }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream/vid1");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      meta: { tag: "y", name: "Renamed" },
      requireSignedURLs: false,
    });
    const body = (await res.json()) as { uid: string; name: string };
    expect(body.uid).toBe("vid1");
    expect(body.name).toBe("Renamed");
  });

  it("DELETE calls the CF stream delete endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request("/api/stream/vid1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream/vid1");
    expect(init.method).toBe("DELETE");
  });

  it("PATCH returns 409 when not connected", async () => {
    const res = await app(disconnected).request("/api/stream/vid1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  it("POST /upload-url performs TUS creation and returns the Location + uid", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 201,
          headers: {
            Location: "https://upload.videodelivery.net/tus-abc123",
            "stream-media-id": "abc123",
          },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request("/api/stream/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadLength: 12345, name: "clip.mp4", requireSignedURLs: true }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream?direct_user=true");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Tus-Resumable")).toBe("1.0.0");
    expect(headers.get("Upload-Length")).toBe("12345");
    const meta = headers.get("Upload-Metadata") ?? "";
    expect(meta).toContain("requiresignedurls");
    expect(meta).toContain("name ");
    expect(await res.json()).toEqual({
      uploadURL: "https://upload.videodelivery.net/tus-abc123",
      uid: "abc123",
    });
  });

  it("POST /upload-url returns 400 without uploadLength, 409 when not connected", async () => {
    const r400 = await app(connected).request("/api/stream/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r400.status).toBe(400);
    const r409 = await app(disconnected).request("/api/stream/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadLength: 1 }),
    });
    expect(r409.status).toBe(409);
  });

  it("POST /:uid/clip creates a clip and returns the new item", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              uid: "newclip",
              meta: { name: "My clip" },
              duration: 15,
              readyToStream: false,
              status: { state: "queued" },
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request("/api/stream/0ea62994907491cf9ebefb0a34c1e2c6/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTimeSeconds: 10, endTimeSeconds: 25, name: "My clip" }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/stream/clip");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      clippedFromVideoUID: "0ea62994907491cf9ebefb0a34c1e2c6",
      startTimeSeconds: 10,
      endTimeSeconds: 25,
      meta: { name: "My clip" },
    });
    const json = (await res.json()) as { uid: string; name: string };
    expect(json.uid).toBe("newclip");
    expect(json.name).toBe("My clip");
  });

  it("POST /:uid/clip returns 400 when end <= start", async () => {
    const res = await app(connected).request("/api/stream/0ea62994907491cf9ebefb0a34c1e2c6/clip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTimeSeconds: 30, endTimeSeconds: 30 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /:uid/clip returns 409 when not connected", async () => {
    const res = await app(disconnected).request(
      "/api/stream/0ea62994907491cf9ebefb0a34c1e2c6/clip",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTimeSeconds: 0, endTimeSeconds: 5 }),
      },
    );
    expect(res.status).toBe(409);
  });

  const UID = "0ea62994907491cf9ebefb0a34c1e2c6";

  it("GET /:uid/downloads (public) returns statuses + a uid-based ready URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/downloads"))
        return new Response(
          JSON.stringify({
            success: true,
            result: {
              default: { status: "ready", percentComplete: 100, url: "ignored" },
              audio: { status: "inprogress", percentComplete: 40, url: "ignored" },
            },
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            uid: UID,
            requireSignedURLs: false,
            meta: { name: "My Vid.mp4" },
            thumbnail: "",
          },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request(`/api/stream/${UID}/downloads`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      default: { status: string; url: string | null };
      audio: { status: string; url: string | null };
    };
    expect(body.default.status).toBe("ready");
    expect(body.default.url).toBe(
      `https://customer-CODE.cloudflarestream.com/${UID}/downloads/default.mp4?filename=My_Vid`,
    );
    expect(body.audio.status).toBe("inprogress");
    expect(body.audio.url).toBeNull();
  });

  it("GET /:uid/downloads (signed) mints a downloadable token and uses it in the URL", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/downloads"))
        return new Response(
          JSON.stringify({
            success: true,
            result: { default: { status: "ready", percentComplete: 100, url: "x" } },
          }),
          { status: 200 },
        );
      if (url.endsWith("/token"))
        return new Response(JSON.stringify({ success: true, result: { token: "TOKENXYZ" } }), {
          status: 200,
        });
      return new Response(
        JSON.stringify({
          success: true,
          result: { uid: UID, requireSignedURLs: true, meta: { name: "Clip" }, thumbnail: "" },
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connected).request(`/api/stream/${UID}/downloads`);
    expect(res.status).toBe(200);
    const tokenCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/token"),
    )! as unknown as [string, RequestInit];
    expect(tokenCall[1].method).toBe("POST");
    expect(JSON.parse(tokenCall[1].body as string)).toEqual({ downloadable: true });
    const body = (await res.json()) as { default: { url: string | null } };
    expect(body.default.url).toBe(
      `https://customer-CODE.cloudflarestream.com/TOKENXYZ/downloads/default.mp4?filename=Clip`,
    );
  });

  it("POST /:uid/downloads enables the requested type", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await app(connected).request(`/api/stream/${UID}/downloads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "audio" }),
    });
    const [postUrl, postInit] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(String(postUrl)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc1/stream/${UID}/downloads/audio`,
    );
    expect(postInit.method).toBe("POST");
  });

  it("DELETE /:uid/downloads?type=audio removes that download", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connected).request(`/api/stream/${UID}/downloads?type=audio`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const [delUrl, delInit] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(String(delUrl)).toBe(
      `https://api.cloudflare.com/client/v4/accounts/acc1/stream/${UID}/downloads/audio`,
    );
    expect(delInit.method).toBe("DELETE");
  });

  it("downloads endpoints return 409 when not connected", async () => {
    const res = await app(disconnected).request(`/api/stream/${UID}/downloads`);
    expect(res.status).toBe(409);
  });
});
