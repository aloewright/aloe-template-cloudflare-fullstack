/* AGPL-3.0-or-later */
import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { MediaGrid } from "@/components/MediaGrid";
import { StreamCard } from "@/components/StreamCard";
import { StreamDetailDrawer } from "@/components/StreamDetailDrawer";
import { listStream, type StreamItem } from "@/lib/cf-api";

export function StreamPanel() {
  const [selected, setSelected] = useState<StreamItem | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["stream"],
    queryFn: ({ pageParam }) => listStream(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor ?? undefined,
  });

  if (query.isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const videos = query.data?.pages.flatMap((p) => p.videos) ?? [];
  if (videos.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">No Stream videos in this account yet.</Text>
      </Center>
    );
  }

  return (
    <Stack>
      <MediaGrid>
        {videos.map((item) => (
          <StreamCard key={item.uid} item={item} onOpen={setSelected} />
        ))}
      </MediaGrid>
      {query.hasNextPage && (
        <Center>
          <Button
            variant="default"
            loading={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            Load more
          </Button>
        </Center>
      )}
      <StreamDetailDrawer item={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}
