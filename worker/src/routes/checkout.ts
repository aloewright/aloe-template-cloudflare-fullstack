/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { Bindings } from "../index";
import { createPolar } from "../polar";

export const checkout = new Hono<{ Bindings: Bindings }>();

// POST /api/checkout — creates a Polar checkout session and returns its URL.
//
// The client redirects the browser to this URL. Polar handles the hosted
// payment page; on success it redirects back to /api/checkout/success.
checkout.post("/", async (c) => {
  const polar = createPolar(c.env);
  const origin = new URL(c.req.url).origin;

  // The SDK requires `products` (array of product IDs), not `productId`.
  // successUrl uses Polar's {CHECKOUT_ID} template literal — Polar substitutes
  // the real id when it redirects back.
  const result = await polar.checkouts.create({
    products: [c.env.POLAR_PRODUCT_ID],
    successUrl: `${origin}/api/checkout/success?checkout_id={CHECKOUT_ID}`,
  });

  return c.json({ url: result.url });
});
