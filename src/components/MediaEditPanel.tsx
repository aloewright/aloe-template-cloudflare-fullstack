/* AGPL-3.0-or-later */
import { ActionIcon, Button, Group, Stack, Switch, Text, TextInput } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { deleteMediaItem, type MediaItem, updateMediaItem } from "@/lib/media";
import { useUIStore } from "@/lib/store";

type Row = { id: string; key: string; value: string };

export function MediaEditPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const setSelected = useUIStore((s) => s.setSelected);

  // Cloudflare metadata is arbitrary JSON: it may be absent and values may be
  // non-strings, so normalize defensively before driving the controlled inputs.
  const initialMeta = item.meta ?? {};
  const [name, setName] = useState(initialMeta.name ?? item.name);
  const [rows, setRows] = useState<Row[]>(
    Object.entries(initialMeta)
      .filter(([k]) => k !== "name")
      .map(([key, value], i) => ({ id: `r${i}`, key, value: value == null ? "" : String(value) })),
  );
  const [requireSignedURLs, setRequireSignedURLs] = useState(item.requireSignedURLs);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["media"] });
    if (item.kind === "image") queryClient.invalidateQueries({ queryKey: ["image", item.id] });
  };

  const save = useMutation({
    mutationFn: () => {
      const meta: Record<string, string> = {};
      for (const r of rows) if (r.key.trim()) meta[r.key.trim()] = r.value;
      return updateMediaItem(item, { name, meta, requireSignedURLs });
    },
    onSuccess: () => {
      invalidate();
      notifications.show({ message: "Saved", color: "green" });
    },
    onError: () => notifications.show({ message: "Save failed", color: "red" }),
  });

  const del = useMutation({
    mutationFn: () => deleteMediaItem(item),
    onSuccess: () => {
      invalidate();
      setSelected(null);
      notifications.show({ message: "Deleted", color: "green" });
    },
    onError: () => notifications.show({ message: "Delete failed", color: "red" }),
  });

  const confirmDelete = () =>
    modals.openConfirmModal({
      title: "Delete this item?",
      children: (
        <Text size="sm">
          This permanently deletes "{item.name}" from Cloudflare. This cannot be undone.
        </Text>
      ),
      labels: { confirm: "Delete", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: () => del.mutate(),
    });

  return (
    <Stack gap="sm">
      <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />

      {item.kind !== "audio" && (
        <div>
          <Text size="sm" fw={600} mb={4}>
            Metadata
          </Text>
          <Stack gap="xs">
            {rows.map((r, i) => (
              <Group key={r.id} gap="xs" wrap="nowrap">
                <TextInput
                  placeholder="key"
                  value={r.key}
                  onChange={(e) => {
                    // Capture before the updater: React nulls e.currentTarget once
                    // the handler returns, and the functional updater runs later.
                    const key = e.currentTarget.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, key } : x)));
                  }}
                  w={140}
                />
                <TextInput
                  placeholder="value"
                  value={r.value}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setRows((rs) => rs.map((x, j) => (j === i ? { ...x, value } : x)));
                  }}
                  style={{ flex: 1 }}
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Remove"
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Group>
            ))}
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={() =>
                setRows((rs) => [...rs, { id: crypto.randomUUID(), key: "", value: "" }])
              }
              style={{ alignSelf: "flex-start" }}
            >
              Add field
            </Button>
          </Stack>
        </div>
      )}

      {item.kind !== "audio" && (
        <Switch
          label="Require signed URLs"
          checked={requireSignedURLs}
          onChange={(e) => setRequireSignedURLs(e.currentTarget.checked)}
        />
      )}

      <Group justify="space-between" mt="xs">
        <Button color="red" variant="light" onClick={confirmDelete} loading={del.isPending}>
          Delete
        </Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>
          Save changes
        </Button>
      </Group>
    </Stack>
  );
}
