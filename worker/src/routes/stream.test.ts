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
});
