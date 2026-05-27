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
