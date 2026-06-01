/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../services/connection";
import { imagesRoute } from "./images";

const creds = { accountId: "acc1", token: "tok1", accountHash: "HASH", streamCode: null };
const connectedService = { credentials: async () => creds } as unknown as ConnectionService;
const disconnectedService = { credentials: async () => null } as unknown as ConnectionService;

function app(service: ConnectionService) {
  const a = new Hono();
  a.route(
    "/api/images",
    imagesRoute(() => service),
  );
  return a;
}

afterEach(() => vi.unstubAllGlobals());

describe("imagesRoute", () => {
  it("returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images");
    expect(res.status).toBe(409);
  });

  it("lists and normalizes images", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              result: {
                images: [
                  {
                    id: "img1",
                    filename: "cat.png",
                    uploaded: "2026-01-01T00:00:00Z",
                    requireSignedURLs: false,
                    meta: { a: "b" },
                    variants: [
                      "https://imagedelivery.net/HASH/img1/w=99",
                      "https://imagedelivery.net/HASH/img1/public",
                    ],
                  },
                ],
                continuation_token: "next123",
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const res = await app(connectedService).request("/api/images");
    const body = (await res.json()) as {
      images: Array<{ id: string; filename: string; thumbnailUrl: string }>;
      continuationToken: string | null;
    };
    expect(body.continuationToken).toBe("next123");
    expect(body.images[0]).toMatchObject({
      id: "img1",
      filename: "cat.png",
      thumbnailUrl: "https://imagedelivery.net/HASH/img1/public",
    });
  });

  it("maps variant definitions to dimensions (and is not shadowed by /:id)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              result: {
                variants: {
                  FHD: { options: { width: 1920, height: 1080, fit: "scale-down" } },
                  public: { options: { fit: "scale-down" } },
                },
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const res = await app(connectedService).request("/api/images/variants");
    const body = (await res.json()) as {
      variants: Record<string, { width: number | null; height: number | null }>;
    };
    expect(res.status).toBe(200);
    expect(body.variants.FHD).toEqual({ width: 1920, height: 1080 });
    expect(body.variants.public).toEqual({ width: null, height: null });
  });

  it("PATCH composes metadata (incl. name) + requireSignedURLs and returns the item", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: {
              id: "img1",
              filename: "cat.png",
              requireSignedURLs: true,
              meta: { name: "Kitty", tag: "x" },
              variants: ["https://imagedelivery.net/HASH/img1/public"],
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connectedService).request("/api/images/img1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Kitty", meta: { tag: "x" }, requireSignedURLs: true }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/img1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      metadata: { tag: "x", name: "Kitty" },
      requireSignedURLs: true,
    });
    const body = (await res.json()) as { id: string; meta: Record<string, string> };
    expect(body.id).toBe("img1");
    expect(body.meta.name).toBe("Kitty");
  });

  it("DELETE calls the CF delete endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connectedService).request("/api/images/img1", { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/img1");
    expect(init.method).toBe("DELETE");
  });

  it("PATCH returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/img1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });
});
