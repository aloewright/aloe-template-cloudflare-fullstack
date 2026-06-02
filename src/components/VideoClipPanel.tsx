/* AGPL-3.0-or-later */
import { Button, Group, NumberInput, RangeSlider, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createClip } from "@/lib/cf-api";
import { clipSecondsLabel, isValidClipRange } from "@/lib/clip";
import type { MediaItem } from "@/lib/media";

export function VideoClipPanel({ item }: { item: MediaItem }) {
  const duration = Math.floor(item.duration ?? 0);
  const queryClient = useQueryClient();
  const [range, setRange] = useState<[number, number]>([0, duration]);
  const [name, setName] = useState(`${item.name} (clip)`);
  const [start, end] = range;

  const clip = useMutation({
    mutationFn: () =>
      createClip(item.id, {
        startTimeSeconds: start,
        endTimeSeconds: end,
        name: name.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["media"] });
      notifications.show({ message: "Clip is processing — it'll appear shortly", color: "green" });
    },
    onError: () => notifications.show({ message: "Couldn't create clip", color: "red" }),
  });

  // Hooks above run unconditionally; gate the render below.
  if (!(item.kind === "video" && item.readyToStream && duration > 0)) return null;

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Trim / Create clip
      </Text>
      <RangeSlider
        min={0}
        max={duration}
        step={1}
        minRange={1}
        value={range}
        onChange={setRange}
        label={clipSecondsLabel}
      />
      <Group grow>
        <NumberInput
          label="Start (s)"
          min={0}
          max={Math.max(0, end - 1)}
          value={start}
          onChange={(v) => setRange([typeof v === "number" ? v : 0, end])}
        />
        <NumberInput
          label="End (s)"
          min={start + 1}
          max={duration}
          value={end}
          onChange={(v) => setRange([start, typeof v === "number" ? v : start + 1])}
        />
      </Group>
      <Text size="xs" c="dimmed">
        Clip length: {clipSecondsLabel(Math.max(0, end - start))}
      </Text>
      <TextInput label="Clip name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
      <Button
        size="xs"
        disabled={!isValidClipRange(start, end, duration)}
        loading={clip.isPending}
        onClick={() => clip.mutate()}
        style={{ alignSelf: "flex-start" }}
      >
        Create clip
      </Button>
    </Stack>
  );
}
