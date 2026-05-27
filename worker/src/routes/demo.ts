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
