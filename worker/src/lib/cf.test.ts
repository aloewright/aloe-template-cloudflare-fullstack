/* AGPL-3.0-or-later */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CfApiError, cfFetch, cfJson } from "./cf";

const creds = { accountId: "acc1", token: "tok1" };

afterEach(() => vi.unstubAllGlobals());

describe("cfFetch", () => {
  it("builds the account-scoped URL with a bearer token", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await cfFetch(creds, "/images/v2?per_page=1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/acc1/images/v2?per_page=1");
    expect((init!.headers as Headers).get("Authorization")).toBe("Bearer tok1");
  });
});

describe("cfJson", () => {
  it("returns the result field on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: true, result: { ok: 1 } }), { status: 200 }),
      ),
    );
    expect(await cfJson<{ ok: number }>(creds, "/x")).toEqual({ ok: 1 });
  });

  it("throws CfApiError on a failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), {
            status: 403,
          }),
      ),
    );
    await expect(cfJson(creds, "/x")).rejects.toBeInstanceOf(CfApiError);
  });
});
