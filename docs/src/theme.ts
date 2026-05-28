import { createTheme } from "@mantine/core";

const nunitoStack =
  "Nunito, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export const theme = createTheme({
  primaryColor: "indigo",
  // Rounded edges everywhere — cards, buttons, inputs, badges, etc. all
  // pick up defaultRadius when no explicit `radius` prop is set.
  defaultRadius: "lg",
  fontFamily: nunitoStack,
  headings: {
    fontFamily: nunitoStack,
    fontWeight: "700",
  },
});
