/* AGPL-3.0-or-later */
import { Button, Group, Progress, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconDownload, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type DownloadInfo,
  type DownloadsStatus,
  deleteDownload,
  enableDownload,
  getDownloads,
} from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";

const hasInProgress = (d: DownloadsStatus | undefined) =>
  d?.default?.status === "inprogress" || d?.audio?.status === "inprogress";

function TypeRow({
  uid,
  label,
  type,
  info,
  onChange,
}: {
  uid: string;
  label: string;
  type: "default" | "audio";
  info: DownloadInfo | null;
  onChange: () => void;
}) {
  const enable = useMutation({
    mutationFn: () => enableDownload(uid, type),
    onSuccess: onChange,
    onError: () => notifications.show({ message: "Couldn't enable download", color: "red" }),
  });
  const remove = useMutation({
    mutationFn: () => deleteDownload(uid, type),
    onSuccess: onChange,
    onError: () => notifications.show({ message: "Couldn't remove download", color: "red" }),
  });

  if (!info) {
    return (
      <Button size="xs" variant="light" loading={enable.isPending} onClick={() => enable.mutate()}>
        Enable {label}
      </Button>
    );
  }
  if (info.status === "ready" && info.url) {
    return (
      <Group gap="xs">
        <Button
          size="xs"
          variant="light"
          component="a"
          href={info.url}
          target="_blank"
          rel="noopener"
          download
          leftSection={<IconDownload size={14} />}
        >
          Download {label}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          color="red"
          loading={remove.isPending}
          onClick={() => remove.mutate()}
          leftSection={<IconTrash size={14} />}
        >
          Remove
        </Button>
      </Group>
    );
  }
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}: preparing {Math.round(info.percentComplete)}%
      </Text>
      <Progress value={info.percentComplete} />
    </div>
  );
}

export function VideoDownloadPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const ready = item.kind === "video" && Boolean(item.readyToStream);
  const q = useQuery({
    queryKey: ["downloads", item.id],
    queryFn: () => getDownloads(item.id),
    enabled: ready,
    refetchInterval: (query) =>
      query.state.status !== "error" && hasInProgress(query.state.data) ? 4000 : false,
  });
  if (!ready) return null;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["downloads", item.id] });
  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Downloads
      </Text>
      <TypeRow
        uid={item.id}
        label="MP4"
        type="default"
        info={q.data?.default ?? null}
        onChange={invalidate}
      />
      <TypeRow
        uid={item.id}
        label="Audio (M4A)"
        type="audio"
        info={q.data?.audio ?? null}
        onChange={invalidate}
      />
    </Stack>
  );
}
