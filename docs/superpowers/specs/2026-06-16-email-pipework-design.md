# Email pipework (native Cloudflare Email Service) — Design

**Status:** Approved, awaiting implementation plan
**Date:** 2026-06-16
**Repo:** `aloewright/my-cf-template` (branch: `feature/email`)

## Goal

Add "easy email setup" to the template: wire in **Cloudflare's native Email Service** (the `send_email` Worker binding) so the app can send email out of the box, expose a thin `sendEmail()` helper, prove it with one example route, and hook it into the scaffolded **Better Auth** (verification + password-reset emails). Update the README to document it — and fix the stale lint/format row while we're there.

## Background — Cloudflare email as of June 2026

This supersedes the early-2026 understanding that "Cloudflare can only send to verified destination addresses." Cloudflare now ships **Email Service = Email Routing (inbound) + Email Sending (outbound, transactional)**:

- **Onboard a sending domain** (dash → Compute → Email Service → Email Sending → Onboard Domain). Cloudflare auto-provisions SPF + DKIM + DMARC DNS records under the `cf-bounce` subdomain. Requires the domain to use Cloudflare DNS.
- **Before** onboarding a sending domain: can send only to **verified destination addresses** (free, no quota, works with just Email Routing). **After** onboarding: send to **any recipient**.
- The Worker binding `send()` takes a **plain object** and returns `{ messageId }`. **`mimetext` / the `cloudflare:email` MIME module are legacy** — not needed.
- **`remote: true`** on the binding lets `wrangler dev` call the real Email Service API locally.
- Email **Sending** needs the **Workers Paid plan**; verified-destination sends are free on any plan. Daily quota starts conservative and scales with reputation.
- Gotcha: Worker sends appear as **"dropped"** in the Email Routing summary even when delivered — track success via Email sending **metrics/logs** instead.

Reference: https://developers.cloudflare.com/email-service/ (saved to agent memory as `cloudflare-email-service-2026.md`).

## Why this collapses an earlier (richer) design

An earlier draft proposed a provider-agnostic abstraction with a Resend adapter + `mimetext`, because native CF couldn't reach arbitrary recipients. **That constraint is gone**, so there is no third-party provider, no MIME building, and no new runtime dependency. The pipework is a thin wrapper over `env.EMAIL.send()`.

## Scope

### In scope
- `send_email` binding (`EMAIL`, `remote: true`) + `EMAIL_FROM` var in `wrangler.jsonc`.
- `worker/src/lib/email.ts` — `sendEmail(env, message)` thin wrapper over `env.EMAIL.send()`.
- `worker/src/routes/email.ts` — `POST /api/email/test`, Access-gated, sends to the authenticated operator; mounted in `index.ts`.
- `worker/src/auth.ts` — wire `emailVerification.sendVerificationEmail` and `emailAndPassword.sendResetPassword` to `sendEmail()`.
- `worker/src/types.ts` — `Bindings` gains `EMAIL: SendEmail` + `EMAIL_FROM: string`; regenerate `worker-configuration.d.ts`.
- README — fix **Biome → oxlint + Prettier**; add a 📧 bullet, a Tech Stack row, and an **## Email** section.
- Worker Vitest for the helper + route (fake `EMAIL` binding).

### Out of scope (YAGNI)
- Any third-party provider (Resend/SendGrid/SES) or provider-agnostic abstraction — native CF covers it.
- `mimetext` / raw `cloudflare:email` MIME messages, attachments, inbound `email()` handler / routing-rule processing.
- Actually enabling Better Auth in the request pipeline (it remains dormant scaffolding; `createAuth` is still not mounted in `index.ts`). We only wire the senders so it's ready.
- HTML email templating / a template system — plain inline `html` + `text` strings.
- Onboarding the sending domain itself (a dashboard/DNS action, documented in README as a setup step, not code).

## Configuration (`wrangler.jsonc`)

Add a send binding and a non-secret `from` address:

