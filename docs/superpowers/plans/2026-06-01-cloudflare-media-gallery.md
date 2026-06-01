# Cloudflare Media Gallery — Implementation Plan (Plan 1 of N: Connect + Read-only Gallery)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend this Cloudflare Workers template into an Access-gated, single-user app that connects to the owner's Cloudflare account and browses **all Cloudflare Images and Stream assets** in a gallery with a read-only detail view.

**Architecture:** A single Hono Worker gains a `accessGuard` middleware (verifies the Cloudflare Access JWT), an AES-GCM-encrypted single-row credentials table in D1, and thin proxy routes that call `api.cloudflare.com` with the decrypted token and normalize responses. The React 19 + Mantine SPA gains a Connect/Settings page and a tabbed masonry gallery (Images / Stream) with detail drawers. The browser never holds the Cloudflare token.

**Tech Stack:** Cloudflare Workers + Hono, D1 + Drizzle, WebCrypto (AES-GCM), `jose` (Access JWT), React 19 + Mantine 9 + TanStack Router/Query, Vite 8, Vitest, Biome.

**Scope of THIS plan (spec phases 0–2):** Foundations (Access guard, encrypted credentials, connect flow), Images gallery (read), Stream gallery (read). Editing, uploads, transforms, Stream clip/thumbnail/captions, and signed-asset viewing are **later plans** (spec phases 3–8).

**Conventions for this repo:**
- Every new `.ts`/`.tsx` source file starts with the license header line: `/* AGPL-3.0-or-later */`
- Biome: 2-space indent, double quotes, semicolons, 100-col width. Run `npm run check` to auto-fix.
- Client imports use the `@/` alias for `src/`. Worker code uses relative imports.
- Worker logic and pure functions are covered by Vitest (TDD). Client UI is verified by `npm run typecheck` + a manual smoke run, because the template ships no component-test harness and adding one (jsdom + React Testing Library) is out of scope for this increment.

---

## File Structure

**Worker (new):**
- `worker/src/types.ts` — shared `Bindings`, `Variables`, `AppEnv` types.
- `worker/src/lib/crypto.ts` — AES-GCM `encryptToken` / `decryptToken`.
- `worker/src/lib/urls.ts` — pure URL parsers/builders (account hash, stream code, thumbnail pick, iframe URL).
- `worker/src/lib/cf.ts` — `cfFetch` / `cfJson` Cloudflare REST client + `CfApiError`.
- `worker/src/lib/connection-store.ts` — `ConnectionStore` interface, `d1ConnectionStore`, `inMemoryConnectionStore`.
- `worker/src/services/connection.ts` — `createConnectionService` (validate, encrypt, discover, decrypt).
- `worker/src/middleware/access.ts` — `accessGuard` + `verifyAccessToken`.
- `worker/src/routes/me.ts` — `GET /api/me` → `{ email }`.
- `worker/src/routes/settings.ts` — `settingsRoute(makeService)` (GET/PUT/test).
- `worker/src/routes/images.ts` — `imagesRoute(makeService)` (list + detail).
- `worker/src/routes/stream.ts` — `streamRoute(makeService)` (list + detail).

**Worker (modified):**
- `worker/src/db/schema.ts` — add `cfConnection` table.
- `worker/migrations/000X_*.sql` — generated migration for the table.
- `worker/src/index.ts` — import shared `Bindings`, mount `accessGuard` + new routes.

**Client (new):**
- `src/lib/cf-api.ts` — typed fetchers + contract types.
- `src/lib/setup-guard.ts` — `ensureConnected` route loader.
- `src/routes/settings.tsx` — Connect page.
- `src/routes/gallery.tsx` — tabbed gallery shell.
- `src/components/MediaGrid.tsx` — masonry container.
- `src/components/ImagesPanel.tsx` + `src/components/ImageCard.tsx` + `src/components/ImageDetailDrawer.tsx`.
- `src/components/StreamPanel.tsx` + `src/components/StreamCard.tsx` + `src/components/StreamDetailDrawer.tsx`.

**Client (modified):**
- `src/router.tsx` — route tree → `/` Gallery, `/settings` Connect, setup guard.

**Config (modified/new):**
- `package.json` — add `jose`, `vitest`, test scripts.
- `vitest.config.ts` — new.
- `wrangler.toml` — add `[vars]` `TEAM_DOMAIN`, `POLICY_AUD`.
- `.dev.vars.example` — new; `.gitignore` — add `.dev.vars`.

---

## Phase 0 — Foundations

### Task 1: Test tooling + dependencies

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `worker/src/lib/smoke.test.ts` (temporary sanity test)

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install jose
npm install -D vitest
```
Expected: `jose` added to `dependencies`, `vitest` to `devDependencies`; no errors.

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block, add these two entries (place after `"check"`):
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
/* AGPL-3.0-or-later */
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["worker/**/*.test.ts", "src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write a sanity test**

`worker/src/lib/smoke.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test to verify the runner works**

Run: `npm run test`
Expected: PASS — 1 test passed.

- [ ] **Step 6: Delete the sanity test and commit**

```bash
rm worker/src/lib/smoke.test.ts
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest + jose; wire test scripts"
```

---

### Task 2: Shared env types + Worker config

**Files:**
- Create: `worker/src/types.ts`
- Modify: `worker/src/index.ts` (Bindings import only)
- Modify: `wrangler.toml`
- Create: `.dev.vars.example`
- Modify: `.gitignore`

- [ ] **Step 1: Create `worker/src/types.ts`**

```ts
/* AGPL-3.0-or-later */
import type { PolarEnv } from "./polar";

export type Bindings = {
  DB: D1Database;
  // Cloudflare Access — see docs/superpowers/specs for setup.
  TEAM_DOMAIN: string; // https://<team>.cloudflareaccess.com
  POLICY_AUD: string; // Access application AUD tag
  // AES-GCM key material for encrypting the stored Cloudflare API token at rest.
  TOKEN_ENC_KEY: string;
  // Set to "1" only in local .dev.vars to bypass Access during `wrangler dev`.
  DEV_BYPASS_ACCESS?: string;
} & PolarEnv;

export type Variables = {
  email: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
```

- [ ] **Step 2: Point `index.ts` at the shared `Bindings` type**

In `worker/src/index.ts`, remove the local `export type Bindings = {...}` block and its now-unused `import type { PolarEnv } from "./polar";`, and add at the top with the other imports:
```ts
import type { Bindings } from "./types";
```
Leave the rest of the file unchanged for now (route mounting happens in later tasks). Re-export Bindings so existing importers keep working:
```ts
export type { Bindings } from "./types";
```

