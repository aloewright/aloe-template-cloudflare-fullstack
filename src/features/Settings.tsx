/* AGPL-3.0-or-later */
import {
  Alert,
  Anchor,
  Button,
  Container,
  Group,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ColorSchemeToggle } from "@/components/ColorSchemeToggle";
import { VariantManager } from "@/components/VariantManager";
import { getSettings, saveSettings } from "@/lib/cf-api";

export function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const form = useForm({
    initialValues: { accountId: "", token: "" },
    validate: {
      accountId: (v) => (v.trim().length > 0 ? null : "Account ID is required"),
      token: (v) => (v.trim().length > 0 ? null : "API token is required"),
    },
  });

  const save = useMutation({
    mutationFn: saveSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["settings"] });
      notifications.show({ message: "Connected to Cloudflare", color: "green" });
      navigate({ to: "/" });
    },
    onError: () =>
      notifications.show({
        message: "Could not validate the token. Check the scopes and account ID.",
        color: "red",
      }),
  });

  return (
    <Container size="sm" py="xl">
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Title order={2}>Connect Cloudflare</Title>
            <Text c="dimmed" size="sm">
              Paste a scoped API token (Images Read+Edit, Stream Read+Edit) and your account ID. The
              token is stored encrypted and used only server-side.
            </Text>
          </div>
          <ColorSchemeToggle />
        </Group>

        {status.data?.connected && (
          <Alert color="green" title="Connected">
            Account <b>{status.data.accountId}</b>
            {status.data.accountHash ? ` · images hash ${status.data.accountHash}` : ""}
          </Alert>
        )}

        <form onSubmit={form.onSubmit((values) => save.mutate(values))}>
          <Stack>
            <TextInput
              label="Account ID"
              placeholder="e.g. 0a1b2c3d..."
              {...form.getInputProps("accountId")}
            />
            <PasswordInput
              label="API token"
              placeholder="scoped Cloudflare API token"
              {...form.getInputProps("token")}
            />
            <Button type="submit" loading={save.isPending}>
              Save &amp; connect
            </Button>
            <Anchor href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" size="sm">
              Create an API token →
            </Anchor>
          </Stack>
        </form>
        {status.data?.connected && <VariantManager />}
      </Stack>
    </Container>
  );
}
