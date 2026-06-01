/* AGPL-3.0-or-later */
import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import app from "../../../worker/src/index";

// Delegate every /api/* request to the existing Hono app, passing the
// Cloudflare bindings (D1, vars, secret) as the Hono env.
const handler = ({ request }: { request: Request }) =>
  app.fetch(request, env as unknown as Parameters<typeof app.fetch>[1]);

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handler,
      POST: handler,
      PUT: handler,
      PATCH: handler,
      DELETE: handler,
      OPTIONS: handler,
    },
  },
});