```jsonc
"send_email": [{ "name": "EMAIL", "remote": true }],
"vars": {
  // ...existing TEAM_DOMAIN, POLICY_AUD...
  "EMAIL_FROM": "noreply@media.aloewright.me"
}
```

- No restriction attribute → may send to any verified destination (and any recipient once a sending domain is onboarded). Optional hardening documented in README: `destination_address`, `allowed_destination_addresses`, `allowed_sender_addresses`.
- `EMAIL_FROM` must be an address on a domain you've onboarded for sending (or, pre-onboarding, irrelevant since only verified destinations receive). It is **not** a secret — a plain `var`.

## Email helper (`worker/src/lib/email.ts`)

```ts
/* AGPL-3.0-or-later */
import type { Bindings } from "../types";

export type EmailMessage = {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  from?: string; // defaults to env.EMAIL_FROM
};

/**
 * Send an email via Cloudflare's native Email Service binding.
 * Returns the provider messageId. Throws on send failure.
 *
 * Recipients: any *verified destination address* always works; *arbitrary*
 * recipients require a sending domain onboarded in Email Service (see README).
 */
export async function sendEmail(
  env: Pick<Bindings, "EMAIL" | "EMAIL_FROM">,
  msg: EmailMessage,
): Promise<{ messageId: string }> {
  const from = msg.from ?? env.EMAIL_FROM;
  const res = await env.EMAIL.send({
    from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text ?? stripHtml(msg.html),
  });
  return { messageId: res.messageId };
}
```

- `stripHtml(html?)` — a tiny local fallback so a `text` part always exists when only `html` is supplied (deliverability hygiene). If neither `html` nor `text` is provided, that's a programmer error → throw a clear `Error`.
- The helper takes a `Pick<Bindings, …>` rather than the whole env so it's trivially callable from both Hono routes and Better Auth.

## Example route (`worker/src/routes/email.ts`)

```ts
export const emailRoute = new Hono<AppEnv>();
emailRoute.post("/test", async (c) => {
  const to = c.get("email"); // authenticated operator from Access
  const { messageId } = await sendEmail(c.env, {
    to,
    subject: "Test email from your Cloudflare app",
    html: "<h1>It works</h1><p>Native Cloudflare Email Service is wired up.</p>",
  });
  return c.json({ ok: true, to, messageId });
});
```

Mounted in `index.ts`: `app.route("/api/email", emailRoute);` (under the existing `/api/*` `accessGuard`). Sending to `c.get("email")` means the test always targets the operator's own (verified) address, so it works even before a sending domain is onboarded.

## Better Auth wiring (`worker/src/auth.ts`)

Widen `createAuth`'s env param to carry the email bindings, and add the senders:

```ts
type Env = { DB: D1Database; EMAIL: SendEmail; EMAIL_FROM: string };

export function createAuth(env: Env) {
  return betterAuth({
    appName: "Warp Template Cloudflare Fullstack",
    database: env.DB,
    emailAndPassword: {
      enabled: true,
      // Native CF send: arbitrary recipients require an onboarded sending
      // domain; until then only verified destination addresses receive.
      sendResetPassword: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Reset your password",
          html: `<p>Click to reset your password:</p><p><a href="${url}">${url}</a></p>`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendEmail(env, {
          to: user.email,
          subject: "Verify your email",
          html: `<p>Confirm your email:</p><p><a href="${url}">${url}</a></p>`,
        });
      },
    },
  });
}
```

`createAuth` is still **not** mounted in `index.ts` — this is dormant scaffolding the README already describes. Any current caller passing `{ DB }` must be updated to pass `EMAIL` + `EMAIL_FROM` (grep during implementation; expected: none beyond a possible test).

## Types (`worker/src/types.ts`)

`Bindings` gains:
```ts
EMAIL: SendEmail;     // native Cloudflare Email Service send binding
EMAIL_FROM: string;   // default From address (var)
```
`SendEmail` is provided by the generated `worker-configuration.d.ts`; regenerate it with `npx wrangler types` after editing `wrangler.jsonc`.

## README changes (`README.md`)