- [ ] **Step 3: Add `[vars]` to `wrangler.toml`**

Append to `wrangler.toml`:
```toml
# Cloudflare Access (Zero Trust) — fill these in for your deployment.
# Create a self-hosted Access application in Zero Trust > Access > Applications
# pointing at this Worker's hostname, then copy its AUD tag here.
[vars]
TEAM_DOMAIN = "https://CHANGE-ME.cloudflareaccess.com"
POLICY_AUD = "CHANGE-ME-aud-tag"
```

- [ ] **Step 4: Create `.dev.vars.example`**

```bash
# Copy to .dev.vars for local `wrangler dev` (gitignored). Never commit real values.
# AES-GCM key material for encrypting the stored Cloudflare API token.
# Generate with: openssl rand -base64 32
TOKEN_ENC_KEY="replace-with-output-of-openssl-rand-base64-32"
# Bypass Cloudflare Access locally so the app is reachable without Zero Trust.
DEV_BYPASS_ACCESS="1"
```

- [ ] **Step 5: Ignore `.dev.vars`**

Add a line to `.gitignore`:
```
.dev.vars
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS (no type errors).
```bash
git add worker/src/types.ts worker/src/index.ts wrangler.toml .dev.vars.example .gitignore
git commit -m "feat(worker): shared env types + Access/encryption config scaffolding"
```

---

### Task 3: Token encryption (AES-GCM)

**Files:**
- Create: `worker/src/lib/crypto.ts`
- Test: `worker/src/lib/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/lib/crypto.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- crypto`
Expected: FAIL — cannot resolve `./crypto`.

- [ ] **Step 3: Implement `worker/src/lib/crypto.ts`**

```ts
/* AGPL-3.0-or-later */
export type EncryptedToken = { cipher: string; iv: string };

const toB64 = (buf: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(buf)));

const fromB64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(keyMaterial: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(keyMaterial));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plaintext: string, keyMaterial: string): Promise<EncryptedToken> {
  const key = await deriveKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { cipher: toB64(cipher), iv: toB64(iv.buffer) };
}

export async function decryptToken(enc: EncryptedToken, keyMaterial: string): Promise<string> {
  const key = await deriveKey(keyMaterial);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(enc.iv) },
    key,
    fromB64(enc.cipher),
  );
  return new TextDecoder().decode(plain);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- crypto`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/crypto.ts worker/src/lib/crypto.test.ts
git commit -m "feat(worker): AES-GCM token encryption"
```

---

### Task 4: URL parsers/builders

**Files:**
- Create: `worker/src/lib/urls.ts`
- Test: `worker/src/lib/urls.test.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/lib/urls.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { describe, expect, it } from "vitest";
import { parseAccountHash, parseStreamCode, pickImageThumbnail, streamIframeUrl } from "./urls";

describe("urls", () => {
  it("parses the account hash from a delivery URL", () => {
    expect(
      parseAccountHash("https://imagedelivery.net/ZWd9g1K7eljCn_KDTu_MWA/abc-123/public"),
    ).toBe("ZWd9g1K7eljCn_KDTu_MWA");
    expect(parseAccountHash("not a url")).toBeNull();
  });

  it("parses the stream customer code", () => {
    expect(
      parseStreamCode("https://customer-f33zs165nr7gyfy4.cloudflarestream.com/uid/thumbnails/thumbnail.jpg"),
    ).toBe("f33zs165nr7gyfy4");
    expect(parseStreamCode("https://example.com")).toBeNull();
  });

  it("prefers the public variant for thumbnails", () => {
    expect(pickImageThumbnail(["https://x/a/w=99", "https://x/a/public"])).toBe("https://x/a/public");
    expect(pickImageThumbnail(["https://x/a/thumb"])).toBe("https://x/a/thumb");
    expect(pickImageThumbnail([])).toBe("");
  });

  it("builds a stream iframe URL", () => {
    expect(streamIframeUrl("code1", "uid1")).toBe(
      "https://customer-code1.cloudflarestream.com/uid1/iframe",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- urls`
Expected: FAIL — cannot resolve `./urls`.

- [ ] **Step 3: Implement `worker/src/lib/urls.ts`**

```ts
/* AGPL-3.0-or-later */
export function parseAccountHash(deliveryUrl: string): string | null {
  return deliveryUrl.match(/imagedelivery\.net\/([^/]+)\//)?.[1] ?? null;
}

export function parseStreamCode(url: string): string | null {
  return url.match(/customer-([a-z0-9]+)\.cloudflarestream\.com/i)?.[1] ?? null;
}

export function pickImageThumbnail(variants: string[]): string {
  if (variants.length === 0) return "";
  return variants.find((v) => v.endsWith("/public")) ?? variants[0] ?? "";
}

export function streamIframeUrl(code: string, uid: string): string {
  return `https://customer-${code}.cloudflarestream.com/${uid}/iframe`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- urls`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/urls.ts worker/src/lib/urls.test.ts
git commit -m "feat(worker): Cloudflare delivery URL parsers/builders"
```

---

### Task 5: Cloudflare REST client

**Files:**
- Create: `worker/src/lib/cf.ts`
- Test: `worker/src/lib/cf.test.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/lib/cf.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CfApiError, cfFetch, cfJson } from "./cf";

const creds = { accountId: "acc1", token: "tok1" };

afterEach(() => vi.unstubAllGlobals());

