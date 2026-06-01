/* AGPL-3.0-or-later */
import { eq } from "drizzle-orm";
import type { createDatabase } from "../db";
import { cfConnection } from "../db/schema";

export type ConnectionRow = {
  accountId: string;
  accountHash: string | null;
  streamCode: string | null;
  tokenCipher: string;
  tokenIv: string;
  flexibleVariantsEnabled: boolean;
};

export interface ConnectionStore {
  get(): Promise<ConnectionRow | null>;
  upsert(row: ConnectionRow): Promise<void>;
  patchDiscovered(input: {
    accountHash?: string | null;
    streamCode?: string | null;
  }): Promise<void>;
}

type DB = ReturnType<typeof createDatabase>;

export function d1ConnectionStore(db: DB): ConnectionStore {
  return {
    async get() {
      const rows = await db.select().from(cfConnection).where(eq(cfConnection.id, 1)).limit(1);
      const r = rows[0];
      if (!r) return null;
      return {
        accountId: r.accountId,
        accountHash: r.accountHash,
        streamCode: r.streamCode,
        tokenCipher: r.tokenCipher,
        tokenIv: r.tokenIv,
        flexibleVariantsEnabled: r.flexibleVariantsEnabled,
      };
    },
    async upsert(row) {
      const values = {
        id: 1,
        accountId: row.accountId,
        accountHash: row.accountHash,
        streamCode: row.streamCode,
        tokenCipher: row.tokenCipher,
        tokenIv: row.tokenIv,
        flexibleVariantsEnabled: row.flexibleVariantsEnabled,
        updatedAt: new Date(),
      };
      await db
        .insert(cfConnection)
        .values(values)
        .onConflictDoUpdate({ target: cfConnection.id, set: values });
    },
    async patchDiscovered({ accountHash, streamCode }) {
      const set: Record<string, unknown> = { updatedAt: new Date() };
      if (accountHash !== undefined) set.accountHash = accountHash;
      if (streamCode !== undefined) set.streamCode = streamCode;
      await db.update(cfConnection).set(set).where(eq(cfConnection.id, 1));
    },
  };
}

export function inMemoryConnectionStore(initial: ConnectionRow | null = null): ConnectionStore {
  let row: ConnectionRow | null = initial ? { ...initial } : null;
  return {
    async get() {
      return row ? { ...row } : null;
    },
    async upsert(r) {
      row = { ...r };
    },
    async patchDiscovered({ accountHash, streamCode }) {
      if (!row) return;
      if (accountHash !== undefined) row.accountHash = accountHash;
      if (streamCode !== undefined) row.streamCode = streamCode;
    },
  };
}
