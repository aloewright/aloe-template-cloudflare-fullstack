/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "./crypto";

const KEY = "test-key-material-abc123";

describe("crypto", () => {
  it("round-trips a token", async () => {
    const enc = await encryptToken("cf-secret-token", KEY);
    expect(enc.cipher).not.toContain("cf-secret-token");
    const back = await decryptToken(enc, KEY);
    expect(back).toBe("cf-secret-token");
  });

  it("uses a fresh IV each time", async () => {
    const a = await encryptToken("same", KEY);
    const b = await encryptToken("same", KEY);
    expect(a.iv).not.toBe(b.iv);
    expect(a.cipher).not.toBe(b.cipher);
  });

  it("fails to decrypt with the wrong key", async () => {
    const enc = await encryptToken("secret", KEY);
    await expect(decryptToken(enc, "wrong-key")).rejects.toBeTruthy();
  });
});
