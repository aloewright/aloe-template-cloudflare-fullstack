/* AGPL-3.0-or-later */
import {
  Anchor,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  List,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useNavigate } from "@tanstack/react-router";
import { startCheckout, unlockDemo } from "@/lib/api";

export function Landing() {
  const navigate = useNavigate();

  async function onSubscribe() {
    const url = await startCheckout();
    window.location.href = url;
  }

  async function onEnterDemo() {
    await unlockDemo();
    navigate({ to: "/dashboard" });
  }

  return (
    <main>
      {/* Hero */}
      <Container size="lg" py={{ base: 60, md: 100 }}>
        <Stack gap="md" align="center" ta="center">
          <Group gap="sm" align="center">
            <img src="/logo.svg" alt="" width={40} height={40} />
            <Text fw={650} size="lg">
              Cloudflare SaaS Template
            </Text>
          </Group>
          <Title order={1} size={56} lh={1.1}>
            Ship a SaaS on the edge in an afternoon.
          </Title>
          <Text size="xl" c="dimmed" maw={640}>
            A working reference: React + Mantine on the front, Hono on a Cloudflare Worker,
            D1 for data, Polar for billing. Read the code, not a tutorial.
          </Text>
          <Group mt="md">
            <Button size="lg" onClick={onSubscribe}>
              Subscribe with Polar
            </Button>
            <Button size="lg" variant="light" onClick={onEnterDemo}>
              Enter demo
            </Button>
          </Group>
          <Text size="xs" c="dimmed">
            "Enter demo" sets a cookie and drops you into the protected route. No payment.
          </Text>
        </Stack>
      </Container>

      <Divider />

      {/* Features */}
      <Container size="lg" py={{ base: 60, md: 80 }}>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
          <FeatureCard
            title="Auth-ready"
            body="Better Auth is scaffolded; drop your provider keys to flip on email + OAuth."
          />
          <FeatureCard
            title="Edge-native"
            body="Single Worker serves the SPA and the API from every Cloudflare POP."
          />
          <FeatureCard
            title="One-click deploy"
            body="Click the badge in the README. Cloudflare provisions the Worker + D1 for you."
          />
        </SimpleGrid>
      </Container>

      <Divider />

      {/* Pricing */}
      <Container size="sm" py={{ base: 60, md: 80 }}>
        <Stack gap="lg" align="center">
          <Title order={2} ta="center">
            One tier, to demonstrate Polar
          </Title>
          <Card withBorder radius="md" padding="xl" w="100%">
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={600} size="lg">
                  Pro
                </Text>
                <Text fw={700} size="xl">
                  $19<Text component="span" c="dimmed" size="md"> /mo</Text>
                </Text>
              </Group>
              <List spacing="xs" size="sm">
                <List.Item>Access to /dashboard</List.Item>
                <List.Item>Polar customer portal</List.Item>
                <List.Item>Edge-served, sub-100ms cold start</List.Item>
              </List>
              <Button size="md" fullWidth onClick={onSubscribe}>
                Subscribe with Polar
              </Button>
            </Stack>
          </Card>
        </Stack>
      </Container>

      <Divider />

      {/* Footer */}
      <Container size="lg" py="xl">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            AGPL-3.0-or-later
          </Text>
          <Group gap="lg">
            <Anchor size="sm" href="https://github.com/aloewright/my-cf-template">
              GitHub
            </Anchor>
            <Anchor size="sm" href="https://template-docs.lazee.workers.dev">
              Docs
            </Anchor>
          </Group>
        </Group>
      </Container>
    </main>
  );
}

function FeatureCard({ title, body }: { title: string; body: string }) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Stack gap="sm">
        <ThemeIcon variant="light" size="lg" radius="md">
          <Box w={8} h={8} bg="currentColor" style={{ borderRadius: 2 }} />
        </ThemeIcon>
        <Text fw={600}>{title}</Text>
        <Text size="sm" c="dimmed">
          {body}
        </Text>
      </Stack>
    </Card>
  );
}
