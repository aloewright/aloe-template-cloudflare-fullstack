# SaaS Boilerplate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn this Cloudflare full-stack template into a learning artifact for building SaaS on the edge — Polar billing, a stub-gated dashboard with a no-payment "Enter demo" button, a Mantine landing page, a Deploy-to-Cloudflare button, and a separately deployed Docusaurus docs site.

**Architecture:** Single Worker serves a React SPA + Hono API + D1. Polar drives billing through `/api/checkout` (creates session) → Polar hosted checkout → `/api/checkout/success` (sets cookie, redirects) and `/api/webhook/polar` (verifies signature, writes subscriptions to D1). `/dashboard` is gated by a `demo_unlock` cookie checked in a route loader against `/api/session`. A separate `docs/` Docusaurus project deploys to Cloudflare Pages.

**Tech Stack:** Cloudflare Workers (workerd) + Hono + D1 + Drizzle (existing). React 19 + Vite 8 + Mantine 9 + TanStack Router/Query (existing). `@polar-sh/sdk` (new). Docusaurus 3 (new, in `docs/`).

**Spec:** [`docs/superpowers/specs/2026-05-27-saas-boilerplate-design.md`](../specs/2026-05-27-saas-boilerplate-design.md)

---

## File map

**Modified:**
- `worker/src/index.ts` — refactored to mount route modules
- `worker/src/db/schema.ts` — add `subscriptions` table
- `src/router.tsx` — add `/dashboard` route
- `src/App.tsx` → replaced by `src/routes/landing.tsx`
- `wrangler.toml` — drop hardcoded `database_id`
- `README.md` — Deploy badge + Polar post-deploy steps
- `package.json` — add `@polar-sh/sdk`, docs:* scripts
- `biome.json` — exclude `docs/` (Docusaurus has its own formatting)

**Created:**
- `worker/src/polar.ts`
- `worker/src/routes/health.ts`
- `worker/src/routes/session.ts`
- `worker/src/routes/demo.ts`
- `worker/src/routes/checkout.ts`
- `worker/src/routes/success.ts`
- `worker/src/routes/webhook.ts`
- `worker/migrations/0001_subscriptions.sql`
- `src/routes/landing.tsx`
- `src/routes/dashboard.tsx`
- `src/lib/session.ts`
- `docs/` (full Docusaurus scaffold, 7 doc pages)

**Deleted:**
- `src/App.tsx` (content moves into `src/routes/landing.tsx`)

---

## Task 1: Add the `subscriptions` table + Drizzle migration

**Files:**
- Modify: `worker/src/db/schema.ts`
- Create: `worker/migrations/0001_subscriptions.sql`
- Create: `worker/drizzle.config.ts` (drizzle-kit config so generation works)

- [ ] **Step 1: Add the `subscriptions` table definition**

Append to `worker/src/db/schema.ts`:

```ts
export const subscriptions = sqliteTable("subscriptions", {
  // Polar subscription id (sub_xxx); primary key so webhooks upsert cleanly.
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  customerEmail: text("customer_email").notNull(),
  productId: text("product_id").notNull(),
  priceId: text("price_id"),
  // active | canceled | past_due | incomplete | trialing — see Polar docs.
  status: text("status").notNull(),
  currentPeriodEnd: integer("current_period_end", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
```

- [ ] **Step 2: Create Drizzle config so `drizzle-kit generate` finds the schema**

Create `worker/drizzle.config.ts`:

```ts
import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
} satisfies Config;
```

- [ ] **Step 3: Generate the migration**

Run:
```bash
cd worker && npx drizzle-kit generate
```

Expected: a new file `worker/migrations/0001_subscriptions.sql` is written containing a `CREATE TABLE subscriptions ...` statement plus a `_journal.json` (or `meta/_journal.json`) tracking file.

- [ ] **Step 4: Verify typecheck still passes**

Run from repo root:
```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add worker/src/db/schema.ts worker/drizzle.config.ts worker/migrations/
git commit -m "Add subscriptions table + drizzle config"
```

---

## Task 2: Install Polar SDK and create the client factory

**Files:**
- Modify: `package.json`
- Create: `worker/src/polar.ts`

- [ ] **Step 1: Install the SDK**

```bash
npm install @polar-sh/sdk
```

Expected: `@polar-sh/sdk` appears in `dependencies`. The SDK is workerd-compatible because we have `nodejs_compat`.

- [ ] **Step 2: Create the Polar client factory**

Create `worker/src/polar.ts`:

