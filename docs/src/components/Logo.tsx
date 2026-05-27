import { Group, Text } from "@mantine/core";

export function Logo() {
  return (
    <Group gap="xs" wrap="nowrap">
      <img src="/logo.svg" alt="" width={28} height={28} />
      <Text fw={650} size="sm">
        Cloudflare SaaS Template
      </Text>
    </Group>
  );
}
