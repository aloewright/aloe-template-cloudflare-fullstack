/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { type ConnectionRow, inMemoryConnectionStore } from "./connection-store";

const row: ConnectionRow = {
  accountId: "acc1",
  accountHash: null,
  streamCode: null,
  tokenCipher: "c",
  tokenIv: "i",
  flexibleVariantsEnabled: false,
};

describe("inMemoryConnectionStore", () => {
  it("starts empty", async () => {
    expect(await inMemoryConnectionStore().get()).toBeNull();
  });

  it("upserts and reads back", async () => {
    const store = inMemoryConnectionStore();
    await store.upsert(row);
    expect((await store.get())?.accountId).toBe("acc1");
  });

  it("patches discovered fields without clobbering others", async () => {
    const store = inMemoryConnectionStore(row);
    await store.patchDiscovered({ accountHash: "HASH" });
    const got = await store.get();
    expect(got?.accountHash).toBe("HASH");
    expect(got?.accountId).toBe("acc1");
  });
});
