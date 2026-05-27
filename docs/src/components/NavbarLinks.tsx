import { Anchor, Group } from "@mantine/core";
import { IconBrandGithub, IconExternalLink } from "@tabler/icons-react";

export function NavbarLinks() {
  return (
    <Group gap="lg" visibleFrom="sm">
      <Anchor
        size="sm"
        href="https://template.lazee.workers.dev"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Group gap={4}>
          Live demo <IconExternalLink size={14} />
        </Group>
      </Anchor>
      <Anchor
        size="sm"
        href="https://github.com/aloewright/my-cf-template"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Group gap={4}>
          <IconBrandGithub size={14} /> GitHub
        </Group>
      </Anchor>
    </Group>
  );
}