```ts
/* AGPL-3.0-or-later */
import { Polar } from "@polar-sh/sdk";

// The Polar server selector. Sandbox is the default for local + demo use;
// flip POLAR_SERVER to "production" once you have a live product.
export type PolarServer = "sandbox" | "production";

export type PolarEnv = {
  POLAR_ACCESS_TOKEN: string;
  POLAR_WEBHOOK_SECRET: string;
  POLAR_PRODUCT_ID: string;
  POLAR_SERVER?: PolarServer;
};

// One client per request — Polar instances are cheap and stateless.
export function createPolar(env: PolarEnv): Polar {
  return new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER ?? "sandbox",
  });
}
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: exit 0. The SDK ships types so `Polar` resolves.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json worker/src/polar.ts
git commit -m "Add Polar SDK and client factory"
```

---

## Task 3: Refactor the worker entry to mount route modules

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/src/routes/health.ts`

This task is purely structural — we move the existing `/api/health` handler into a route module so subsequent tasks have a place to add their own modules.

- [ ] **Step 1: Extract the health route into its own module**

Create `worker/src/routes/health.ts`:

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";

export const health = new Hono();

health.get("/", (c) => {
  return c.json({
    ok: true,
    service: "cf-saas-template",
    timestamp: new Date().toISOString(),
  });
});
```

- [ ] **Step 2: Rewrite `worker/src/index.ts` to mount route modules**

Replace the contents of `worker/src/index.ts` with:

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { PolarEnv } from "./polar";
import { health } from "./routes/health";

// Bindings exposed to every handler via Hono's `c.env`.
export type Bindings = {
  DB: D1Database;
} & PolarEnv;

const app = new Hono<{ Bindings: Bindings }>();

app.route("/api/health", health);

