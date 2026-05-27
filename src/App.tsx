/* AGPL-3.0-or-later */
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/lib/api";

type HealthResponse = {
  ok: boolean;
  service: string;
  timestamp: string;
};

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
};

export function App() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchJson<HealthResponse>("/api/health"),
  });

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => fetchJson<SessionUser | null>("/api/me"),
  });

  const isHealthy = healthQuery.data?.ok === true;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef2ff_100%)] text-slate-950">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-16">
        <section className="w-full rounded-2xl border border-slate-200 bg-white/90 p-8 shadow-[0_24px_80px_-32px_rgba(15,23,42,0.35)] backdrop-blur">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl space-y-5">
              <p className="text-sm font-medium uppercase tracking-[0.24em] text-slate-500">
                Warp template
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
                Hello, world.
              </h1>
              <p className="text-base leading-7 text-slate-600">
                A full-stack starter with a Vite front end, a Cloudflare Worker, Better Auth,
                TanStack Router, TanStack Query, Tailwind, shadcn-style controls, and D1-backed data
                access.
              </p>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => void healthQuery.refetch()}>Refresh health</Button>
                <Button variant="secondary" onClick={() => void meQuery.refetch()}>
                  Refresh session
                </Button>
              </div>
            </div>

            <aside className="grid w-full gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 lg:max-w-sm">
              <StatusRow label="Worker health" value={isHealthy ? "ok" : "loading"} />
              <StatusRow
                label="Signed-out user"
                value={meQuery.data ? meQuery.data.email : "null"}
              />
              <StatusRow
                label="API route"
                value={healthQuery.data ? healthQuery.data.service : "/api/health"}
              />
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">{label}</span>
      <span className="break-all text-sm font-medium text-slate-900">{value}</span>
    </div>
  );
}
