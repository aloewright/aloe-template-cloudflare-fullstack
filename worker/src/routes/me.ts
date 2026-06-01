/* AGPL-3.0-or-later */
import { Hono } from "hono";
import type { AppEnv } from "../types";

export const me = new Hono<AppEnv>();

me.get("/", (c) => c.json({ email: c.get("email") }));
