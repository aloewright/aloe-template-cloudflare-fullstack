/* AGPL-3.0-or-later */
import { redirect } from "@tanstack/react-router";
import { getSettings } from "@/lib/cf-api";

// Route loader for the gallery. Redirects to /settings until the owner has
// connected their Cloudflare account.
export async function ensureConnected() {
  const status = await getSettings();
  if (!status.connected) {
    throw redirect({ to: "/settings" });
  }
}
