import "@mantine/core/styles.css";
import "@/styles.css";

import { MantineProvider } from "@mantine/core";
import { MDXProvider } from "@mdx-js/react";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { mdxComponents } from "@/mdx";
import { router } from "@/router";
import { theme } from "@/theme";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <MDXProvider components={mdxComponents}>
        <RouterProvider router={router} />
      </MDXProvider>
    </MantineProvider>
  </React.StrictMode>,
);
