/* AGPL-3.0-or-later */
import { Card, Image, Text } from "@mantine/core";
import type { ImageItem } from "@/lib/cf-api";

export function ImageCard({
  item,
  onOpen,
}: {
  item: ImageItem;
  onOpen: (item: ImageItem) => void;
}) {
  return (
    <Card
      withBorder
      padding={0}
      radius="md"
      className="break-inside-avoid cursor-pointer overflow-hidden"
      onClick={() => onOpen(item)}
    >
      {item.thumbnailUrl ? (
        <Image src={item.thumbnailUrl} alt={item.filename} loading="lazy" />
      ) : (
        <Text p="sm" size="sm" c="dimmed">
          No preview
        </Text>
      )}
      <Text p="xs" size="xs" lineClamp={1} title={item.filename}>
        {item.filename}
      </Text>
    </Card>
  );
}
