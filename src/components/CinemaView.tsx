/* AGPL-3.0-or-later */
import { ActionIcon, Alert, Box, Button, Group, Image, Paper, Stack, Text } from "@mantine/core";
import { Carousel } from "@mantine/carousel";
import "@mantine/carousel/styles.css";
import { IconInfoCircle, IconPhoto, IconVideo } from "@tabler/icons-react";
import type { EmblaCarouselType } from "embla-carousel";
import { useEffect, useState } from "react";
import type { MediaItem } from "@/lib/media";

// A single full-size preview pane. Images scale to contain; ready videos play
// in the Stream iframe, others show a status note.
function Preview({ item }: { item: MediaItem }) {
  if (item.kind === "video") {
    if (item.readyToStream && item.iframeUrl) {
      return (
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <iframe
            title={item.name}
            src={item.iframeUrl}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        </div>
      );
    }
    return (
      <Group justify="center" align="center" h="100%">
        <Alert color="yellow" maw={420}>
          {item.requireSignedURLs
            ? "This video requires signed URLs."
            : `Video is not ready to stream (status: ${item.status ?? "unknown"}).`}
        </Alert>
      </Group>
    );
  }
  return (
    <Image
      src={item.thumbnailUrl}
      alt={item.name}
      fit="contain"
      h="100%"
      w="100%"
      fallbackSrc="data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"
    />
  );
}

export function CinemaView({
  items,
  onOpen,
}: {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  const [embla, setEmbla] = useState<EmblaCarouselType | null>(null);
  const [current, setCurrent] = useState(0);

  // Clamp the active index when the list changes (filter/sort) and keep embla in sync.
  useEffect(() => {
    if (current > items.length - 1) setCurrent(Math.max(0, items.length - 1));
  }, [items.length, current]);

  // Scroll the filmstrip's active thumbnail into view as the slide changes.
  useEffect(() => {
    const el = document.querySelector<HTMLButtonElement>(`[data-cinema-thumb="${current}"]`);
    el?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [current]);

  const active = items[current];

  return (
    <Stack gap="sm">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          {active?.kind === "video" ? <IconVideo size={18} /> : <IconPhoto size={18} />}
          <Text fw={600} lineClamp={1}>
            {active?.name ?? "—"}
          </Text>
          <Text c="dimmed" size="sm" style={{ whiteSpace: "nowrap" }}>
            {items.length > 0 ? `${current + 1} of ${items.length}` : "0"}
          </Text>
        </Group>
        {active && (
          <Button
            size="xs"
            variant="light"
            leftSection={<IconInfoCircle size={16} />}
            onClick={() => onOpen(active)}
          >
            Details
          </Button>
        )}
      </Group>

      <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
        <Carousel
          getEmblaApi={setEmbla}
          onSlideChange={setCurrent}
          slideSize="100%"
          height="min(68vh, 640px)"
          withControls={items.length > 1}
          withIndicators={false}
          emblaOptions={{ loop: false, align: "center" }}
        >
          {items.map((item) => (
            <Carousel.Slide key={`${item.kind}-${item.id}`}>
              <Box h="min(68vh, 640px)" bg="dark.8">
                <Preview item={item} />
              </Box>
            </Carousel.Slide>
          ))}
        </Carousel>
      </Paper>

      {items.length > 1 && (
        <Group
          gap="xs"
          wrap="nowrap"
          style={{ overflowX: "auto", paddingBottom: 4 }}
          aria-label="Thumbnails"
        >
          {items.map((item, i) => (
            <ActionIcon
              key={`${item.kind}-${item.id}`}
              data-cinema-thumb={i}
              variant="default"
              onClick={() => embla?.scrollTo(i)}
              aria-label={`Show ${item.name}`}
              aria-current={i === current}
              style={{
                width: 72,
                height: 72,
                flex: "0 0 auto",
                padding: 0,
                overflow: "hidden",
                borderRadius: 8,
                outline: i === current ? "2px solid var(--mantine-color-blue-5)" : "none",
                outlineOffset: 1,
                opacity: i === current ? 1 : 0.65,
              }}
            >
              <img
                src={item.thumbnailUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </ActionIcon>
          ))}
        </Group>
      )}
    </Stack>
  );
}
