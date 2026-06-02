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

  it("GET /variants returns full variant defs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              result: {
                variants: {
                  thumbnail: {
                    options: { fit: "cover", metadata: "none", width: 100, height: 100 },
                    neverRequireSignedURLs: true,
                  },
                },
              },
            }),
            { status: 200 },
          ),
      ),
    );
    const res = await app(connectedService).request("/api/images/variants");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      variants: {
        thumbnail: {
          fit: "cover",
          metadata: "none",
          width: 100,
          height: 100,
          neverRequireSignedURLs: true,
        },
      },
    });
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

  it("POST /upload-url mints a direct-upload URL", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: { uploadURL: "https://upload.imagedelivery.net/one-time", id: "newimg" },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await app(connectedService).request("/api/images/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requireSignedURLs: true }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v2/direct_upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("requireSignedURLs")).toBe("true");
    expect(new Headers(init.headers).get("Content-Type")).toBeNull();
    expect(await res.json()).toEqual({
      uploadURL: "https://upload.imagedelivery.net/one-time",
      id: "newimg",
    });
  });

  it("POST /upload-url returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });

  it("GET /:id/transform-download streams the transformed image as an attachment", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/webp" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request(
      "/api/images/img1/transform-download?o=width%3D800%2Cfit%3Dcover&name=img1.webp",
    );
    expect(res.status).toBe(200);
    const [url] = fetchMock.mock.calls[0]! as unknown as [string];
    expect(url).toBe("https://imagedelivery.net/HASH/img1/width=800,fit=cover");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="img1.webp"');
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("GET /:id/transform-download returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/img1/transform-download?o=");
    expect(res.status).toBe(409);
  });

  it("GET /:id/transform-download returns 502 when the upstream fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const res = await app(connectedService).request(
      "/api/images/img1/transform-download?o=width%3D800",
    );
    expect(res.status).toBe(502);
  });

  it("POST /flexible-variants enables via the CF config endpoint and returns status", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const setFlex = vi.fn(async () => {});
    const svc = {
      credentials: async () => creds,
      setFlexibleVariants: setFlex,
      getStatus: async () => ({
        connected: true,
        accountId: "acc1",
        flexibleVariantsEnabled: true,
      }),
    } as unknown as ConnectionService;
    const res = await app(svc).request("/api/images/flexible-variants", { method: "POST" });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/config");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ flexible_variants: true });
    expect(setFlex).toHaveBeenCalledWith(true);
    expect(await res.json()).toEqual({
      connected: true,
      accountId: "acc1",
      flexibleVariantsEnabled: true,
    });
  });

  it("POST /flexible-variants returns 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/flexible-variants", {
      method: "POST",
    });
    expect(res.status).toBe(409);
  });

  it("POST /variants creates a variant", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request("/api/images/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "square",
        fit: "cover",
        width: 512,
        height: 512,
        metadata: "none",
        neverRequireSignedURLs: true,
      }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/variants");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      id: "square",
      options: { fit: "cover", metadata: "none", width: 512, height: 512 },
      neverRequireSignedURLs: true,
    });
  });

  it("POST /variants returns 400 for an invalid fit", async () => {
    const res = await app(connectedService).request("/api/images/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "x", fit: "bogus", metadata: "none" }),
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /variants/:name edits a variant", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request("/api/images/variants/thumbnail", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fit: "contain", metadata: "keep" }),
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/variants/thumbnail",
    );
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      options: { fit: "contain", metadata: "keep" },
      neverRequireSignedURLs: false,
    });
  });

  it("DELETE /variants/public is rejected with 400", async () => {
    const res = await app(connectedService).request("/api/images/variants/public", {
      method: "DELETE",
    });
    expect(res.status).toBe(400);
  });

  it("DELETE /variants/:name deletes a variant", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ success: true, result: {} }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await app(connectedService).request("/api/images/variants/thumbnail", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc1/images/v1/variants/thumbnail",
    );
    expect(init.method).toBe("DELETE");
  });

  it("variant write endpoints return 409 when not connected", async () => {
    const res = await app(disconnectedService).request("/api/images/variants", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(409);
  });
});
