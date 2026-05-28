/* AGPL-3.0-or-later */
import { createTheme } from "@mantine/core";

const nunitoStack =
  "Nunito, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "lg",
  fontFamily: nunitoStack,
  headings: {
    fontFamily: nunitoStack,
    fontWeight: "700",
  },
});
