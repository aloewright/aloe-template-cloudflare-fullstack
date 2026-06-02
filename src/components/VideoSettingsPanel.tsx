/* AGPL-3.0-or-later */
import { Button, Image, Slider, Stack, Text, Textarea } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { updateStream } from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";

export function VideoSettingsPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const [pct, setPct] = useState(Math.round((item.thumbnailTimestampPct ?? 0) * 100));
  const [origins, setOrigins] = useState(item.allowedOrigins.join("\n"));
  const [debouncedPct] = useDebouncedValue(pct, 300);
  const [previewFailed, setPreviewFailed] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      updateStream(item.id, {
        thumbnailTimestampPct: pct / 100,
        allowedOrigins: origins
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      notifications.show({ message: "Settings saved", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't save settings", color: "red" }),
  });

  if (item.kind !== "video") return null;

  const duration = item.duration ?? 0;
  const canPreview = !item.requireSignedURLs && !!item.thumbnailUrl && duration > 0;
  const sec = Math.round((debouncedPct / 100) * duration);
  const previewUrl =
    canPreview && !previewFailed ? `${item.thumbnailUrl}?time=${sec}s&height=240` : item.thumbnailUrl;

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Thumbnail &amp; playback
      </Text>
      {item.thumbnailUrl && (
        <Image
          src={previewUrl}
          alt="thumbnail preview"
          radius="md"
          h={160}
          fit="contain"
          onError={() => setPreviewFailed(true)}
        />
      )}
      <Text size="xs" c="dimmed">
        Thumbnail timestamp: {pct}%
        {item.requireSignedURLs ? " (preview updates after saving)" : ""}
      </Text>
      <Slider
        min={0}
        max={100}
        value={pct}
        onChange={(v) => {
          setPct(v);
          setPreviewFailed(false);
        }}
      />
      <Textarea
        label="Allowed origins"
        description="One domain per line. Empty = allow all origins."
        autosize
        minRows={2}
        value={origins}
        onChange={(e) => setOrigins(e.currentTarget.value)}
      />
      <Button
        size="xs"
        loading={save.isPending}
        onClick={() => save.mutate()}
        style={{ alignSelf: "flex-start" }}
      >
        Save settings
      </Button>
    </Stack>
  );
}
