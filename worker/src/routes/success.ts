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
