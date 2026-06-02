/* AGPL-3.0-or-later */
import {
  Alert,
  Badge,
  Center,
  CopyButton,
  Drawer,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { useQuery } from "@tanstack/react-query";
import { getImage, getImageVariants, type VariantDims } from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";
import { LoadingAnimation } from "@/components/LoadingAnimation";
import { MediaEditPanel } from "@/components/MediaEditPanel";
import { ImageTransformPanel } from "@/components/ImageTransformPanel";

function variantName(url: string): string {
  try {
    return new URL(url).pathname.split("/").pop() || url;
  } catch {
    return url;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function dimsLabel(d: VariantDims | undefined): string {
  if (d?.width && d?.height) return `${d.width}×${d.height}`;
  if (d?.width) return `${d.width}px wide`;
  if (d?.height) return `${d.height}px tall`;
  return "auto";
}

function CopyBox({ title, subtitle, url }: { title: string; subtitle: string; url: string }) {
  return (
    <CopyButton value={url} timeout={1500}>
      {({ copied, copy }) => (
        <Paper
          withBorder
          p="xs"
          radius="md"
          onClick={copy}
          style={{
            cursor: "pointer",
            borderColor: copied ? "var(--mantine-color-green-6)" : undefined,
          }}
          title="Click to copy this URL"
        >
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <div style={{ minWidth: 0 }}>
              <Text size="sm" fw={600} lineClamp={1}>
                {title}
              </Text>
              <Text size="xs" c="dimmed">
                {copied ? "Copied!" : subtitle}
              </Text>
            </div>
            {copied ? (
              <IconCheck size={16} color="var(--mantine-color-green-6)" />
            ) : (
              <IconCopy size={16} />
            )}
          </Group>
        </Paper>
      )}
    </CopyButton>
  );
}

function ImageDetail({ item }: { item: MediaItem }) {
  const detail = useQuery({ queryKey: ["image", item.id], queryFn: () => getImage(item.id) });
  const variantDefs = useQuery({ queryKey: ["imageVariants"], queryFn: getImageVariants });
  const dims = variantDefs.data?.variants ?? {};
  const previewUrl = detail.data?.thumbnailUrl ?? item.thumbnailUrl;
  const variants = detail.data?.variants ?? item.variants;

  return (
    <Stack>
      {previewUrl && <Image src={previewUrl} alt={item.name} radius="md" />}
      <Group gap="xs">
        <Badge variant="light">{item.id}</Badge>
        {item.requireSignedURLs && <Badge color="orange">signed URLs</Badge>}
      </Group>
      <Text size="sm" c="dimmed">
        Uploaded {item.createdAt || "—"}
      </Text>
      <MediaEditPanel item={item} />
      <Text size="sm" fw={600}>
        Variants — click to copy URL
      </Text>
      {detail.isLoading ? (
        <Center py="sm">
          <LoadingAnimation size={32} />
        </Center>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
          {variants.map((v) => (
            <CopyBox
              key={v}
              title={variantName(v)}
              subtitle={dimsLabel(dims[variantName(v)])}
              url={v}
            />
          ))}
        </SimpleGrid>
      )}
      <ImageTransformPanel item={item} />
    </Stack>
  );
}

function VideoDetail({ item }: { item: MediaItem }) {
  return (
    <Stack>
      {item.readyToStream && item.iframeUrl ? (
        <div style={{ position: "relative", paddingTop: "56.25%" }}>
          <iframe
            title={item.name}
            src={item.iframeUrl}
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        </div>
      ) : (
        <Alert color="yellow">
          {item.requireSignedURLs
            ? "This video requires signed URLs."
            : `Video is not ready to stream (status: ${item.status ?? "unknown"}).`}
        </Alert>
      )}
      <Group gap="xs">
        <Badge variant="light">{item.id}</Badge>
        <Badge color={item.status === "ready" ? "green" : "gray"}>{item.status ?? "unknown"}</Badge>
        {item.width && item.height ? (
          <Badge variant="light" color="grape">
            {item.width}×{item.height}
          </Badge>
        ) : null}
        {item.duration && item.duration > 0 ? (
          <Badge variant="light" color="gray">
            {fmtDuration(item.duration)}
          </Badge>
        ) : null}
        {item.requireSignedURLs && <Badge color="orange">signed URLs</Badge>}
      </Group>
      <MediaEditPanel item={item} />
      {item.links.length > 0 && (
        <>
          <Text size="sm" fw={600}>
            Links — click to copy URL
          </Text>
          <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
            {item.links.map((l) => (
              <CopyBox key={l.url} title={l.label} subtitle={l.sublabel} url={l.url} />
            ))}
          </SimpleGrid>
        </>
      )}
      <Text size="sm" c="dimmed">
        Created {item.createdAt || "—"}
      </Text>
    </Stack>
  );
}

function AudioDetail({ item }: { item: MediaItem }) {
  return (
    <Stack>
      {item.src && <AudioPlayer src={item.src} variant="full" />}
      <Group gap="xs">
        <Badge variant="light">{item.id}</Badge>
        {item.contentType && (
          <Badge variant="light" color="teal">
            {item.contentType}
          </Badge>
        )}
        {item.size != null && (
          <Badge variant="light" color="gray">
            {fmtBytes(item.size)}
          </Badge>
        )}
      </Group>
      <MediaEditPanel item={item} />
      <Text size="sm" c="dimmed">
        Created {item.createdAt || "—"}
      </Text>
    </Stack>
  );
}

export function MediaDetailDrawer({
  item,
  onClose,
}: {
  item: MediaItem | null;
  onClose: () => void;
}) {
  return (
    <Drawer opened={item !== null} onClose={onClose} position="right" size="lg" title={item?.name}>
      {item &&
        (item.kind === "image" ? (
          <ImageDetail item={item} />
        ) : item.kind === "video" ? (
          <VideoDetail item={item} />
        ) : (
          <AudioDetail item={item} />
        ))}
    </Drawer>
  );
}
