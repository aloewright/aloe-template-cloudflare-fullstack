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

`worker/src/routes/checkout.ts` calls `polar.checkouts.create({ products, successUrl })`
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
