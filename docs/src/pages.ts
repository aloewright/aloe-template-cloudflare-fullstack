export type DocPage = { path: string; title: string; slug: string };

export const pages: DocPage[] = [
  { path: "/", title: "Introduction", slug: "intro" },
  { path: "/architecture", title: "Architecture", slug: "architecture" },
  { path: "/billing-polar", title: "Billing (Polar)", slug: "billing-polar" },
  { path: "/protected-routes", title: "Protected routes", slug: "protected-routes" },
  { path: "/database-d1", title: "Database (D1 + Drizzle)", slug: "database-d1" },
  { path: "/deploy", title: "Deploy", slug: "deploy" },
  { path: "/customizing", title: "Customizing", slug: "customizing" },
];
