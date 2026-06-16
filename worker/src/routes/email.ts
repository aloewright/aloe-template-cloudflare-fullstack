/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { sendEmail } from "../lib/email";
import type { AppEnv } from "../types";

export const emailRoute = new Hono<AppEnv>();

// Sends a test email to the authenticated operator (their own, already-verified
// address), so it works even before a sending domain is onboarded.
emailRoute.post("/test", async (c) => {
  const to = c.get("email");
  const { messageId } = await sendEmail(c.env, {
    to,
    subject: "Test email from your Cloudflare app",
    html: "<h1>It works</h1><p>Native Cloudflare Email Service is wired up.</p>",
  });
  return c.json({ ok: true, to, messageId });
});