export default app;
```

Note: `/api/me` and `/api/auth/*` are removed. The spec says Better Auth stays scaffolded but unwired — its file (`worker/src/auth.ts`) is unchanged, but it's no longer mounted. Docs explain how to re-mount.

- [ ] **Step 3: Verify build + dev still work**

```bash
npm run build
```

Expected: exit 0. The TS compiler is satisfied; Vite builds the SPA; `tsc -p worker/tsconfig.json --noEmit` passes.

- [ ] **Step 4: Smoke test locally**

```bash
npm run dev
```

In a second shell:
```bash
curl http://127.0.0.1:8787/api/health
```

Expected: `{"ok":true,"service":"cf-saas-template","timestamp":"…"}`. Stop the dev server (`Ctrl-C`).

- [ ] **Step 5: Commit**

```bash
git add worker/src/index.ts worker/src/routes/health.ts
git commit -m "Refactor worker entry to mount route modules"
```

---

## Task 4: Session endpoint (cookie reader)

**Files:**
- Create: `worker/src/routes/session.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add a Hono helper for reading the demo-unlock cookie**

Create `worker/src/routes/session.ts`:

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { getCookie } from "hono/cookie";

export const COOKIE_NAME = "demo_unlock";

export const session = new Hono();

// GET /api/session — returns { unlocked: boolean }.
//
// The route loader on /dashboard reads this and throws redirect("/") when
// !unlocked. Replace the cookie check with a real auth lookup (e.g. Better
// Auth: `const session = await auth.api.getSession({ headers: c.req.raw.headers })`)
// when you wire authentication.
session.get("/", (c) => {
  const unlocked = getCookie(c, COOKIE_NAME) === "1";
  return c.json({ unlocked });
});
```

- [ ] **Step 2: Mount the route in `worker/src/index.ts`**

Modify `worker/src/index.ts` — add the import and `.route()` call:

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { PolarEnv } from "./polar";
import { health } from "./routes/health";
import { session } from "./routes/session";

export type Bindings = {
  DB: D1Database;
} & PolarEnv;

const app = new Hono<{ Bindings: Bindings }>();

app.route("/api/health", health);
app.route("/api/session", session);

export default app;
```

- [ ] **Step 3: Smoke test**

```bash
npm run dev
```

In a second shell:
```bash
curl http://127.0.0.1:8787/api/session
curl -H "Cookie: demo_unlock=1" http://127.0.0.1:8787/api/session
```

Expected: first call → `{"unlocked":false}`, second → `{"unlocked":true}`. Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/session.ts worker/src/index.ts
git commit -m "Add /api/session cookie reader"
```

---

## Task 5: Demo-unlock endpoint (cookie writer, no payment)

**Files:**
- Create: `worker/src/routes/demo.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Add the demo-unlock route**

Create `worker/src/routes/demo.ts`:

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { COOKIE_NAME } from "./session";

export const demo = new Hono();

// POST /api/demo/unlock — sets the demo-unlock cookie with no payment.
// Used by the "Enter demo" button on the landing page so visitors can
// explore /dashboard without going through Polar checkout.
demo.post("/unlock", (c) => {
  setCookie(c, COOKIE_NAME, "1", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Mount the route**

In `worker/src/index.ts` add:

```ts
import { demo } from "./routes/demo";
// ...
app.route("/api/demo", demo);
```

- [ ] **Step 3: Smoke test the round-trip**

```bash
npm run dev
```

In a second shell:
```bash
# Unlock and capture the Set-Cookie header
curl -i -X POST http://127.0.0.1:8787/api/demo/unlock -c cookies.txt

# Replay the cookie to /api/session
curl -b cookies.txt http://127.0.0.1:8787/api/session
```

Expected: first call returns `{"ok":true}` and `Set-Cookie: demo_unlock=1; ...`. Second call returns `{"unlocked":true}`. Stop the dev server. Clean up: `rm cookies.txt`.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/demo.ts worker/src/index.ts
git commit -m "Add /api/demo/unlock cookie writer"
```

---

## Task 6: Polar checkout creation endpoint

**Files:**
- Create: `worker/src/routes/checkout.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create the checkout route**

Create `worker/src/routes/checkout.ts`:

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { createPolar } from "../polar";
import type { Bindings } from "../index";

export const checkout = new Hono<{ Bindings: Bindings }>();

// POST /api/checkout — creates a Polar checkout session and returns its URL.
//
// The client redirects the browser to this URL. Polar handles the hosted
// payment page; on success it redirects back to /api/checkout/success.
checkout.post("/", async (c) => {
  const polar = createPolar(c.env);
  const origin = new URL(c.req.url).origin;

  const result = await polar.checkouts.create({
    productId: c.env.POLAR_PRODUCT_ID,
    successUrl: `${origin}/api/checkout/success?checkout_id={CHECKOUT_ID}`,
  });

  return c.json({ url: result.url });
});
```

- [ ] **Step 2: Mount the route**

In `worker/src/index.ts` add:

```ts
import { checkout } from "./routes/checkout";
// ...
app.route("/api/checkout", checkout);
```

- [ ] **Step 3: Verify build (no runtime test — would call sandbox)**

```bash
npm run build
```

Expected: exit 0. Real runtime verification happens after deploy when sandbox secrets are set.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/checkout.ts worker/src/index.ts
git commit -m "Add /api/checkout (Polar session creation)"
```

---

## Task 7: Polar checkout-success redirect handler

**Files:**
- Create: `worker/src/routes/success.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create the success route**

Create `worker/src/routes/success.ts`:

```ts
/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createPolar } from "../polar";
import { COOKIE_NAME } from "./session";
import type { Bindings } from "../index";

export const success = new Hono<{ Bindings: Bindings }>();

// GET /api/checkout/success?checkout_id=… — Polar redirects users here after
// payment. We verify the checkout against the Polar API (don't trust the
// redirect blindly), set the demo-unlock cookie, then 302 to /dashboard.
//
// In production the cookie is *not* the source of truth — the webhook handler
// writes subscription rows to D1. The cookie is just the UX hint for "this
// browser session has access". Real auth replaces this with a session lookup.
success.get("/", async (c) => {
  const checkoutId = c.req.query("checkout_id");
  if (!checkoutId) {
    return c.text("Missing checkout_id", 400);
  }

  const polar = createPolar(c.env);
  const result = await polar.checkouts.get({ id: checkoutId });

  if (result.status !== "succeeded") {
    return c.text(`Checkout not complete (status=${result.status})`, 400);
  }

  setCookie(c, COOKIE_NAME, "1", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return c.redirect("/dashboard");
});
```

- [ ] **Step 2: Mount the route**

In `worker/src/index.ts` add:

```ts
import { success } from "./routes/success";
// ...
app.route("/api/checkout/success", success);
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/success.ts worker/src/index.ts
git commit -m "Add /api/checkout/success (cookie + redirect)"
```

---

## Task 8: Polar webhook handler

**Files:**
- Create: `worker/src/routes/webhook.ts`
- Modify: `worker/src/index.ts`

- [ ] **Step 1: Create the webhook route**

Create `worker/src/routes/webhook.ts`:

```ts
/* AGPL-3.0-or-later */
import { validateEvent, WebhookVerificationError } from "@polar-sh/sdk/webhooks";
import { Hono } from "hono";
import { createDatabase } from "../db";
import { subscriptions } from "../db/schema";
import type { Bindings } from "../index";

export const webhook = new Hono<{ Bindings: Bindings }>();

