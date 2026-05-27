/* AGPL-3.0-or-later */
import { Badge, Card, Container, Group, Stack, Text, Title } from "@mantine/core";

export function Dashboard() {
  return (
    <Container size="lg" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-end">
          <div>
            <Title order={1}>Dashboard</Title>
            <Text c="dimmed">You're inside the protected route.</Text>
          </div>
          <Badge color="green" variant="light">
            unlocked
          </Badge>
        </Group>

        <Card withBorder padding="lg" radius="md">
          <Text fw={500} mb="xs">
            What you'd put here
          </Text>
          <Text size="sm" c="dimmed">
            This is the screen a paying user sees. In the template it's gated by a stub
            cookie set by either Polar checkout success or the "Enter demo" button on the
            landing page. Replace the cookie check in <code>worker/src/routes/session.ts</code>
            with a real auth + subscription lookup to ship for real.
          </Text>
        </Card>
      </Stack>
    </Container>
  );
}
