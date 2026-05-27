/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { PolarEnv } from "./polar";
import { checkout } from "./routes/checkout";
import { demo } from "./routes/demo";
import { health } from "./routes/health";
import { session } from "./routes/session";

export type Bindings = {
  DB: D1Database;
} & PolarEnv;

const app = new Hono<{ Bindings: Bindings }>();

app.route("/api/health", health);
app.route("/api/session", session);
app.route("/api/demo", demo);
app.route("/api/checkout", checkout);

export default app;