// POST /api/webhook/polar — verifies HMAC, upserts subscription rows.
//
// This is the production source of truth for subscription state. The cookie
// path set by /api/checkout/success is just the demo UX; real auth would look
// up subscription status via D1 → subscriptions table → user id mapping.
webhook.post("/", async (c) => {
  const body = await c.req.text();

  // Standard Webhooks spec headers used by Polar.
  const headers = {
    "webhook-id": c.req.header("webhook-id") ?? "",
    "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
    "webhook-signature": c.req.header("webhook-signature") ?? "",
  };

  let event: Awaited<ReturnType<typeof validateEvent>>;
  try {
    event = validateEvent(body, headers, c.env.POLAR_WEBHOOK_SECRET);
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return c.text("invalid signature", 401);
    }
    throw err;
  }

  if (
    event.type === "subscription.created" ||
    event.type === "subscription.updated" ||
    event.type === "subscription.canceled"
  ) {
    const sub = event.data;
    const db = createDatabase(c.env);

    await db
      .insert(subscriptions)
      .values({
        id: sub.id,
        customerId: sub.customerId,
        customerEmail: sub.customer?.email ?? "",
        productId: sub.productId,
        priceId: sub.priceId ?? null,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd
          ? new Date(sub.currentPeriodEnd)
          : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: {
          status: sub.status,
          priceId: sub.priceId ?? null,
          currentPeriodEnd: sub.currentPeriodEnd
            ? new Date(sub.currentPeriodEnd)
            : null,
          updatedAt: new Date(),
        },
      });
  }

  // Always 200 after verification — Polar retries non-2xx.
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Mount the route**

In `worker/src/index.ts` add:

```ts
import { webhook } from "./routes/webhook";
// ...
app.route("/api/webhook/polar", webhook);
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add worker/src/routes/webhook.ts worker/src/index.ts
git commit -m "Add /api/webhook/polar (signature verify + D1 upsert)"
```

---

## Task 9: Client-side session loader helper

**Files:**
- Create: `src/lib/session.ts`

- [ ] **Step 1: Create the loader helper**

Create `src/lib/session.ts`:

```ts
/* AGPL-3.0-or-later */
import { redirect } from "@tanstack/react-router";
import { fetchJson } from "@/lib/api";

type SessionResponse = { unlocked: boolean };

// Route loaders for protected routes call this. If the user isn't unlocked
// we throw a redirect (TanStack Router catches it and navigates). When you
// wire real auth, swap the /api/session call for your auth library's session
// check and keep the throw-redirect pattern.
export async function requireUnlocked() {
  const { unlocked } = await fetchJson<SessionResponse>("/api/session");
  if (!unlocked) {
    throw redirect({ to: "/" });
  }
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/session.ts
git commit -m "Add requireUnlocked loader helper"
```

---

## Task 10: Build the protected dashboard route

**Files:**
- Create: `src/routes/dashboard.tsx`

- [ ] **Step 1: Create the dashboard page**

Create `src/routes/dashboard.tsx`:

```tsx
/* AGPL-3.0-or-later */
import { Badge, Card, Container, Group, Stack, Text, Title } from "@mantine/core";

export function Dashboard() {
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={1}>Dashboard</Title>
            <Text c="dimmed">You're inside the protected route.</Text>
          </div>
          <Badge color="green" variant="light">
            unlocked
          </Badge>
        </Group>

        <Card withBorder padding="lg" radius="md">
          <Text fw={500} mb="xs">
            What you'd put here
          </Text>
          <Text size="sm" c="dimmed">
            This is the screen a paying user sees. In the template it's gated by a stub
            cookie set by either Polar checkout success or the "Enter demo" button on the
            landing page. Replace the cookie check in <code>worker/src/routes/session.ts</code>
            with a real auth + subscription lookup to ship for real.
          </Text>
        </Card>
      </Stack>
    </Container>
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/routes/dashboard.tsx
git commit -m "Add dashboard route component"
```

---

## Task 11: Build the landing page

**Files:**
- Create: `src/routes/landing.tsx`
- Modify: `src/lib/api.ts` (add helpers for checkout + demo unlock)

- [ ] **Step 1: Add client API helpers**

Read `src/lib/api.ts` first. It currently exports `fetchJson`. Append:

```ts
type CheckoutResponse = { url: string };

export async function startCheckout(): Promise<string> {
  const res = await fetchJson<CheckoutResponse>("/api/checkout", { method: "POST" });
  return res.url;
}

export async function unlockDemo(): Promise<void> {
  await fetchJson<{ ok: true }>("/api/demo/unlock", { method: "POST" });
}
```

(If `fetchJson` doesn't accept a `RequestInit` overload, widen its signature accordingly — preserve existing GET callers.)

- [ ] **Step 2: Create the landing page**

Create `src/routes/landing.tsx`:

```tsx
/* AGPL-3.0-or-later */
import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  List,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { startCheckout, unlockDemo } from "@/lib/api";

export function Landing() {
  const navigate = useNavigate();

  async function onSubscribe() {
    const url = await startCheckout();
    window.location.href = url;
  }

  async function onEnterDemo() {
    await unlockDemo();
    navigate({ to: "/dashboard" });
  }

  return (
    <main>
      {/* Hero */}
      <Container size="lg" py={{ base: 60, md: 100 }}>
        <Stack gap="md" align="center" ta="center">
          <Badge size="lg" variant="light">
            Cloudflare SaaS template
          </Badge>
          <Title order={1} size={56} lh={1.1}>
            Ship a SaaS on the edge in an afternoon.
          </Title>
          <Text size="xl" c="dimmed" maw={640}>
            A working reference: React + Mantine on the front, Hono on a Cloudflare Worker,
            D1 for data, Polar for billing. Read the code, not a tutorial.
          </Text>
          <Group mt="md">
            <Button size="lg" onClick={onSubscribe}>
              Subscribe with Polar
            </Button>
            <Button size="lg" variant="light" onClick={onEnterDemo}>
              Enter demo
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            "Enter demo" sets a cookie and drops you into the protected route. No payment.
          </Text>
        </Stack>
      </Container>

      <Divider />

      {/* Features */}
      <Container size="lg" py={{ base: 60, md: 80 }}>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          <FeatureCard
            title="Auth-ready"
            body="Better Auth is scaffolded; drop your provider keys to flip on email + OAuth."
          />
          <FeatureCard
            title="Edge-native"
            body="Single Worker serves the SPA and the API from every Cloudflare POP."
          />
          <FeatureCard
            title="One-click deploy"
            body="Click the badge in the README. Cloudflare provisions the Worker + D1 for you."
          />
        </SimpleGrid>
      </Container>

      <Divider />

      {/* Pricing */}
      <Container size="sm" py={{ base: 60, md: 80 }}>
        <Stack gap="lg" align="center">
          <Title order={2} ta="center">
            One tier, to demonstrate Polar
          </Title>
          <Card withBorder radius="md" padding="xl" w="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600} size="lg">
                  Pro
                </Text>
                <Text fw={700} size="xl">
                  $19<Text component="span" c="dimmed" size="md"> /mo</Text>
                </Text>
              </Group>
              <List spacing="xs" size="sm">
                <List.Item>Access to /dashboard</List.Item>
                <List.Item>Polar customer portal</List.Item>
                <List.Item>Edge-served, sub-100ms cold start</List.Item>
              </List>
              <Button size="md" fullWidth onClick={onSubscribe}>
                Subscribe with Polar
              </Button>
            </Stack>
          </Card>
        </Stack>
      </Container>

      <Divider />

      {/* Footer */}
      <Container size="lg" py="xl">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            AGPL-3.0-or-later
          </Text>
          <Group gap="lg">
            <Anchor size="sm" href="https://github.com/aloewright/my-cf-template">
              GitHub
            </Anchor>
            <Anchor size="sm" href="https://template-docs.lazee.workers.dev">
              Docs
            </Anchor>
          </Group>
        </Group>
      </Container>
    </main>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="sm">
        <ThemeIcon variant="light" size="lg" radius="md">
          <Box w={8} h={8} bg="currentColor" style={{ borderRadius: 2 }} />
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        <Text size="sm" c="dimmed">
          {body}
        </Text>
      </Stack>
    </Card>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/routes/landing.tsx src/lib/api.ts
git commit -m "Add landing page (hero, features, pricing, dual CTAs)"
```

---

## Task 12: Wire the router (landing + protected dashboard) and retire App.tsx

**Files:**
- Modify: `src/router.tsx`
- Delete: `src/App.tsx`

- [ ] **Step 1: Rewrite the router**

Replace the contents of `src/router.tsx` with:

```tsx
/* AGPL-3.0-or-later */
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Dashboard } from "@/routes/dashboard";
import { Landing } from "@/routes/landing";
import { requireUnlocked } from "@/lib/session";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  // The loader runs before render. If !unlocked, requireUnlocked throws
  // redirect({ to: "/" }) and TanStack Router handles the navigation.
  loader: requireUnlocked,
  component: Dashboard,
});

const routeTree = rootRoute.addChildren([indexRoute, dashboardRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 2: Delete the old App.tsx**

```bash
rm src/App.tsx
```

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

Expected: exit 0. Vite builds the new route components; the Worker typecheck passes.

- [ ] **Step 4: Smoke test in the browser**

```bash
npm run dev
```

Open http://127.0.0.1:5173:
- Landing page renders with two CTAs.
- "Enter demo" → click → routes to `/dashboard` and renders the protected component.
- Open a fresh incognito window, navigate directly to `/dashboard` → redirects back to `/`.

Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add src/router.tsx
git rm src/App.tsx
git commit -m "Wire landing + protected dashboard routes"
```

---

## Task 13: Update wrangler.toml for one-click deploy

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: Drop the hardcoded `database_id`**

Replace the contents of `wrangler.toml` with:

```toml
name = "template"
main = "worker/src/index.ts"
compatibility_date = "2025-02-01"
compatibility_flags = ["nodejs_compat"]

assets = { directory = "dist" }

# D1 binding. database_id is intentionally omitted so the
# "Deploy to Cloudflare" flow auto-provisions a fresh D1 on first deploy.
# After deploy, `wrangler d1 list` will show the assigned id; locals can
# fill it back in if needed for direct CLI work.
[[d1_databases]]
binding       = "DB"
database_name = "template"
```

- [ ] **Step 2: Verify local `wrangler dev` still works**

```bash
npm run dev
```

Local dev simulates D1 with a SQLite file under `.wrangler/state/`, so the missing `database_id` doesn't break local dev. The landing page should still load at http://127.0.0.1:5173.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add wrangler.toml
git commit -m "Drop hardcoded D1 id for one-click deploy"
```

---

## Task 14: Add Deploy badge + post-deploy steps to README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the Deploy badge under the title**

Insert this immediately after the title line in `README.md`:

```md
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/aloewright/my-cf-template)
```

- [ ] **Step 2: Add a "Post-deploy setup" section**

Insert this new section right after the existing "Setup" section in `README.md`:

```md
## Post-deploy setup (one-click deploy users)

The Deploy badge above provisions a Worker and a D1 database in your account, but
the SaaS bits need three secrets and one migration before billing works.

```bash
# 1. Set Polar secrets (use sandbox tokens while you're testing)
echo "polar_oat_…"       | npx wrangler secret put POLAR_ACCESS_TOKEN
echo "polar_whsec_…"     | npx wrangler secret put POLAR_WEBHOOK_SECRET
echo "prod_…"            | npx wrangler secret put POLAR_PRODUCT_ID
# Optional: flip to production once you're live
echo "production"        | npx wrangler secret put POLAR_SERVER

# 2. Apply migrations to the freshly-provisioned D1
npx wrangler d1 migrations apply template --remote

# 3. Point Polar's webhook URL at:
#    https://<your-worker>.<your-subdomain>.workers.dev/api/webhook/polar
```

Visit your deploy URL — the landing page should render. "Enter demo" works
without any of the above (it just sets the cookie). "Subscribe with Polar"
needs the secrets to hit the API.
```

- [ ] **Step 3: Update the live demo URL line**

The existing README references `https://template.lazee.workers.dev`. Leave it — that's the maintained demo.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "Add Deploy to Cloudflare badge and post-deploy steps"
```

---

## Task 15: Scaffold Docusaurus in docs/

**Files:**
- Create: full `docs/` tree via the Docusaurus CLI
- Modify: `package.json` (add docs:* pass-through scripts)
- Modify: `biome.json` (exclude docs/)

- [ ] **Step 1: Scaffold Docusaurus**

```bash
npx create-docusaurus@latest docs classic --typescript
```

Expected: a new `docs/` directory containing `package.json`, `docusaurus.config.ts`, `sidebars.ts`, default starter content under `docs/docs/`, and `docs/src/`.

- [ ] **Step 2: Add pass-through scripts to root `package.json`**

In the root `package.json` `"scripts"` block, add:

```json
"docs:dev":    "npm --prefix docs run start",
"docs:build":  "npm --prefix docs run build",
"docs:deploy": "npm --prefix docs run build && npx wrangler pages deploy docs/build --project-name template-docs"
```

- [ ] **Step 3: Exclude docs/ from Biome**

In `biome.json` `files.includes`, append `"!**/docs"` so Docusaurus's own formatting rules aren't fought:

```json
"includes": [
  "**",
  "!**/dist",
  "!**/.wrangler",
  "!**/node_modules",
  "!**/.claude",
  "!**/.codex",
  "!**/.agents",
  "!**/docs"
]
```

- [ ] **Step 4: Verify Docusaurus dev server boots**

```bash
npm run docs:dev
```

Expected: Docusaurus prints `Docusaurus website is running at http://localhost:3000/`. Stop with Ctrl-C.

- [ ] **Step 5: Verify biome still passes**

```bash
npm run lint
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add docs/ package.json biome.json
git commit -m "Scaffold Docusaurus + add docs:* scripts"
```

---

## Task 16: Customize Docusaurus config and write doc pages

**Files:**
- Modify: `docs/docusaurus.config.ts`
- Modify: `docs/sidebars.ts`
- Replace: contents of `docs/docs/` (delete defaults, add 7 pages)

- [ ] **Step 1: Set the site identity in docusaurus.config.ts**

In `docs/docusaurus.config.ts`, set:

```ts
const config: Config = {
  title: "Cloudflare SaaS Template",
  tagline: "Reference SaaS on Cloudflare Workers",
  favicon: "img/favicon.ico",
  url: "https://template-docs.lazee.workers.dev",
  baseUrl: "/",
  organizationName: "aloewright",
  projectName: "my-cf-template",
  onBrokenLinks: "throw",
  onBrokenMarkdownLinks: "warn",
  i18n: { defaultLocale: "en", locales: ["en"] },
  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/", // serve docs at site root
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies import("@docusaurus/preset-classic").Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: "Cloudflare SaaS Template",
      items: [
        { href: "https://template.lazee.workers.dev", label: "Live demo", position: "right" },
        { href: "https://github.com/aloewright/my-cf-template", label: "GitHub", position: "right" },
      ],
    },
    footer: { style: "light", copyright: "AGPL-3.0-or-later" },
  } satisfies import("@docusaurus/preset-classic").ThemeConfig,
};
export default config;
```

(Preserve existing imports — only swap the fields listed above.)

- [ ] **Step 2: Delete the default doc pages**

```bash
rm -rf docs/docs/tutorial-basics docs/docs/tutorial-extras
rm -f docs/docs/intro.md
```

- [ ] **Step 3: Write `docs/docs/intro.md`**

```md
---
sidebar_position: 1
---

# Introduction

This template is a working reference for shipping a SaaS on Cloudflare Workers.
It's deliberately minimal — one Worker serves the React UI and the API, D1
backs the data, Polar handles billing, and a stubbed gate demonstrates the
protected-route pattern without requiring you to wire auth.

The live demo at [template.lazee.workers.dev](https://template.lazee.workers.dev)
is deployed from this exact code. Click "Enter demo" to see the protected
route without paying anything.
```

- [ ] **Step 4: Write `docs/docs/architecture.md`**

```md
---
sidebar_position: 2
---

# Architecture

Two co-deployed projects:

- **Worker** at `template.<subdomain>.workers.dev` — serves the SPA via Workers
  Assets and the API via Hono. Bound to D1.
- **Pages** at `template-docs.<subdomain>.pages.dev` — this Docusaurus site.

## Request flow

1. `GET /` → Workers Assets serves the built SPA shell.
2. The SPA boots, TanStack Router renders `<Landing>`.
3. Clicking **Enter demo** → `POST /api/demo/unlock` → cookie set → navigate to `/dashboard`.
4. The `/dashboard` route loader hits `GET /api/session` and either renders or throws `redirect("/")`.
5. Clicking **Subscribe with Polar** → `POST /api/checkout` → redirect to Polar → return through `/api/checkout/success` → cookie + 302 to `/dashboard`.
6. Polar separately fires `POST /api/webhook/polar` for `subscription.*` events; the handler verifies the signature and writes to D1.
```

- [ ] **Step 5: Write `docs/docs/billing-polar.md`**

```md
---
sidebar_position: 3
---

# Billing (Polar)

Polar is the merchant of record. The Worker only talks to Polar via the SDK.

## Secrets

| Name | Purpose |
|---|---|
| `POLAR_ACCESS_TOKEN` | Server-side API token (org-scoped) |
| `POLAR_WEBHOOK_SECRET` | HMAC secret for webhook verification |
| `POLAR_PRODUCT_ID` | The subscription product the checkout creates against |
| `POLAR_SERVER` | `sandbox` (default) or `production` |

Set them with `wrangler secret put`.

## Checkout flow

`worker/src/routes/checkout.ts` calls `polar.checkouts.create({ productId, successUrl })`
and returns the URL. The client navigates the browser to that URL.

## Success handler

`worker/src/routes/success.ts` is the `successUrl` target. It re-fetches the
checkout from Polar to verify status (don't trust the redirect alone), sets the
demo-unlock cookie, and 302s to `/dashboard`.

## Webhook

`worker/src/routes/webhook.ts` uses `validateEvent` from `@polar-sh/sdk/webhooks`
to verify the signature, then upserts a `subscriptions` row keyed by Polar
subscription id. Always returns 200 after verification — non-2xx triggers Polar
retry storms.
```

- [ ] **Step 6: Write `docs/docs/protected-routes.md`**

```md
---
sidebar_position: 4
---

# Protected routes

The pattern is the same one any SaaS uses, slimmed to the essentials:

```
Route loader  →  fetch /api/session  →  { unlocked }  →  render or throw redirect
```

## Stub gate

`worker/src/routes/session.ts` reads a single cookie (`demo_unlock`). That's the
stub. Both `/api/demo/unlock` and `/api/checkout/success` set it.

## Replacing it with real auth

Swap the cookie read for your auth library's session lookup. For Better Auth:

```ts
import { createAuth } from "../auth";

session.get("/", async (c) => {
  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return c.json({ unlocked: Boolean(session) });
});
```

For a real production gate, also check D1 for an active subscription row:

```ts
const sub = await db.query.subscriptions.findFirst({
  where: (s, { and, eq }) =>
    and(eq(s.customerEmail, session.user.email), eq(s.status, "active")),
});
return c.json({ unlocked: Boolean(sub) });
```
```

- [ ] **Step 7: Write `docs/docs/database-d1.md`**

```md
---
sidebar_position: 5
---

# Database (D1 + Drizzle)

Schema lives in `worker/src/db/schema.ts`. Drizzle Kit generates SQL into
`worker/migrations/`.

## Add a column

1. Edit `schema.ts`.
2. Run `cd worker && npx drizzle-kit generate`.
3. Commit the new migration.
4. Apply locally: `npx wrangler d1 migrations apply template --local`.
5. Apply to prod: `npx wrangler d1 migrations apply template --remote`.

## Tables shipped in the template

- `notes` — demonstrates a plain Drizzle table.
- `subscriptions` — owned by the Polar webhook handler.

## Ad-hoc SQL

```bash
npx wrangler d1 execute template --remote \
  --command "SELECT * FROM subscriptions ORDER BY updated_at DESC LIMIT 10"
```
```

- [ ] **Step 8: Write `docs/docs/deploy.md`**

```md
---
sidebar_position: 6
---

# Deploy

## One-click

The README's Deploy badge points at:

```
https://deploy.workers.cloudflare.com/?url=https://github.com/aloewright/my-cf-template
```

Cloudflare clones the repo into your account, provisions the Worker and the D1
database (because `wrangler.toml` declares the binding but omits `database_id`),
and deploys.

## Post-deploy steps

Set Polar secrets, apply migrations, point Polar's webhook URL — see the
README "Post-deploy setup" section.

## Docs deploy

```bash
npm run docs:deploy
# Builds Docusaurus and runs:
# wrangler pages deploy docs/build --project-name template-docs
```

The first deploy will create the Pages project; subsequent deploys update it.

## Versions and rollback

```bash
npx wrangler versions list
npx wrangler rollback
```
```

- [ ] **Step 9: Write `docs/docs/customizing.md`**

```md
---
sidebar_position: 7
---

# Customizing

## Add a route

Two pieces — server and client.

**Server:** create `worker/src/routes/<name>.ts`, export a `Hono` instance, mount it in `worker/src/index.ts` with `app.route("/api/<name>", mod)`.

**Client:** create `src/routes/<Name>.tsx`, add it to `src/router.tsx`'s `routeTree` via `createRoute`.

## Wire Better Auth

The scaffold sits in `worker/src/auth.ts`. To turn it on:

1. `npx wrangler secret put BETTER_AUTH_SECRET` (32+ random bytes, base64).
2. Mount it: in `worker/src/index.ts` add `app.on(["GET","POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw))`.
3. Generate Better Auth's tables (`user`, `session`, `account`, `verification`) and add them as a Drizzle migration.
4. Replace the cookie check in `worker/src/routes/session.ts` with the auth-aware version from [Protected routes](./protected-routes.md).

## Swap Mantine for something else

`@mantine/*` packages are listed in `dependencies`. Replace them, drop the
`MantineProvider` wrapping in `src/main.tsx`, and rewrite `src/routes/landing.tsx`
in your component library of choice. Tailwind utility classes stay usable.
```

- [ ] **Step 10: Update `docs/sidebars.ts`**

Replace the contents of `docs/sidebars.ts` with:

```ts
import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  docs: [
    "intro",
    "architecture",
    "billing-polar",
    "protected-routes",
    "database-d1",
    "deploy",
    "customizing",
  ],
};

export default sidebars;
```

- [ ] **Step 11: Verify Docusaurus builds**

```bash
npm run docs:build
```

Expected: exit 0; build output written to `docs/build/`.

- [ ] **Step 12: Commit**

```bash
git add docs/
git commit -m "Customize Docusaurus config and write 7 doc pages"
```

---

## Final verification

After all 16 tasks land:

- [ ] **All-pass check**

```bash
npm run typecheck   # exit 0
npm run lint        # exit 0
npm run build       # exit 0
npm run docs:build  # exit 0
```

- [ ] **Push the branch and open a PR**

```bash
git push -u origin <branch-name>
gh pr create --base main --title "SaaS boilerplate (Polar, stub-gated dashboard, Docusaurus, one-click deploy)"
```

- [ ] **Manual smoke (post-merge, post-deploy)**

After the PR merges and the demo redeploys:
- Visit `https://template.lazee.workers.dev/` — landing page renders.
- Click "Enter demo" — lands on `/dashboard`.
- Open incognito, hit `/dashboard` directly — redirects to `/`.
- Run `npm run docs:deploy` from your machine, then visit `template-docs.<account>.pages.dev`.

---

## Self-review notes

- **Spec coverage:** Every item in the spec's "In scope" list has at least one task. Polar end-to-end → Tasks 2, 6, 7, 8. Stub gate → Tasks 4, 5. Enter demo → Task 5. Landing page → Task 11. One-click deploy → Tasks 13, 14. Docusaurus → Tasks 15, 16. "Out of scope" items (Better Auth wiring, password reset, multi-tier, teams, R2) appear as docs swap-in instructions only, not implementation tasks.
- **Placeholders:** None — every code step contains real code, every command step contains a real command.
- **Type consistency:** `COOKIE_NAME` exported from `session.ts` and reused by `demo.ts` + `success.ts`. `Bindings` type exported from `index.ts` and reused by `checkout.ts`, `success.ts`, `webhook.ts`. `requireUnlocked` defined in `src/lib/session.ts` and consumed in `src/router.tsx`.
