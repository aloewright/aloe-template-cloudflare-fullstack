/* AGPL-3.0-or-later */
import { ActionIcon, Container, Group, Tabs, Text, Title } from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ColorSchemeToggle } from "@/components/ColorSchemeToggle";
import { ImagesPanel } from "@/components/ImagesPanel";
import { StreamPanel } from "@/components/StreamPanel";
import { getMe } from "@/lib/cf-api";

export function Gallery() {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });

  return (
    <Container size="xl" py="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Media Gallery</Title>
        <Group gap="xs" align="center">
          {me.data?.email && (
            <Text size="sm" c="dimmed">
              {me.data.email}
            </Text>
          )}
          <ColorSchemeToggle />
          <ActionIcon
            component={Link}
            to="/settings"
            variant="subtle"
            size="lg"
            aria-label="Settings"
            title="Settings"
          >
            <IconSettings size={20} />
          </ActionIcon>
        </Group>
      </Group>

      <Tabs defaultValue="images">
        <Tabs.List mb="md">
          <Tabs.Tab value="images">Images</Tabs.Tab>
          <Tabs.Tab value="stream">Stream</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="images">
          <ImagesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="stream">
          <StreamPanel />
        </Tabs.Panel>
      </Tabs>
    </Container>
  );
}
