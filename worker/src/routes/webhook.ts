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

  let event: ReturnType<typeof validateEvent>;
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

    // Subscription model has a `prices` array; no top-level `priceId` field.
    const priceId = sub.prices[0]?.id ?? null;

    await db
      .insert(subscriptions)
      .values({
        id: sub.id,
        customerId: sub.customerId,
        customerEmail: sub.customer?.email ?? "",
        productId: sub.productId,
        priceId,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: {
          status: sub.status,
          priceId,
          currentPeriodEnd: sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null,
          updatedAt: new Date(),
        },
      });
  }

  // Always 200 after verification — Polar retries non-2xx.
  return c.json({ ok: true });
});
