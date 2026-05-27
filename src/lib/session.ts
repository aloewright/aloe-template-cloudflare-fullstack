/* AGPL-3.0-or-later */
import { redirect } from "@tanstack/react-router";
import { fetchJson } from "@/lib/api";

type SessionResponse = { unlocked: boolean };

// Route loaders for protected routes call this. If the user isn't unlocked
// we throw a redirect (TanStack Router catches it and navigates). When you
// wire real auth, swap the /api/session call for your auth library's session
// check and keep the throw-redirect pattern.
export async function requireUnlocked() {
  const { unlocked } = await fetchJson<SessionResponse>("/api/session");
  if (!unlocked) {
    throw redirect({ to: "/" });
  }
}
