/* AGPL-3.0-or-later */
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  createVariant,
  deleteVariant,
  getImageVariants,
  updateVariant,
  type VariantDef,
  type VariantInput,
} from "@/lib/cf-api";

const FIT = ["scale-down", "contain", "cover", "crop", "pad"];
const META = ["keep", "copyright", "none"];
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

type FormState = {
  name: string;
  fit: string;
  width: number | undefined;
  height: number | undefined;
  metadata: string;
  neverRequireSignedURLs: boolean;
};
const EMPTY: FormState = {
  name: "",
  fit: "scale-down",
  width: undefined,
  height: undefined,
  metadata: "none",
  neverRequireSignedURLs: false,
};

export function VariantManager() {
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["imageVariants"], queryFn: getImageVariants });
  const [form, setForm] = useState<FormState>({ ...EMPTY });
  const [editing, setEditing] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["imageVariants"] });
  const reset = () => {
    setForm({ ...EMPTY });
    setEditing(null);
  };
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: (v: VariantInput) => createVariant(v),
    onSuccess: () => {
      invalidate();
      reset();
      notifications.show({ message: "Variant created", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't create variant", color: "red" }),
  });
  const update = useMutation({
    mutationFn: (args: { name: string; input: Omit<VariantInput, "name"> }) =>
      updateVariant(args.name, args.input),
    onSuccess: () => {
      invalidate();
      reset();
      notifications.show({ message: "Variant updated", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't update variant", color: "red" }),
  });
  const del = useMutation({
    mutationFn: (name: string) => deleteVariant(name),
    onSuccess: () => {
      invalidate();
      notifications.show({ message: "Variant deleted", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't delete variant", color: "red" }),
  });

  const variants = q.data?.variants ?? {};
  const inputFromForm = (): Omit<VariantInput, "name"> => ({
    fit: form.fit,
    width: form.width,
    height: form.height,
    metadata: form.metadata,
    neverRequireSignedURLs: form.neverRequireSignedURLs,
  });

  const submit = () => {
    if (editing) {
      const name = editing;
      modals.openConfirmModal({
        title: `Update variant "${name}"?`,
        children: (
          <Text size="sm">This is a global change affecting every image that uses this variant.</Text>
        ),
        labels: { confirm: "Update", cancel: "Cancel" },
        onConfirm: () => update.mutate({ name, input: inputFromForm() }),
      });
    } else {
      create.mutate({ name: form.name, ...inputFromForm() });
    }
  };

  const startEdit = (name: string, def: VariantDef) => {
    setEditing(name);
    setForm({
      name,
      fit: def.fit ?? "scale-down",
      width: def.width ?? undefined,
      height: def.height ?? undefined,
      metadata: def.metadata ?? "none",
      neverRequireSignedURLs: def.neverRequireSignedURLs,
    });
  };

  const confirmDelete = (name: string) =>
    modals.openConfirmModal({
      title: `Delete variant "${name}"?`,
      children: (
        <Text size="sm">Deleting a variant is global and affects every image. This cannot be undone.</Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => del.mutate(name),
    });

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Image variants</Title>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Fit</Table.Th>
              <Table.Th>Size</Table.Th>
              <Table.Th>Metadata</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.entries(variants).map(([name, def]) => (
              <Table.Tr key={name}>
                <Table.Td>
                  <Group gap="xs">
                    {name}
                    {def.neverRequireSignedURLs && (
                      <Badge size="xs" color="green" variant="light">
                        public
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>{def.fit ?? "—"}</Table.Td>
                <Table.Td>
                  {def.width || def.height ? `${def.width ?? "auto"}×${def.height ?? "auto"}` : "auto"}
                </Table.Td>
                <Table.Td>{def.metadata ?? "—"}</Table.Td>
                <Table.Td>
                  <Group gap="xs" justify="flex-end" wrap="nowrap">
                    <ActionIcon variant="subtle" aria-label={`Edit ${name}`} onClick={() => startEdit(name, def)}>
                      <IconPencil size={16} />
                    </ActionIcon>
                    {name !== "public" && (
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={`Delete ${name}`}
                        onClick={() => confirmDelete(name)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>

        <Text size="sm" fw={600}>
          {editing ? `Edit "${editing}"` : "Create variant"}
        </Text>
        <Group grow>
          <TextInput
            label="Name"
            value={form.name}
            disabled={!!editing}
            onChange={(e) => set({ name: e.currentTarget.value })}
          />
          <Select
            label="Fit"
            data={FIT}
            value={form.fit}
            onChange={(v) => set({ fit: v ?? "scale-down" })}
            allowDeselect={false}
          />
        </Group>
        <Group grow>
          <NumberInput
            label="Width"
            min={1}
            value={form.width}
            onChange={(v) => set({ width: typeof v === "number" ? v : undefined })}
          />
          <NumberInput
            label="Height"
            min={1}
            value={form.height}
            onChange={(v) => set({ height: typeof v === "number" ? v : undefined })}
          />
          <Select
            label="Metadata"
            data={META}
            value={form.metadata}
            onChange={(v) => set({ metadata: v ?? "none" })}
            allowDeselect={false}
          />
        </Group>
        <Switch
          label="Always public (ignore signed URLs)"
          checked={form.neverRequireSignedURLs}
          onChange={(e) => set({ neverRequireSignedURLs: e.currentTarget.checked })}
        />
        <Group>
          <Button
            size="xs"
            loading={create.isPending || update.isPending}
            disabled={!editing && !NAME_RE.test(form.name)}
            onClick={submit}
          >
            {editing ? "Save changes" : "Create variant"}
          </Button>
          {editing && (
            <Button size="xs" variant="subtle" onClick={reset}>
              Cancel
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  );
}
