/* AGPL-3.0-or-later */
import { type CfCreds, cfJson } from "../lib/cf";
import type { ConnectionRow, ConnectionStore } from "../lib/connection-store";
import { decryptToken, encryptToken } from "../lib/crypto";
import { parseAccountHash, parseStreamCode } from "../lib/urls";

export type ConnectionStatus = {
  connected: boolean;
  accountId?: string;
  accountHash?: string | null;
  streamCode?: string | null;
  flexibleVariantsEnabled?: boolean;
};

export type DecryptedCreds = {
  accountId: string;
  token: string;
  accountHash: string | null;
  streamCode: string | null;
};

export interface ConnectionService {
  getStatus(): Promise<ConnectionStatus>;
  connect(input: { accountId: string; token: string }): Promise<ConnectionStatus>;
  test(): Promise<ConnectionStatus>;
  credentials(): Promise<DecryptedCreds | null>;
}

type CfImageList = { images?: Array<{ variants?: string[] }> };
type CfVideoList = Array<{ thumbnail?: string; playback?: { hls?: string } }>;

async function probe(
  creds: CfCreds,
): Promise<{ ok: boolean; accountHash: string | null; streamCode: string | null }> {
  let ok = false;
  let accountHash: string | null = null;
  let streamCode: string | null = null;
  try {
    const list = await cfJson<CfImageList>(creds, "/images/v2?per_page=1");
    ok = true;
    const variant = list.images?.[0]?.variants?.[0];
    if (variant) accountHash = parseAccountHash(variant);
  } catch {
    // Images scope may be absent; fall through to the Stream probe.
  }
  try {
    const videos = await cfJson<CfVideoList>(creds, "/stream?limit=1");
    ok = true;
    const url = videos?.[0]?.thumbnail || videos?.[0]?.playback?.hls;
    if (url) streamCode = parseStreamCode(url);
  } catch {
    // Stream scope may be absent.
  }
  return { ok, accountHash, streamCode };
}

function statusFrom(row: ConnectionRow | null): ConnectionStatus {
  if (!row) return { connected: false };
  return {
    connected: true,
    accountId: row.accountId,
    accountHash: row.accountHash,
    streamCode: row.streamCode,
    flexibleVariantsEnabled: row.flexibleVariantsEnabled,
  };
}

export function createConnectionService(store: ConnectionStore, encKey: string): ConnectionService {
  const credentials: ConnectionService["credentials"] = async () => {
    const row = await store.get();
    if (!row) return null;
    const token = await decryptToken({ cipher: row.tokenCipher, iv: row.tokenIv }, encKey);
    return {
      accountId: row.accountId,
      token,
      accountHash: row.accountHash,
      streamCode: row.streamCode,
    };
  };

  return {
    credentials,
    async getStatus() {
      return statusFrom(await store.get());
    },
    async connect({ accountId, token }) {
      const result = await probe({ accountId, token });
      if (!result.ok) throw new Error("Token failed validation against Cloudflare");
      const enc = await encryptToken(token, encKey);
      const existing = await store.get();
      await store.upsert({
        accountId,
        accountHash: result.accountHash,
        streamCode: result.streamCode,
        tokenCipher: enc.cipher,
        tokenIv: enc.iv,
        flexibleVariantsEnabled: existing?.flexibleVariantsEnabled ?? false,
      });
      return statusFrom(await store.get());
    },
    async test() {
      const creds = await credentials();
      if (!creds) return { connected: false };
      const result = await probe({ accountId: creds.accountId, token: creds.token });
      if (!result.ok) throw new Error("Stored token failed validation");
      await store.patchDiscovered({
        accountHash: result.accountHash,
        streamCode: result.streamCode,
      });
      return statusFrom(await store.get());
    },
  };
}
