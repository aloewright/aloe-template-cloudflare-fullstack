/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { createDatabase } from "./db";
import { makeAudioStore } from "./lib/audio-store";
import { d1ConnectionStore } from "./lib/connection-store";
import { accessGuard } from "./middleware/access";
import { checkout } from "./routes/checkout";
import { demo } from "./routes/demo";
import { health } from "./routes/health";
import { imagesRoute } from "./routes/images";
import { me } from "./routes/me";
import { session } from "./routes/session";
import { settingsRoute } from "./routes/settings";
import { audioRoute } from "./routes/audio";
import { streamRoute } from "./routes/stream";
import { success } from "./routes/success";
import { webhook } from "./routes/webhook";
import { createConnectionService } from "./services/connection";
import type { AppEnv, Bindings } from "./types";

export type { Bindings } from "./types";

const makeService = (env: Bindings) =>
  createConnectionService(d1ConnectionStore(createDatabase(env)), env.TOKEN_ENC_KEY);

const app = new Hono<AppEnv>();

// Cloudflare Access gates the whole API (except health). In local dev,
// DEV_BYPASS_ACCESS=1 short-circuits this. See worker/src/middleware/access.ts.
app.use("/api/*", accessGuard);

app.route("/api/health", health);
app.route("/api/me", me);
app.route("/api/settings", settingsRoute(makeService));
app.route("/api/images", imagesRoute(makeService));
app.route("/api/stream", streamRoute(makeService));
app.route(
  "/api/audio",
  audioRoute((env) => makeAudioStore(env.DB)),
);

// Template leftovers — now Access-gated and unused by the gallery app.
app.route("/api/session", session);
app.route("/api/demo", demo);
app.route("/api/checkout", checkout);
app.route("/api/checkout/success", success);
app.route("/api/webhook/polar", webhook);

export default app;
