/* AGPL-3.0-or-later */
import { Polar } from "@polar-sh/sdk";

// The Polar server selector. Sandbox is the default for local + demo use;
// flip POLAR_SERVER to "production" once you have a live product.
export type PolarServer = "sandbox" | "production";

export type PolarEnv = {
  POLAR_ACCESS_TOKEN: string;
  POLAR_WEBHOOK_SECRET: string;
  POLAR_PRODUCT_ID: string;
  POLAR_SERVER?: PolarServer;
};

// One client per request — Polar instances are cheap and stateless.
export function createPolar(env: PolarEnv): Polar {
  return new Polar({
    accessToken: env.POLAR_ACCESS_TOKEN,
    server: env.POLAR_SERVER ?? "sandbox",
  });
}
