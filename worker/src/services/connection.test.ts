/* AGPL-3.0-or-later */
import { afterEach, describe, expect, it, vi } from "vitest";
import { inMemoryConnectionStore } from "../lib/connection-store";
import { createConnectionService } from "./connection";

const ENC = "enc-key";

function cfMock() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/images/v2")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: { images: [{ variants: ["https://imagedelivery.net/HASH/id/public"] }] },
        }),
        { status: 200 },
      );
    }
    if (url.includes("/stream")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: [
            {
              thumbnail: "https://customer-CODE.cloudflarestream.com/uid/thumbnails/thumbnail.jpg",
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ success: false, errors: [] }), { status: 404 });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("connectionService", () => {
  it("reports disconnected initially", async () => {
    const svc = createConnectionService(inMemoryConnectionStore(), ENC);
    expect(await svc.getStatus()).toEqual({ connected: false });
  });

  it("connects: validates, discovers hash/code, stores encrypted token", async () => {
    vi.stubGlobal("fetch", cfMock());
    const store = inMemoryConnectionStore();
    const svc = createConnectionService(store, ENC);

    const status = await svc.connect({ accountId: "acc1", token: "secret" });
    expect(status).toMatchObject({
      connected: true,
      accountId: "acc1",
      accountHash: "HASH",
      streamCode: "CODE",
    });

    const stored = await store.get();
    expect(stored?.tokenCipher).toBeTruthy();
    expect(stored?.tokenCipher).not.toContain("secret");
  });

  it("decrypts credentials for proxying", async () => {
    vi.stubGlobal("fetch", cfMock());
    const svc = createConnectionService(inMemoryConnectionStore(), ENC);
    await svc.connect({ accountId: "acc1", token: "secret" });
    expect(await svc.credentials()).toMatchObject({ accountId: "acc1", token: "secret" });
  });

  it("rejects a token that fails every probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 403 })),
    );
    const svc = createConnectionService(inMemoryConnectionStore(), ENC);
    await expect(svc.connect({ accountId: "acc1", token: "bad" })).rejects.toBeTruthy();
  });
});
