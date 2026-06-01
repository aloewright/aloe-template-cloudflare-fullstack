/* AGPL-3.0-or-later */
import { Hono } from "hono";
import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import type { AppEnv } from "../types";
import { accessGuard, verifyAccessToken } from "./access";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "aud-tag";

function appWithGuard() {
  const app = new Hono<AppEnv>();
  app.use("/api/*", accessGuard);
  app.get("/api/whoami", (c) => c.json({ email: c.get("email") }));
  return app;
}

describe("verifyAccessToken", () => {
  it("accepts a valid token and extracts the email", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwt = await new SignJWT({ email: "me@example.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(TEAM)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);

    const result = await verifyAccessToken(jwt, {
      teamDomain: TEAM,
      aud: AUD,
      getKey: async () => publicKey,
    });
    expect(result.email).toBe("me@example.com");
  });

  it("rejects a token with the wrong audience", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const jwt = await new SignJWT({ email: "me@example.com" })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(TEAM)
      .setAudience("other-aud")
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey);

    await expect(
      verifyAccessToken(jwt, { teamDomain: TEAM, aud: AUD, getKey: async () => publicKey }),
    ).rejects.toBeTruthy();
  });
});

describe("accessGuard", () => {
  it("bypasses Access in local dev", async () => {
    const res = await appWithGuard().request("/api/whoami", {}, {
      DEV_BYPASS_ACCESS: "1",
    } as AppEnv["Bindings"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "dev@localhost" });
  });

  it("returns 403 when the Access token is missing", async () => {
    const res = await appWithGuard().request("/api/whoami", {}, {
      TEAM_DOMAIN: TEAM,
      POLICY_AUD: AUD,
    } as AppEnv["Bindings"]);
    expect(res.status).toBe(403);
  });
});