1. **Fix the stale row** in the Tech Stack table: **Lint / Format** → `oxlint + Prettier` (currently says "Biome 2.4"), matching `package.json` scripts (`lint: oxlint`, `format: prettier`).
2. **"What's inside"** — add: `📧 **Native email** via Cloudflare Email Service — `send_email` binding + a `sendEmail()` helper, wired into Better Auth for verification/reset mail.`
3. **Tech Stack table** — add a row: **Email | Cloudflare Email Service (`send_email` binding) | Native outbound; no third-party provider**.
4. New **## Email** section covering:
   - What you get (helper + `/api/email/test` + Better Auth hooks).
   - Setup: onboard a **sending domain** (dash → Email Service → Email Sending → Onboard Domain; CF adds SPF/DKIM/DMARC under `cf-bounce`). Set `EMAIL_FROM`.
   - Recipients rule: verified destinations work immediately/free; arbitrary recipients need the onboarded sending domain; Sending needs the **Workers Paid plan**.
   - Local dev: `remote: true` lets `wrangler dev` send for real.
   - Optional hardening: `destination_address` / `allowed_destination_addresses` / `allowed_sender_addresses`.
   - Gotcha: outbound shows as **"dropped"** in the Email Routing summary — use Email sending metrics/logs.
   - Quick test: `curl -X POST <app>/api/email/test` (through Access).

## Data flow

Test route: client `POST /api/email/test` → `accessGuard` sets `email` → `sendEmail(c.env, …)` → `env.EMAIL.send({ from, to, subject, html, text })` → Cloudflare Email Service → `{ messageId }` returned to client.

Better Auth (when enabled later): signup/reset triggers Better Auth → `sendVerificationEmail` / `sendResetPassword` → `sendEmail(env, …)` → same binding path.

## Error handling

- `sendEmail` throws if neither `html` nor `text` is provided.
- `env.EMAIL.send()` rejection (unverified recipient pre-onboarding, quota, malformed address) propagates; the test route lets Hono surface a `500` with the message; Better Auth senders let the auth flow surface the failure to the caller.
- No ret/queue logic in scope — a single send attempt.

## Testing

- **Vitest (worker)** `worker/src/routes/email.test.ts` with a fake `EMAIL` binding (`{ send: async (m) => ({ messageId: "test-id" }) }` plus a spy):
  - `POST /api/email/test` calls `EMAIL.send` once with `from = EMAIL_FROM`, `to =` the request's authenticated email, and returns `{ ok: true, messageId }`.
  - `sendEmail` defaults `from` to `EMAIL_FROM`, derives a `text` part from `html` when `text` is omitted, and throws when both `html` and `text` are missing.
- **Typecheck**: `npm run typecheck` (client + worker tsconfigs) green after regenerating `worker-configuration.d.ts`.
- **Manual**: `curl -X POST <app>/api/email/test` (authenticated) → operator inbox receives the message; verify `messageId` in the response and the send in Email sending logs.

## Files

**Worker**
- Create: `worker/src/lib/email.ts`, `worker/src/routes/email.ts`, `worker/src/routes/email.test.ts`.
- Modify: `worker/src/types.ts` (add `EMAIL`, `EMAIL_FROM`), `worker/src/index.ts` (mount `emailRoute`), `worker/src/auth.ts` (widen `Env`, add senders), `worker-configuration.d.ts` (regenerate), `wrangler.jsonc` (add `send_email` binding + `EMAIL_FROM`).

**Docs**
- Modify: `README.md` (lint/format fix, 📧 bullet, Tech Stack row, **## Email** section).

**Dependency:** none (native binding; no `mimetext`, no provider SDK).

## Setup actions (in the plan)
1. Add `send_email` binding (`remote: true`) + `EMAIL_FROM` var to `wrangler.jsonc`.
2. `npx wrangler types` to regenerate `worker-configuration.d.ts`.
3. (Operator, documented in README) Onboard a sending domain in Email Service so non-verified recipients work; confirm DNS records propagate.
4. (Optional) Add binding restriction attributes for hardening.