describe("cfFetch", () => {
  it("builds the account-scoped URL with a bearer token", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
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
      vi.fn(async () => new Response(JSON.stringify({ success: true, result: { ok: 1 } }), { status: 200 })),
    );
    expect(await cfJson<{ ok: number }>(creds, "/x")).toEqual({ ok: 1 });
  });

  it("throws CfApiError on a failed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false, errors: [{ code: 10000 }] }), { status: 403 })),
    );
    await expect(cfJson(creds, "/x")).rejects.toBeInstanceOf(CfApiError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- cf`
Expected: FAIL — cannot resolve `./cf`.

- [ ] **Step 3: Implement `worker/src/lib/cf.ts`**

```ts
/* AGPL-3.0-or-later */
export type CfCreds = { accountId: string; token: string };

export const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export class CfApiError extends Error {
  status: number;
  errors: unknown;
  constructor(status: number, errors: unknown, message: string) {
    super(message);
    this.name = "CfApiError";
    this.status = status;
    this.errors = errors;
  }
}

export function cfFetch(creds: CfCreds, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${creds.token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(`${CF_API_BASE}/accounts/${creds.accountId}${path}`, { ...init, headers });
}

export async function cfJson<T>(creds: CfCreds, path: string, init?: RequestInit): Promise<T> {
  const res = await cfFetch(creds, path, init);
  const body = (await res.json()) as { success?: boolean; result?: T; errors?: unknown };
  if (!res.ok || body.success === false) {
    throw new CfApiError(res.status, body.errors, `Cloudflare API error (${res.status})`);
  }
  return body.result as T;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- cf`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/cf.ts worker/src/lib/cf.test.ts
git commit -m "feat(worker): Cloudflare REST client (cfFetch/cfJson)"
```

---

### Task 6: D1 credentials table + migration

**Files:**
- Modify: `worker/src/db/schema.ts`
- Create: migration in `worker/migrations/` (generated)

- [ ] **Step 1: Add the `cfConnection` table to `worker/src/db/schema.ts`**

Append to the file:
```ts
// Single-row table (id is always 1) holding the encrypted Cloudflare API token
// and discovered delivery identifiers for this single-user app.
export const cfConnection = sqliteTable("cf_connection", {
  id: integer("id").primaryKey(),
  accountId: text("account_id").notNull(),
  accountHash: text("account_hash"),
  streamCode: text("stream_code"),
  tokenCipher: text("token_cipher").notNull(),
  tokenIv: text("token_iv").notNull(),
  flexibleVariantsEnabled: integer("flexible_variants_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

- [ ] **Step 2: Generate the migration**

Run:
```bash
cd worker && npx drizzle-kit generate && cd ..
```
Expected: a new file `worker/migrations/0001_*.sql` containing `CREATE TABLE \`cf_connection\``, and `worker/migrations/meta/_journal.json` gains a second entry.

- [ ] **Step 3: Apply the migration to the local D1**

Run:
```bash
npx wrangler d1 migrations apply template --local
```
Expected: reports the `0001_*` migration applied successfully to the local database.

- [ ] **Step 4: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add worker/src/db/schema.ts worker/migrations/
git commit -m "feat(db): cf_connection table for encrypted Cloudflare credentials"
```

---

### Task 7: Connection store (interface + D1 + in-memory)

**Files:**
- Create: `worker/src/lib/connection-store.ts`
- Test: `worker/src/lib/connection-store.test.ts`

- [ ] **Step 1: Write the failing test** (covers the in-memory store contract)

`worker/src/lib/connection-store.test.ts`:
```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- connection-store`
Expected: FAIL — cannot resolve `./connection-store`.

- [ ] **Step 3: Implement `worker/src/lib/connection-store.ts`**

```ts
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
  patchDiscovered(input: { accountHash?: string | null; streamCode?: string | null }): Promise<void>;
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- connection-store`
Expected: PASS — 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/connection-store.ts worker/src/lib/connection-store.test.ts
git commit -m "feat(worker): connection store (interface + D1 + in-memory)"
```

---

### Task 8: Connection service (validate + encrypt + discover)

**Files:**
- Create: `worker/src/services/connection.ts`
- Test: `worker/src/services/connection.test.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/services/connection.test.ts`:
```ts
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
          result: [{ thumbnail: "https://customer-CODE.cloudflarestream.com/uid/thumbnails/thumbnail.jpg" }],
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
    expect(status).toMatchObject({ connected: true, accountId: "acc1", accountHash: "HASH", streamCode: "CODE" });

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
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 403 })));
    const svc = createConnectionService(inMemoryConnectionStore(), ENC);
    await expect(svc.connect({ accountId: "acc1", token: "bad" })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- services/connection`
Expected: FAIL — cannot resolve `./connection`.

- [ ] **Step 3: Implement `worker/src/services/connection.ts`**

```ts
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

async function probe(creds: CfCreds): Promise<{ ok: boolean; accountHash: string | null; streamCode: string | null }> {
  let ok = false;
  let accountHash: string | null = null;
  let streamCode: string | null = null;
  try {
    const list = await cfJson<CfImageList>(creds, "/images/v2?per_page=1");
    ok = true;
    const variant = list.images?.[0]?.variants?.[0];
    if (variant) accountHash = parseAccountHash(variant);
  } catch {
    // Images scope may be absent; fall through to Stream probe.
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
    return { accountId: row.accountId, token, accountHash: row.accountHash, streamCode: row.streamCode };
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
      await store.patchDiscovered({ accountHash: result.accountHash, streamCode: result.streamCode });
      return statusFrom(await store.get());
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- services/connection`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/services/connection.ts worker/src/services/connection.test.ts
git commit -m "feat(worker): connection service (validate/encrypt/discover/decrypt)"
```

---

### Task 9: Access guard middleware

**Files:**
- Create: `worker/src/middleware/access.ts`
- Test: `worker/src/middleware/access.test.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/middleware/access.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { SignJWT, generateKeyPair } from "jose";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../types";
import { accessGuard, verifyAccessToken } from "./access";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "aud-tag";

function appWithGuard() {
  const app = new Hono<AppEnv>();
  app.use("/api/*", accessGuard);
  app.get("/api/whoami", (c) => c.json({ email: c.get("email") }));
  return app;
}

describe("verifyAccessToken", () => {
  it("accepts a valid token and extracts the email", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwt = await new SignJWT({ email: "me@example.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);

    const result = await verifyAccessToken(jwt, { teamDomain: TEAM, aud: AUD, getKey: async () => publicKey });
    expect(result.email).toBe("me@example.com");
  });

  it("rejects a token with the wrong audience", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwt = await new SignJWT({ email: "me@example.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(TEAM)
      .setAudience("other-aud")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);

    await expect(
      verifyAccessToken(jwt, { teamDomain: TEAM, aud: AUD, getKey: async () => publicKey }),
    ).rejects.toBeTruthy();
  });
});

describe("accessGuard", () => {
  it("bypasses Access in local dev", async () => {
    const res = await appWithGuard().request("/api/whoami", {}, {
      DEV_BYPASS_ACCESS: "1",
    } as AppEnv["Bindings"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "dev@localhost" });
  });

  it("returns 403 when the Access token is missing", async () => {
    const res = await appWithGuard().request("/api/whoami", {}, {
      TEAM_DOMAIN: TEAM,
      POLICY_AUD: AUD,
    } as AppEnv["Bindings"]);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- middleware/access`
Expected: FAIL — cannot resolve `./access`.

- [ ] **Step 3: Implement `worker/src/middleware/access.ts`**

```ts
/* AGPL-3.0-or-later */
import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AppEnv } from "../types";

const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let getKey = jwksCache.get(teamDomain);
  if (!getKey) {
    getKey = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, getKey);
  }
  return getKey;
}

export async function verifyAccessToken(
  token: string,
  opts: { teamDomain: string; aud: string; getKey?: JWTVerifyGetKey },
): Promise<{ email: string }> {
  const getKey = opts.getKey ?? remoteJwks(opts.teamDomain);
  const { payload } = await jwtVerify(token, getKey, {
    issuer: opts.teamDomain,
    audience: opts.aud,
  });
  return { email: typeof payload.email === "string" ? payload.email : "unknown" };
}

export const accessGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === "/api/health") return next();
  if (c.env.DEV_BYPASS_ACCESS === "1") {
    c.set("email", "dev@localhost");
    return next();
  }
  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) return c.json({ error: "Missing Cloudflare Access token" }, 403);
  try {
    const { email } = await verifyAccessToken(token, {
      teamDomain: c.env.TEAM_DOMAIN,
      aud: c.env.POLICY_AUD,
    });
    c.set("email", email);
    return next();
  } catch {
    return c.json({ error: "Invalid Cloudflare Access token" }, 403);
  }
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- middleware/access`
Expected: PASS — 4 tests passed.

- [ ] **Step 5: Commit**

```bash
git add worker/src/middleware/access.ts worker/src/middleware/access.test.ts
git commit -m "feat(worker): Cloudflare Access JWT guard + verifier"
```

---

### Task 10: Settings + me routes, mount guard in index

**Files:**
- Create: `worker/src/routes/settings.ts`
- Create: `worker/src/routes/me.ts`
- Test: `worker/src/routes/settings.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/routes/settings.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inMemoryConnectionStore } from "../lib/connection-store";
import { createConnectionService } from "../services/connection";
import { settingsRoute } from "./settings";

function appWithFakeService() {
  const service = createConnectionService(inMemoryConnectionStore(), "enc-key");
  const app = new Hono();
  app.route("/api/settings", settingsRoute(() => service));
  return app;
}

function cfOk() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/images/v2")) {
      return new Response(
        JSON.stringify({ success: true, result: { images: [{ variants: ["https://imagedelivery.net/HASH/i/public"] }] } }),
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- routes/settings`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 3: Implement `worker/src/routes/settings.ts`**

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;

export function settingsRoute(makeService: MakeService) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await makeService(c.env).getStatus()));

  app.put("/", async (c) => {
    const body = await c.req.json<{ accountId?: string; token?: string }>().catch(() => ({}) as never);
    if (!body.accountId || !body.token) {
      return c.json({ error: "accountId and token are required" }, 400);
    }
    try {
      const status = await makeService(c.env).connect({ accountId: body.accountId, token: body.token });
      return c.json(status);
    } catch {
      return c.json(
        { error: "Could not validate the token against Cloudflare. Check the token scopes and account ID." },
        400,
      );
    }
  });

  app.post("/test", async (c) => {
    try {
      return c.json(await makeService(c.env).test());
    } catch {
      return c.json({ error: "Stored token failed validation" }, 400);
    }
  });

  return app;
}
```

- [ ] **Step 4: Implement `worker/src/routes/me.ts`**

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { AppEnv } from "../types";

export const me = new Hono<AppEnv>();

me.get("/", (c) => c.json({ email: c.get("email") }));
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test -- routes/settings`
Expected: PASS — 3 tests passed.

- [ ] **Step 6: Wire the guard + routes into `worker/src/index.ts`**

Replace the body of `worker/src/index.ts` so it reads:
```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { createDatabase } from "./db";
import { d1ConnectionStore } from "./lib/connection-store";
import { accessGuard } from "./middleware/access";
import { checkout } from "./routes/checkout";
import { demo } from "./routes/demo";
import { health } from "./routes/health";
import { me } from "./routes/me";
import { session } from "./routes/session";
import { settingsRoute } from "./routes/settings";
import { success } from "./routes/success";
import { webhook } from "./routes/webhook";
import { createConnectionService } from "./services/connection";
import type { AppEnv, Bindings } from "./types";

export type { Bindings } from "./types";

const makeService = (env: Bindings) =>
  createConnectionService(d1ConnectionStore(createDatabase(env)), env.TOKEN_ENC_KEY);

const app = new Hono<AppEnv>();

// Cloudflare Access gates the whole API (except health). In local dev,
// DEV_BYPASS_ACCESS=1 short-circuits this. See worker/src/middleware/access.ts.
app.use("/api/*", accessGuard);

app.route("/api/health", health);
app.route("/api/me", me);
app.route("/api/settings", settingsRoute(makeService));

// Template leftovers — now Access-gated and unused by the gallery app.
// Removed in a later cleanup; left mounted to avoid churn this increment.
app.route("/api/session", session);
app.route("/api/demo", demo);
app.route("/api/checkout", checkout);
app.route("/api/checkout/success", success);
app.route("/api/webhook/polar", webhook);

export default app;
```

- [ ] **Step 7: Typecheck, run all tests, commit**

Run: `npm run typecheck && npm run test`
Expected: PASS for both.
```bash
git add worker/src/routes/settings.ts worker/src/routes/settings.test.ts worker/src/routes/me.ts worker/src/index.ts
git commit -m "feat(worker): settings + me routes; mount Access guard"
```

---

### Task 11: Client — connect flow (cf-api, setup guard, settings page, router)

**Files:**
- Create: `src/lib/cf-api.ts`
- Create: `src/lib/setup-guard.ts`
- Create: `src/routes/settings.tsx`
- Modify: `src/router.tsx`

- [ ] **Step 1: Create `src/lib/cf-api.ts`** (contract types mirror the Worker; keep in sync)

```ts
/* AGPL-3.0-or-later */
import { fetchJson } from "@/lib/api";

export type ConnectionStatus = {
  connected: boolean;
  accountId?: string;
  accountHash?: string | null;
  streamCode?: string | null;
  flexibleVariantsEnabled?: boolean;
};

export type ImageItem = {
  id: string;
  filename: string;
  uploaded: string;
  requireSignedURLs: boolean;
  meta: Record<string, string>;
  variants: string[];
  thumbnailUrl: string;
};
export type ImagesPage = { images: ImageItem[]; continuationToken: string | null };

export type StreamItem = {
  uid: string;
  name: string;
  thumbnail: string;
  duration: number;
  status: string;
  readyToStream: boolean;
  requireSignedURLs: boolean;
  thumbnailTimestampPct: number;
  iframeUrl: string;
  meta: Record<string, string>;
  created: string;
};
export type StreamPage = { videos: StreamItem[]; cursor: string | null };

export const getSettings = () => fetchJson<ConnectionStatus>("/api/settings");

export const saveSettings = (body: { accountId: string; token: string }) =>
  fetchJson<ConnectionStatus>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const testConnection = () =>
  fetchJson<ConnectionStatus>("/api/settings/test", { method: "POST" });

export const getMe = () => fetchJson<{ email: string }>("/api/me");

export const listImages = (cursor?: string) =>
  fetchJson<ImagesPage>(`/api/images${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);

export const listStream = (cursor?: string) =>
  fetchJson<StreamPage>(`/api/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
```

- [ ] **Step 2: Create `src/lib/setup-guard.ts`**

```ts
/* AGPL-3.0-or-later */
import { redirect } from "@tanstack/react-router";
import { getSettings } from "@/lib/cf-api";

// Route loader for the gallery. Redirects to /settings until the owner has
// connected their Cloudflare account.
export async function ensureConnected() {
  const status = await getSettings();
  if (!status.connected) {
    throw redirect({ to: "/settings" });
  }
}
```

- [ ] **Step 3: Create `src/routes/settings.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Alert, Anchor, Button, Container, PasswordInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { getSettings, saveSettings } from "@/lib/cf-api";

export function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const form = useForm({
    initialValues: { accountId: "", token: "" },
    validate: {
      accountId: (v) => (v.trim().length > 0 ? null : "Account ID is required"),
      token: (v) => (v.trim().length > 0 ? null : "API token is required"),
    },
  });

  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      notifications.show({ message: "Connected to Cloudflare", color: "green" });
      navigate({ to: "/" });
    },
    onError: () =>
      notifications.show({
        message: "Could not validate the token. Check the scopes and account ID.",
        color: "red",
      }),
  });

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={2}>Connect Cloudflare</Title>
          <Text c="dimmed" size="sm">
            Paste a scoped API token (Images Read+Edit, Stream Read+Edit) and your account ID. The
            token is stored encrypted and used only server-side.
          </Text>
        </div>

        {status.data?.connected && (
          <Alert color="green" title="Connected">
            Account <b>{status.data.accountId}</b>
            {status.data.accountHash ? ` · images hash ${status.data.accountHash}` : ""}
          </Alert>
        )}

        <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
          <Stack>
            <TextInput
              label="Account ID"
              placeholder="e.g. 0a1b2c3d..."
              {...form.getInputProps("accountId")}
            />
            <PasswordInput
              label="API token"
              placeholder="scoped Cloudflare API token"
              {...form.getInputProps("token")}
            />
            <Button type="submit" loading={save.isPending}>
              Save &amp; connect
            </Button>
            <Anchor
              href="https://dash.cloudflare.com/profile/api-tokens"
              target="_blank"
              size="sm"
            >
              Create an API token →
            </Anchor>
          </Stack>
        </form>
      </Stack>
    </Container>
  );
}
```

- [ ] **Step 4: Rewrite `src/router.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { ColorSchemeToggle } from "@/components/ColorSchemeToggle";
import { ensureConnected } from "@/lib/setup-guard";
import { Gallery } from "@/routes/gallery";
import { Settings } from "@/routes/settings";

