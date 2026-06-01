/* AGPL-3.0-or-later */
import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { ensureConnected } from "@/lib/setup-guard";
import { Gallery } from "@/routes/gallery";
import { Settings } from "@/routes/settings";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const galleryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  loader: ensureConnected,
  component: Gallery,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: Settings,
});

const routeTree = rootRoute.addChildren([galleryRoute, settingsRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
