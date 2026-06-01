/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { signImageUrl } from "./sign";

describe("signImageUrl", () => {
  it("appends a deterministic exp + sig for a fixed key and time", async () => {
    const url = "https://imagedelivery.net/HASH/img1/public";
    const a = await signImageUrl(url, "secret-key", 3600, 1000);
    const b = await signImageUrl(url, "secret-key", 3600, 1000);
    const parsed = new URL(a);
    expect(parsed.searchParams.get("exp")).toBe("4600");
    expect(parsed.searchParams.get("sig")).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b); // deterministic for fixed inputs
  });

  it("changes the signature when the key changes", async () => {
    const url = "https://imagedelivery.net/HASH/img1/public";
    const a = await signImageUrl(url, "key-a", 3600, 1000);
    const b = await signImageUrl(url, "key-b", 3600, 1000);
    expect(new URL(a).searchParams.get("sig")).not.toBe(new URL(b).searchParams.get("sig"));
  });
});
