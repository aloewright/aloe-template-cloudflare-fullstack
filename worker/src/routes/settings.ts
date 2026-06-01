/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { ConnectionService } from "../services/connection";
import type { AppEnv } from "../types";

type MakeService = (env: AppEnv["Bindings"]) => ConnectionService;

export function settingsRoute(makeService: MakeService) {
  const app = new Hono<AppEnv>();

  app.get("/", async (c) => c.json(await makeService(c.env).getStatus()));

  app.put("/", async (c) => {
    const body = await c.req
      .json<{ accountId?: string; token?: string }>()
      .catch(() => ({}) as never);
    if (!body.accountId || !body.token) {
      return c.json({ error: "accountId and token are required" }, 400);
    }
    try {
      const status = await makeService(c.env).connect({
        accountId: body.accountId,
        token: body.token,
      });
      return c.json(status);
    } catch {
      return c.json(
        {
          error:
            "Could not validate the token against Cloudflare. Check the token scopes and account ID.",
        },
        400,
      );
    }
  });

  app.post("/test", async (c) => {
    try {
      return c.json(await makeService(c.env).test());
    } catch {
      return c.json({ error: "Stored token failed validation" }, 400);
    }
  });

  return app;
}
