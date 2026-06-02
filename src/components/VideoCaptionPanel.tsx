/* AGPL-3.0-or-later */
import { ActionIcon, Badge, Button, FileInput, Group, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type Caption,
  deleteCaption,
  generateCaption,
  listCaptions,
  uploadCaption,
} from "@/lib/cf-api";
import { CAPTION_LANGUAGES, GENERATE_LANGUAGES } from "@/lib/captions";
import type { MediaItem } from "@/lib/media";

export function VideoCaptionPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();
  const ready = item.kind === "video" && Boolean(item.readyToStream);
  const [genLang, setGenLang] = useState<string | null>("en");
  const [upLang, setUpLang] = useState<string | null>("en");
  const [file, setFile] = useState<File | null>(null);

  const q = useQuery({
    queryKey: ["captions", item.id],
    queryFn: () => listCaptions(item.id),
    enabled: ready,
    refetchInterval: (query) =>
      query.state.status !== "error" &&
      (query.state.data?.captions.some((c) => c.status === "inprogress") ?? false)
        ? 5000
        : false,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["captions", item.id] });

  const gen = useMutation({
    mutationFn: () => generateCaption(item.id, genLang ?? "en"),
    onSuccess: invalidate,
    onError: () => notifications.show({ message: "Couldn't generate captions", color: "red" }),
  });
  const up = useMutation({
    mutationFn: () => uploadCaption(item.id, upLang ?? "en", file as File),
    onSuccess: () => {
      setFile(null);
      invalidate();
    },
    onError: () => notifications.show({ message: "Couldn't upload caption", color: "red" }),
  });
  const del = useMutation({
    mutationFn: (lang: string) => deleteCaption(item.id, lang),
    onSuccess: invalidate,
    onError: () => notifications.show({ message: "Couldn't delete caption", color: "red" }),
  });

  if (!ready) return null;
  const captions = q.data?.captions ?? [];

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Captions
      </Text>
      {captions.length === 0 ? (
        <Text size="xs" c="dimmed">
          No captions yet.
        </Text>
      ) : (
        captions.map((cap: Caption) => (
          <Group key={cap.language} justify="space-between" wrap="nowrap" gap="xs">
            <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
              <Text size="sm" lineClamp={1}>
                {cap.label || cap.language}
              </Text>
              {cap.generated && (
                <Badge size="xs" variant="light" color="grape">
                  auto
                </Badge>
              )}
              <Badge
                size="xs"
                variant="light"
                color={cap.status === "ready" ? "green" : cap.status === "error" ? "red" : "gray"}
              >
                {cap.status}
              </Badge>
            </Group>
            <ActionIcon
              variant="subtle"
              color="red"
              aria-label={`Delete ${cap.label}`}
              loading={del.isPending && del.variables === cap.language}
              onClick={() => del.mutate(cap.language)}
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))
      )}

      <Group gap="xs" align="end">
        <Select
          label="Generate (AI)"
          data={GENERATE_LANGUAGES}
          value={genLang}
          onChange={setGenLang}
          allowDeselect={false}
          w={150}
        />
        <Button size="xs" loading={gen.isPending} disabled={!genLang} onClick={() => gen.mutate()}>
          Generate
        </Button>
      </Group>

      <Group gap="xs" align="end">
        <Select
          label="Upload .vtt"
          data={CAPTION_LANGUAGES}
          value={upLang}
          onChange={setUpLang}
          allowDeselect={false}
          w={150}
        />
        <FileInput
          placeholder=".vtt file"
          accept=".vtt,text/vtt"
          value={file}
          onChange={setFile}
          style={{ flex: 1 }}
        />
        <Button
          size="xs"
          loading={up.isPending}
          disabled={!upLang || !file}
          onClick={() => up.mutate()}
        >
          Upload
        </Button>
      </Group>
    </Stack>
  );
}
