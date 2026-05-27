import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Layout } from "@/components/Layout";
import { DocPage } from "@/components/DocPage";
import Architecture from "@/content/architecture.mdx";
import BillingPolar from "@/content/billing-polar.mdx";
import Customizing from "@/content/customizing.mdx";
import DatabaseD1 from "@/content/database-d1.mdx";
import Deploy from "@/content/deploy.mdx";
import Intro from "@/content/intro.mdx";
import ProtectedRoutes from "@/content/protected-routes.mdx";

const rootRoute = createRootRoute({ component: Layout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => (
    <DocPage>
      <Intro />
    </DocPage>
  ),
});

const architectureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/architecture",
  component: () => (
    <DocPage>
      <Architecture />
    </DocPage>
  ),
});

const billingPolarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/billing-polar",
  component: () => (
    <DocPage>
      <BillingPolar />
    </DocPage>
  ),
});

const protectedRoutesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/protected-routes",
  component: () => (
    <DocPage>
      <ProtectedRoutes />
    </DocPage>
  ),
});

const databaseD1Route = createRoute({
  getParentRoute: () => rootRoute,
  path: "/database-d1",
  component: () => (
    <DocPage>
      <DatabaseD1 />
    </DocPage>
  ),
});

const deployRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/deploy",
  component: () => (
    <DocPage>
      <Deploy />
    </DocPage>
  ),
});

const customizingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/customizing",
  component: () => (
    <DocPage>
      <Customizing />
    </DocPage>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  architectureRoute,
  billingPolarRoute,
  protectedRoutesRoute,
  databaseD1Route,
  deployRoute,
  customizingRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
