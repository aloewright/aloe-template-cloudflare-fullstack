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
