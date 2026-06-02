/* AGPL-3.0-or-later */
import { Badge, Card, Image, Text } from "@mantine/core";
import { IconPlayerPlayFilled } from "@tabler/icons-react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { AudioThumb } from "@/components/AudioThumb";
import type { MediaItem } from "@/lib/media";

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function MediaCard({
  item,
  onOpen,
}: {
  item: MediaItem;
  onOpen: (item: MediaItem) => void;
}) {
  const isVideo = item.kind === "video";
  const isAudio = item.kind === "audio";
  return (
    <Card
      withBorder
      padding={0}
      radius="md"
      className="break-inside-avoid cursor-pointer overflow-hidden relative"
      onClick={() => onOpen(item)}
    >
      {isAudio ? (
        <>
          <AudioThumb />
          {item.src && (
            // biome-ignore lint/a11y/useKeyWithClickEvents: wrapper only stops propagation so the player's clicks don't open the drawer
            <div onClick={(e) => e.stopPropagation()} style={{ padding: 8 }}>
              <AudioPlayer src={item.src} variant="compact" />
            </div>
          )}
        </>
      ) : item.thumbnailUrl ? (
        <Image src={item.thumbnailUrl} alt={item.name} loading="lazy" />
      ) : (
        <Text p="sm" size="sm" c="dimmed">
          No preview
        </Text>
      )}
      {isVideo && (
        <>
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
          {item.duration && item.duration > 0 ? (
            <Badge
              size="sm"
              variant="filled"
              color="dark"
              style={{ position: "absolute", bottom: 28, right: 6 }}
            >
              {fmtDuration(item.duration)}
            </Badge>
          ) : null}
        </>
      )}
      <Text p="xs" size="xs" lineClamp={1} title={item.name}>
        {item.name}
      </Text>
    </Card>
  );
}
