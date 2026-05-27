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
