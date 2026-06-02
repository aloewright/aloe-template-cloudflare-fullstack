/* AGPL-3.0-or-later */
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/nprogress/styles.css";
import "@gfazioli/mantine-audio/styles.css";
import "@/styles.css";

import { ColorSchemeScript, mantineHtmlProps, MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { NavigationProgress } from "@mantine/nprogress";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { useState } from "react";
import { AppSpotlight, RouteProgress } from "@/components/AppChrome";
import { AppHotkeys } from "@/lib/hotkeys";
import { theme } from "@/theme";
// Inline the brand/loader SVG as a data-URI favicon. A root public file like
// /logo.svg is not served by the TanStack Start + CF worker, and a hashed
// /assets URL isn't reliably emitted for head links, so embed it directly.
import loaderSvg from "@/assets/loader.svg?raw";

const faviconUrl = `data:image/svg+xml,${encodeURIComponent(
  loaderSvg.replace(/<\?xml[^>]*\?>/, ""),
)}`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Media Gallery" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: faviconUrl },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,300..900;1,300..900&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      }),
  );

  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript defaultColorScheme="auto" />
        <HeadContent />
      </head>
      <body>
        <MantineProvider theme={theme} defaultColorScheme="auto">
          <HotkeysProvider>
            <QueryClientProvider client={queryClient}>
              <ModalsProvider>
                <NavigationProgress />
                <RouteProgress />
                <AppSpotlight />
                <AppHotkeys />
                <Outlet />
                <Notifications />
              </ModalsProvider>
            </QueryClientProvider>
          </HotkeysProvider>
        </MantineProvider>
        <Scripts />
      </body>
    </html>
  );
}
