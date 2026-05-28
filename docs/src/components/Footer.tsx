import { Anchor, Group, Text } from "@mantine/core";
import { IconBrandGithub, IconExternalLink } from "@tabler/icons-react";

export function Footer() {
  return (
    <Group h="100%" px="md" justify="space-between">
      <Text size="xs" c="dimmed">
        AGPL-3.0-or-later
      </Text>
      <Group gap="lg">
        <Anchor
          size="xs"
          href="https://template.lazee.workers.dev"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Group gap={4}>
            Live demo <IconExternalLink size={12} />
          </Group>
        </Anchor>
        <Anchor
          size="xs"
          href="https://github.com/aloewright/my-cf-template"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Group gap={4}>
            <IconBrandGithub size={12} /> GitHub
          </Group>
        </Anchor>
      </Group>
    </Group>
  );
}