const rootRoute = createRootRoute({
  component: () => (
    <>
      <ColorSchemeToggle />
      <Outlet />
    </>
  ),
});

const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ensureConnected,
  component: Gallery,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

const routeTree = rootRoute.addChildren([galleryRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

> Note: `Gallery` is created in Task 13. Until then `npm run typecheck` will report a missing module — that's expected; do Step 5's commit after Task 13, or create a temporary stub. To keep this task self-contained, create a stub now and replace it in Task 13.

- [ ] **Step 5: Create a temporary `src/routes/gallery.tsx` stub**

```tsx
/* AGPL-3.0-or-later */
export function Gallery() {
  return <div>Gallery (stub)</div>;
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/lib/cf-api.ts src/lib/setup-guard.ts src/routes/settings.tsx src/router.tsx src/routes/gallery.tsx
git commit -m "feat(client): connect flow — cf-api, setup guard, settings page, routes"
```

---

## Phase 1 — Images gallery (read)

### Task 12: Images proxy routes

**Files:**
- Create: `worker/src/routes/images.ts`
- Test: `worker/src/routes/images.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/routes/images.test.ts`:
```ts
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
  a.route("/api/images", imagesRoute(() => service));
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
      vi.fn(async () =>
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
                  variants: ["https://imagedelivery.net/HASH/img1/w=99", "https://imagedelivery.net/HASH/img1/public"],
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
    const body = await res.json();
    expect(body.continuationToken).toBe("next123");
    expect(body.images[0]).toMatchObject({
      id: "img1",
      filename: "cat.png",
      thumbnailUrl: "https://imagedelivery.net/HASH/img1/public",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- routes/images`
Expected: FAIL — cannot resolve `./images`.

- [ ] **Step 3: Implement `worker/src/routes/images.ts`**

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { cfJson } from "../lib/cf";
import { pickImageThumbnail } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;

type CfImage = {
  id: string;
  filename?: string;
  uploaded?: string;
  requireSignedURLs?: boolean;
  meta?: Record<string, string>;
  variants?: string[];
};

type ImageItem = {
  id: string;
  filename: string;
  uploaded: string;
  requireSignedURLs: boolean;
  meta: Record<string, string>;
  variants: string[];
  thumbnailUrl: string;
};

function toImageItem(img: CfImage): ImageItem {
  const variants = img.variants ?? [];
  return {
    id: img.id,
    filename: img.filename ?? img.id,
    uploaded: img.uploaded ?? "",
    requireSignedURLs: img.requireSignedURLs ?? false,
    meta: img.meta ?? {},
    variants,
    thumbnailUrl: pickImageThumbnail(variants),
  };
}

export function imagesRoute(makeService: MakeService) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const qs = new URLSearchParams({ per_page: "50" });
    const cursor = c.req.query("cursor");
    if (cursor) qs.set("continuation_token", cursor);
    const result = await cfJson<{ images?: CfImage[]; continuation_token?: string | null }>(
      creds,
      `/images/v2?${qs}`,
    );
    return c.json({
      images: (result.images ?? []).map(toImageItem),
      continuationToken: result.continuation_token ?? null,
    });
  });

  app.get("/:id", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const img = await cfJson<CfImage>(creds, `/images/v1/${c.req.param("id")}`);
    return c.json(toImageItem(img));
  });

  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- routes/images`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Mount the route in `worker/src/index.ts`**

Add the import with the others:
```ts
import { imagesRoute } from "./routes/images";
```
And mount it after the settings route:
```ts
app.route("/api/images", imagesRoute(makeService));
```

- [ ] **Step 6: Typecheck, test, commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.
```bash
git add worker/src/routes/images.ts worker/src/routes/images.test.ts worker/src/index.ts
git commit -m "feat(worker): images list + detail proxy routes"
```

---

### Task 13: Client — gallery shell + images panel

**Files:**
- Create: `src/components/MediaGrid.tsx`
- Create: `src/components/ImageCard.tsx`
- Create: `src/components/ImageDetailDrawer.tsx`
- Create: `src/components/ImagesPanel.tsx`
- Replace: `src/routes/gallery.tsx` (was a stub)

- [ ] **Step 1: Create `src/components/MediaGrid.tsx`**

```tsx
/* AGPL-3.0-or-later */
import type { ReactNode } from "react";

