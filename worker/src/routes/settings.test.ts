/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inMemoryConnectionStore } from "../lib/connection-store";
import { createConnectionService } from "../services/connection";
import { settingsRoute } from "./settings";

function appWithFakeService() {
  const service = createConnectionService(inMemoryConnectionStore(), "enc-key");
  const app = new Hono();
  app.route(
    "/api/settings",
    settingsRoute(() => service),
  );
  return app;
}

function cfOk() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/images/v2")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: { images: [{ variants: ["https://imagedelivery.net/HASH/i/public"] }] },
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("settingsRoute", () => {
  it("GET reports disconnected before any save", async () => {
    const res = await appWithFakeService().request("/api/settings");
    expect(await res.json()).toEqual({ connected: false });
  });

  it("PUT validates+saves and never echoes the token", async () => {
    vi.stubGlobal("fetch", cfOk());
    const app = appWithFakeService();
    const res = await app.request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "acc1", token: "secret" }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ connected: true, accountId: "acc1" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("PUT returns 400 when fields are missing", async () => {
    const res = await appWithFakeService().request("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "acc1" }),
    });
    expect(res.status).toBe(400);
  });
});
