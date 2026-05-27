import { Box, Container } from "@mantine/core";
import type { PropsWithChildren } from "react";

export function DocPage({ children }: PropsWithChildren) {
  return (
    <Container size="md" py="xl">
      <Box className="mdx-content">{children}</Box>
    </Container>
  );
}
