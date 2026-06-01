/* AGPL-3.0-or-later */
import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ImageCard } from "@/components/ImageCard";
import { ImageDetailDrawer } from "@/components/ImageDetailDrawer";
import { MediaGrid } from "@/components/MediaGrid";
import { type ImageItem, listImages } from "@/lib/cf-api";

export function ImagesPanel() {
  const [selected, setSelected] = useState<ImageItem | null>(null);
  const query = useInfiniteQuery({
    queryKey: ["images"],
    queryFn: ({ pageParam }) => listImages(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.continuationToken ?? undefined,
  });

  if (query.isLoading) {
    return (
      <Center py="xl">
        <Loader />
      </Center>
    );
  }

  const images = query.data?.pages.flatMap((p) => p.images) ?? [];
  if (images.length === 0) {
    return (
      <Center py="xl">
        <Text c="dimmed">No images in this account yet.</Text>
      </Center>
    );
  }

  return (
    <Stack>
      <MediaGrid>
        {images.map((item) => (
          <ImageCard key={item.id} item={item} onOpen={setSelected} />
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
      <ImageDetailDrawer item={selected} onClose={() => setSelected(null)} />
    </Stack>
  );
}
