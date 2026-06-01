/* AGPL-3.0-or-later */

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";

import { MantineProvider } from "@mantine/core";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { router } from "@/router";
import { theme } from "@/theme";
import "@/styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <ModalsProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
        <Notifications />
      </ModalsProvider>
    </MantineProvider>
  </React.StrictMode>,
);
