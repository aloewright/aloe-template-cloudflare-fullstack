/* AGPL-3.0-or-later */
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { Dashboard } from "@/routes/dashboard";
import { Landing } from "@/routes/landing";
import { requireUnlocked } from "@/lib/session";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  // The loader runs before render. If !unlocked, requireUnlocked throws
  // redirect({ to: "/" }) and TanStack Router handles the navigation.
  loader: requireUnlocked,
  component: Dashboard,
});

const routeTree = rootRoute.addChildren([indexRoute, dashboardRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