// Simple CSS-columns masonry. Children should set `break-inside-avoid`.
export function MediaGrid({ children }: { children: ReactNode }) {
  return <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">{children}</div>;
}
```

- [ ] **Step 2: Create `src/components/ImageCard.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Card, Image, Text } from "@mantine/core";
import type { ImageItem } from "@/lib/cf-api";

export function ImageCard({ item, onOpen }: { item: ImageItem; onOpen: (item: ImageItem) => void }) {
  return (
    <Card
      withBorder
      padding={0}
      radius="md"
      className="break-inside-avoid cursor-pointer overflow-hidden"
      onClick={() => onOpen(item)}
    >
      {item.thumbnailUrl ? (
        <Image src={item.thumbnailUrl} alt={item.filename} loading="lazy" />
      ) : (
        <Text p="sm" size="sm" c="dimmed">
          No preview
        </Text>
      )}
      <Text p="xs" size="xs" lineClamp={1} title={item.filename}>
        {item.filename}
      </Text>
    </Card>
  );
}
```

- [ ] **Step 3: Create `src/components/ImageDetailDrawer.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Badge, CopyButton, Drawer, Group, Image, Stack, Table, Text } from "@mantine/core";
import type { ImageItem } from "@/lib/cf-api";

export function ImageDetailDrawer({
  item,
  onClose,
}: {
  item: ImageItem | null;
  onClose: () => void;
}) {
  return (
    <Drawer opened={item !== null} onClose={onClose} position="right" size="lg" title={item?.filename}>
      {item && (
        <Stack>
          {item.thumbnailUrl && <Image src={item.thumbnailUrl} alt={item.filename} radius="md" />}
          <Group gap="xs">
            <Badge variant="light">{item.id}</Badge>
            {item.requireSignedURLs && <Badge color="orange">signed URLs</Badge>}
          </Group>
          <Text size="sm" c="dimmed">
            Uploaded {item.uploaded || "—"}
          </Text>
          {Object.keys(item.meta).length > 0 && (
            <Table>
              <Table.Tbody>
                {Object.entries(item.meta).map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>{k}</Table.Td>
                    <Table.Td>{v}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="sm" fw={600}>
            Variants
          </Text>
          {item.variants.map((v) => (
            <Group key={v} gap="xs" wrap="nowrap">
              <Text size="xs" style={{ wordBreak: "break-all" }}>
                {v}
              </Text>
              <CopyButton value={v}>
                {({ copied, copy }) => (
                  <Text size="xs" c="indigo" onClick={copy} style={{ cursor: "pointer" }}>
                    {copied ? "copied" : "copy"}
                  </Text>
                )}
              </CopyButton>
            </Group>
          ))}
        </Stack>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 4: Create `src/components/ImagesPanel.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ImageCard } from "@/components/ImageCard";
import { ImageDetailDrawer } from "@/components/ImageDetailDrawer";
import { MediaGrid } from "@/components/MediaGrid";
import { type ImageItem, listImages } from "@/lib/cf-api";

export function ImagesPanel() {
  const [selected, setSelected] = useState<ImageItem | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["images"],
    queryFn: ({ pageParam }) => listImages(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.continuationToken ?? undefined,
  });

  if (query.isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const images = query.data?.pages.flatMap((p) => p.images) ?? [];
  if (images.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">No images in this account yet.</Text>
      </Center>
    );
  }

  return (
    <Stack>
      <MediaGrid>
        {images.map((item) => (
          <ImageCard key={item.id} item={item} onOpen={setSelected} />
        ))}
      </MediaGrid>
      {query.hasNextPage && (
        <Center>
          <Button variant="default" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            Load more
          </Button>
        </Center>
      )}
      <ImageDetailDrawer item={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}
```

- [ ] **Step 5: Replace `src/routes/gallery.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Container, Group, Tabs, Title } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { IconSettings } from "@tabler/icons-react";
import { ImagesPanel } from "@/components/ImagesPanel";
import { getMe } from "@/lib/cf-api";

export function Gallery() {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });

  return (
    <Container size="xl" py="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Media Gallery</Title>
        <Group gap="sm">
          {me.data?.email && <span>{me.data.email}</span>}
          <Link to="/settings" aria-label="Settings">
            <IconSettings size={20} />
          </Link>
        </Group>
      </Group>

      <Tabs defaultValue="images">
        <Tabs.List mb="md">
          <Tabs.Tab value="images">Images</Tabs.Tab>
          <Tabs.Tab value="stream">Stream</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="images">
          <ImagesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="stream">{/* StreamPanel added in Task 15 */}</Tabs.Panel>
      </Tabs>
    </Container>
  );
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/components/MediaGrid.tsx src/components/ImageCard.tsx src/components/ImageDetailDrawer.tsx src/components/ImagesPanel.tsx src/routes/gallery.tsx
git commit -m "feat(client): gallery shell + images panel with detail drawer"
```

- [ ] **Step 7: Manual smoke test**

1. Create `.dev.vars` from the example: `cp .dev.vars.example .dev.vars`, then set `TOKEN_ENC_KEY` to the output of `openssl rand -base64 32`. Keep `DEV_BYPASS_ACCESS="1"`.
2. Ensure local D1 has the migration: `npx wrangler d1 migrations apply template --local`.
3. Run `npm run dev`.
4. Open `http://127.0.0.1:5173` → you should be redirected to `/settings`.
5. Enter a real Cloudflare account ID and a scoped token (Images Read/Edit, Stream Read/Edit). Save.
6. Expected: redirected to the gallery; the Images tab shows your account's images in a masonry grid; clicking a card opens the detail drawer with variants you can copy.

---

## Phase 2 — Stream gallery (read)

### Task 14: Stream proxy routes

**Files:**
- Create: `worker/src/routes/stream.ts`
- Test: `worker/src/routes/stream.test.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

`worker/src/routes/stream.test.ts`:
```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionService } from "../services/connection";
import { streamRoute } from "./stream";

const creds = { accountId: "acc1", token: "tok1", accountHash: null, streamCode: "CODE" };
const connected = { credentials: async () => creds } as unknown as ConnectionService;
const disconnected = { credentials: async () => null } as unknown as ConnectionService;

function app(service: ConnectionService) {
  const a = new Hono();
  a.route("/api/stream", streamRoute(() => service));
  return a;
}

afterEach(() => vi.unstubAllGlobals());

describe("streamRoute", () => {
  it("returns 409 when not connected", async () => {
    const res = await app(disconnected).request("/api/stream");
    expect(res.status).toBe(409);
  });

  it("lists and normalizes videos with an iframe URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success: true,
            result: [
              {
                uid: "vid1",
                meta: { name: "Clip One" },
                thumbnail: "https://customer-CODE.cloudflarestream.com/vid1/thumbnails/thumbnail.jpg",
                duration: 12.5,
                status: { state: "ready" },
                readyToStream: true,
                requireSignedURLs: false,
                thumbnailTimestampPct: 0.5,
                created: "2026-01-01T00:00:00Z",
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const res = await app(connected).request("/api/stream");
    const body = await res.json();
    expect(body.videos[0]).toMatchObject({
      uid: "vid1",
      name: "Clip One",
      status: "ready",
      iframeUrl: "https://customer-CODE.cloudflarestream.com/vid1/iframe",
    });
    expect(body.cursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- routes/stream`
Expected: FAIL — cannot resolve `./stream`.

- [ ] **Step 3: Implement `worker/src/routes/stream.ts`**

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { cfJson } from "../lib/cf";
import { parseStreamCode, streamIframeUrl } from "../lib/urls";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;
const PAGE = 50;

type CfVideo = {
  uid: string;
  meta?: Record<string, string>;
  thumbnail?: string;
  playback?: { hls?: string };
  duration?: number;
  status?: { state?: string };
  readyToStream?: boolean;
  requireSignedURLs?: boolean;
  thumbnailTimestampPct?: number;
  created?: string;
};

type StreamItem = {
  uid: string;
  name: string;
  thumbnail: string;
  duration: number;
  status: string;
  readyToStream: boolean;
  requireSignedURLs: boolean;
  thumbnailTimestampPct: number;
  iframeUrl: string;
  meta: Record<string, string>;
  created: string;
};

function toStreamItem(v: CfVideo): StreamItem {
  const code = parseStreamCode(v.thumbnail || v.playback?.hls || "");
  return {
    uid: v.uid,
    name: v.meta?.name ?? v.uid,
    thumbnail: v.thumbnail ?? "",
    duration: v.duration ?? 0,
    status: v.status?.state ?? "unknown",
    readyToStream: v.readyToStream ?? false,
    requireSignedURLs: v.requireSignedURLs ?? false,
    thumbnailTimestampPct: v.thumbnailTimestampPct ?? 0,
    iframeUrl: code ? streamIframeUrl(code, v.uid) : "",
    meta: v.meta ?? {},
    created: v.created ?? "",
  };
}

export function streamRoute(makeService: MakeService) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const qs = new URLSearchParams({ limit: String(PAGE), asc: "false" });
    const cursor = c.req.query("cursor");
    if (cursor) qs.set("before", cursor);
    const videos = await cfJson<CfVideo[]>(creds, `/stream?${qs}`);
    const items = videos.map(toStreamItem);
    const last = videos[videos.length - 1];
    const nextCursor = videos.length === PAGE && last?.created ? last.created : null;
    return c.json({ videos: items, cursor: nextCursor });
  });

  app.get("/:uid", async (c) => {
    const creds = await makeService(c.env).credentials();
    if (!creds) return c.json({ error: "Not connected" }, 409);
    const video = await cfJson<CfVideo>(creds, `/stream/${c.req.param("uid")}`);
    return c.json(toStreamItem(video));
  });

  return app;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- routes/stream`
Expected: PASS — 2 tests passed.

- [ ] **Step 5: Mount the route in `worker/src/index.ts`**

Add the import:
```ts
import { streamRoute } from "./routes/stream";
```
And mount it after the images route:
```ts
app.route("/api/stream", streamRoute(makeService));
```

- [ ] **Step 6: Typecheck, test, commit**

Run: `npm run typecheck && npm run test`
Expected: PASS.
```bash
git add worker/src/routes/stream.ts worker/src/routes/stream.test.ts worker/src/index.ts
git commit -m "feat(worker): stream list + detail proxy routes"
```

---

### Task 15: Client — stream panel

**Files:**
- Create: `src/components/StreamCard.tsx`
- Create: `src/components/StreamDetailDrawer.tsx`
- Create: `src/components/StreamPanel.tsx`
- Modify: `src/routes/gallery.tsx`

- [ ] **Step 1: Create `src/components/StreamCard.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Badge, Card, Image, Text } from "@mantine/core";
import { IconPlayerPlayFilled } from "@tabler/icons-react";
import type { StreamItem } from "@/lib/cf-api";

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StreamCard({ item, onOpen }: { item: StreamItem; onOpen: (item: StreamItem) => void }) {
  return (
    <Card
      withBorder
      padding={0}
      radius="md"
      className="break-inside-avoid cursor-pointer overflow-hidden relative"
      onClick={() => onOpen(item)}
    >
      {item.thumbnail ? (
        <Image src={item.thumbnail} alt={item.name} loading="lazy" />
      ) : (
        <Text p="sm" size="sm" c="dimmed">
          No thumbnail
        </Text>
      )}
      <IconPlayerPlayFilled
        size={28}
        style={{ position: "absolute", top: "40%", left: "calc(50% - 14px)", color: "white", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.6))" }}
      />
      {item.duration > 0 && (
        <Badge size="sm" variant="filled" color="dark" style={{ position: "absolute", bottom: 28, right: 6 }}>
          {fmt(item.duration)}
        </Badge>
      )}
      <Text p="xs" size="xs" lineClamp={1} title={item.name}>
        {item.name}
      </Text>
    </Card>
  );
}
```

- [ ] **Step 2: Create `src/components/StreamDetailDrawer.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Alert, Badge, Drawer, Group, Stack, Table, Text } from "@mantine/core";
import type { StreamItem } from "@/lib/cf-api";

export function StreamDetailDrawer({
  item,
  onClose,
}: {
  item: StreamItem | null;
  onClose: () => void;
}) {
  return (
    <Drawer opened={item !== null} onClose={onClose} position="right" size="lg" title={item?.name}>
      {item && (
        <Stack>
          {item.readyToStream && item.iframeUrl ? (
            <div style={{ position: "relative", paddingTop: "56.25%" }}>
              <iframe
                title={item.name}
                src={item.iframeUrl}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
              />
            </div>
          ) : (
            <Alert color="yellow">
              {item.requireSignedURLs
                ? "This video requires signed URLs; playback needs a token (added in a later phase)."
                : `Video is not ready to stream (status: ${item.status}).`}
            </Alert>
          )}
          <Group gap="xs">
            <Badge variant="light">{item.uid}</Badge>
            <Badge color={item.status === "ready" ? "green" : "gray"}>{item.status}</Badge>
            {item.requireSignedURLs && <Badge color="orange">signed URLs</Badge>}
          </Group>
          {Object.keys(item.meta).length > 0 && (
            <Table>
              <Table.Tbody>
                {Object.entries(item.meta).map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>{k}</Table.Td>
                    <Table.Td>{v}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="sm" c="dimmed">
            Created {item.created || "—"}
          </Text>
        </Stack>
      )}
    </Drawer>
  );
}
```

- [ ] **Step 3: Create `src/components/StreamPanel.tsx`**

```tsx
/* AGPL-3.0-or-later */
import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MediaGrid } from "@/components/MediaGrid";
import { StreamCard } from "@/components/StreamCard";
import { StreamDetailDrawer } from "@/components/StreamDetailDrawer";
import { listStream, type StreamItem } from "@/lib/cf-api";

export function StreamPanel() {
  const [selected, setSelected] = useState<StreamItem | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["stream"],
    queryFn: ({ pageParam }) => listStream(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor ?? undefined,
  });

  if (query.isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const videos = query.data?.pages.flatMap((p) => p.videos) ?? [];
  if (videos.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">No Stream videos in this account yet.</Text>
      </Center>
    );
  }

  return (
    <Stack>
      <MediaGrid>
        {videos.map((item) => (
          <StreamCard key={item.uid} item={item} onOpen={setSelected} />
        ))}
      </MediaGrid>
      {query.hasNextPage && (
        <Center>
          <Button variant="default" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            Load more
          </Button>
        </Center>
      )}
      <StreamDetailDrawer item={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}
```

- [ ] **Step 4: Wire `StreamPanel` into `src/routes/gallery.tsx`**

Add the import:
```tsx
import { StreamPanel } from "@/components/StreamPanel";
```
Replace the stream `Tabs.Panel` line:
```tsx
        <Tabs.Panel value="stream">{/* StreamPanel added in Task 15 */}</Tabs.Panel>
```
with:
```tsx
        <Tabs.Panel value="stream">
          <StreamPanel />
        </Tabs.Panel>
```

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck`
Expected: PASS.
```bash
git add src/components/StreamCard.tsx src/components/StreamDetailDrawer.tsx src/components/StreamPanel.tsx src/routes/gallery.tsx
git commit -m "feat(client): stream panel with player detail drawer"
```

---

### Task 16: Full verification + README note

**Files:**
- Modify: `README.md` (short section), or `CHANGELOG.md`

- [ ] **Step 1: Run the full check suite**

Run:
```bash
npm run check && npm run typecheck && npm run test && npm run build
```
Expected: Biome clean, types pass, all Vitest tests pass, Vite build + worker typecheck succeed.

- [ ] **Step 2: End-to-end manual verification**

With `.dev.vars` set (Task 13, Step 7) and the local migration applied, run `npm run dev` and confirm:
1. `/` redirects to `/settings` before connecting.
2. After saving a valid token, the gallery loads.
3. Images tab: grid renders; detail drawer opens with variants.
4. Stream tab: grid renders thumbnails; detail drawer plays a ready, public video in the iframe.
5. Settings gear returns to `/settings`; shows the connected account.

- [ ] **Step 3: Add a CHANGELOG entry**

Under the `## [Unreleased]` section of `CHANGELOG.md`, add:
```markdown
### Added
- Cloudflare Media Gallery (phase 1): Access-gated single-user app that connects to a Cloudflare account (encrypted API token in D1) and browses all Images and Stream assets in a tabbed masonry gallery with read-only detail drawers.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for read-only media gallery"
```

---

## Self-Review

**Spec coverage (phases 0–2):**
- Connect flow (paste token + account ID, encrypted in D1, discover hash/code) → Tasks 3, 6, 7, 8, 10, 11. ✓
- App lock via Cloudflare Access + JWT verification + dev bypass → Tasks 2, 9, 10. ✓
- Images gallery (v2 cursor list, masonry grid, infinite scroll, detail drawer, delivery thumbnails) → Tasks 12, 13. ✓
- Stream gallery (list, thumbnails, iframe player, detail drawer) → Tasks 14, 15. ✓
- Worker thin proxy / browser never holds token → Tasks 5, 8, 12, 14. ✓
- No D1 metadata mirroring; client caching via TanStack Query → Tasks 13, 15 (useInfiniteQuery). ✓
- Testing: Vitest units for crypto/urls/cf/store/service/access/route contracts → Tasks 3–10, 12, 14. ✓

**Deferred to later plans (correctly out of scope here):** image transforms/flexible variants, pixel editor, metadata edit/rename/delete, uploads, Stream thumbnail/clip/captions, signed-asset viewing. The Stream drawer surfaces a clear notice for signed/not-ready videos rather than failing silently.

**Type consistency:** `ImageItem`/`ImagesPage`/`StreamItem`/`StreamPage` shapes match between the Worker mappers (`toImageItem` in Task 12, `toStreamItem` in Task 14) and the client contract types (`src/lib/cf-api.ts`, Task 11). `ConnectionService` methods (`getStatus`, `connect`, `test`, `credentials`) are defined in Task 8 and consumed unchanged in Tasks 10, 12, 14. `makeService` signature `(env) => ConnectionService` is consistent across Tasks 10, 12, 14, and `index.ts`.

**Known cross-task dependency:** Task 11 references `Gallery`, satisfied by a stub in the same task and replaced in Task 13. Flagged inline.

**Placeholder scan:** none — every code step contains complete, runnable code.
