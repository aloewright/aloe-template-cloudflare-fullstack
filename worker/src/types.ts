/* AGPL-3.0-or-later */
import type { PolarEnv } from "./polar";

export type Bindings = {
  DB: D1Database;
  // Dedicated R2 bucket for audio files (see docs/superpowers/specs/2026-06-01-audio-design.md).
  AUDIO_BUCKET: R2Bucket;
  // Cloudflare Access — see docs/superpowers/specs for setup.
  TEAM_DOMAIN: string; // https://<team>.cloudflareaccess.com
  POLICY_AUD: string; // Access application AUD tag
  // AES-GCM key material for encrypting the stored Cloudflare API token at rest.
  TOKEN_ENC_KEY: string;
  // Set to "1" only in local .dev.vars to bypass Access during `wrangler dev`.
  DEV_BYPASS_ACCESS?: string;
} & PolarEnv;

export type Variables = {
  email: string;
};

export type AppEnv = { Bindings: Bindings; Variables: Variables };
