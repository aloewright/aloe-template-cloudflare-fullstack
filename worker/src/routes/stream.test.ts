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
});
