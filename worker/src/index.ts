/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { Bindings } from "./types";
import { checkout } from "./routes/checkout";
import { demo } from "./routes/demo";
import { health } from "./routes/health";
import { session } from "./routes/session";
import { success } from "./routes/success";
import { webhook } from "./routes/webhook";

export type { Bindings } from "./types";

const app = new Hono<{ Bindings: Bindings }>();

app.route("/api/health", health);
app.route("/api/session", session);
app.route("/api/demo", demo);
app.route("/api/checkout", checkout);
app.route("/api/checkout/success", success);
app.route("/api/webhook/polar", webhook);

export default app;
