/* AGPL-3.0-or-later */
import type { MiddlewareHandler } from "hono";
import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { AppEnv } from "../types";

const jwksCache = new Map<string, JWTVerifyGetKey>();

function remoteJwks(teamDomain: string): JWTVerifyGetKey {
  let getKey = jwksCache.get(teamDomain);
  if (!getKey) {
    getKey = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, getKey);
  }
  return getKey;
}

export async function verifyAccessToken(
  token: string,
  opts: { teamDomain: string; aud: string; getKey?: JWTVerifyGetKey },
): Promise<{ email: string }> {
  const getKey = opts.getKey ?? remoteJwks(opts.teamDomain);
  const { payload } = await jwtVerify(token, getKey, {
    issuer: opts.teamDomain,
    audience: opts.aud,
  });
  return { email: typeof payload.email === "string" ? payload.email : "unknown" };
}

export const accessGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.path === "/api/health") return next();
  if (c.env.DEV_BYPASS_ACCESS === "1") {
    c.set("email", "dev@localhost");
    return next();
  }
  const token = c.req.header("cf-access-jwt-assertion");
  if (!token) return c.json({ error: "Missing Cloudflare Access token" }, 403);
  try {
    const { email } = await verifyAccessToken(token, {
      teamDomain: c.env.TEAM_DOMAIN,
      aud: c.env.POLICY_AUD,
    });
    c.set("email", email);
    return next();
  } catch {
    return c.json({ error: "Invalid Cloudflare Access token" }, 403);
  }
};
