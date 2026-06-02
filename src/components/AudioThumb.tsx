/* AGPL-3.0-or-later */
import { Center } from "@mantine/core";
import { IconMusic } from "@tabler/icons-react";

// Music-note placeholder for audio items wherever a thumbnail would render.
export function AudioThumb({ size = 48 }: { size?: number }) {
  return (
    <Center
      style={{
        aspectRatio: "1 / 1",
        width: "100%",
        background: "var(--mantine-color-default-hover)",
      }}
    >
      <IconMusic size={size} opacity={0.5} />
    </Center>
  );
}
