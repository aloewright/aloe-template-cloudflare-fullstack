/* AGPL-3.0-or-later */
import { Badge, Card, Image, Text } from "@mantine/core";
import { IconPlayerPlayFilled } from "@tabler/icons-react";
import type { StreamItem } from "@/lib/cf-api";

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function StreamCard({
  item,
  onOpen,
}: {
  item: StreamItem;
  onOpen: (item: StreamItem) => void;
}) {
  return (
    <Card
      withBorder
      padding={0}
      radius="md"
      className="break-inside-avoid cursor-pointer overflow-hidden relative"
      onClick={() => onOpen(item)}
    >
      {item.thumbnail ? (
        <Image src={item.thumbnail} alt={item.name} loading="lazy" />
      ) : (
        <Text p="sm" size="sm" c="dimmed">
          No thumbnail
        </Text>
      )}
      <IconPlayerPlayFilled
        size={28}
        style={{
          position: "absolute",
          top: "40%",
          left: "calc(50% - 14px)",
          color: "white",
          filter: "drop-shadow(0 1px 2px rgba(0,0,0,.6))",
        }}
      />
      {item.duration > 0 && (
        <Badge
          size="sm"
          variant="filled"
          color="dark"
          style={{ position: "absolute", bottom: 28, right: 6 }}
        >
          {fmt(item.duration)}
        </Badge>
      )}
      <Text p="xs" size="xs" lineClamp={1} title={item.name}>
        {item.name}
      </Text>
    </Card>
  );
}
