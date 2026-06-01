/* AGPL-3.0-or-later */
import {
  ActionIcon,
  Center,
  Container,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Text,
  Title,
} from "@mantine/core";
import { IconSettings } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { ColorSchemeToggle } from "@/components/ColorSchemeToggle";
import { MediaCard } from "@/components/MediaCard";
import { MediaDetailDrawer } from "@/components/MediaDetailDrawer";
import { MediaGrid } from "@/components/MediaGrid";
import { MediaTable } from "@/components/MediaTable";
import { getMe } from "@/lib/cf-api";
import { fetchAllMedia, filterAndSort, type SortKey } from "@/lib/media";
import { type MediaType, useUIStore } from "@/lib/store";

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "nameAsc", label: "Name A→Z" },
  { value: "nameDesc", label: "Name Z→A" },
  { value: "type", label: "Type" },
  { value: "duration", label: "Duration" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "All media" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
];

export function Gallery() {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  const media = useQuery({ queryKey: ["media"], queryFn: fetchAllMedia });

  const view = useUIStore((s) => s.view);
  const setView = useUIStore((s) => s.setView);
  const type = useUIStore((s) => s.mediaType);
  const setType = useUIStore((s) => s.setMediaType);
  const sort = useUIStore((s) => s.sort);
  const setSort = useUIStore((s) => s.setSort);
  const selected = useUIStore((s) => s.selected);
  const setSelected = useUIStore((s) => s.setSelected);

  const items = useMemo(
    () => filterAndSort(media.data ?? [], type, sort),
    [media.data, type, sort],
  );

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

      <Group justify="space-between" mb="md" wrap="wrap">
        <SegmentedControl
          value={view}
          onChange={(v) => setView(v as "grid" | "table")}
          data={[
            { value: "grid", label: "Grid" },
            { value: "table", label: "Table" },
          ]}
        />
        <Group gap="sm">
          <Select
            label={undefined}
            aria-label="Media type"
            data={TYPE_OPTIONS}
            value={type}
            onChange={(v) => setType((v as MediaType) ?? "all")}
            allowDeselect={false}
            w={150}
          />
          <Select
            aria-label="Sort by"
            data={SORT_OPTIONS}
            value={sort}
            onChange={(v) => setSort((v as SortKey) ?? "newest")}
            allowDeselect={false}
            w={170}
          />
        </Group>
      </Group>

      {media.isLoading ? (
        <Center py="xl">
          <Loader />
        </Center>
      ) : items.length === 0 ? (
        <Center py="xl">
          <Text c="dimmed">No media found.</Text>
        </Center>
      ) : view === "grid" ? (
        <MediaGrid>
          {items.map((item) => (
            <MediaCard key={`${item.kind}-${item.id}`} item={item} onOpen={setSelected} />
          ))}
        </MediaGrid>
      ) : (
        <MediaTable items={items} onOpen={setSelected} />
      )}

      <MediaDetailDrawer item={selected} onClose={() => setSelected(null)} />
    </Container>
  );
}
