/* AGPL-3.0-or-later */
import {
  Alert,
  Badge,
  Center,
  CopyButton,
  Drawer,
  Group,
  Image,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { getImage, getImageVariants, type VariantDims } from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";

function variantName(url: string): string {
  try {
    return new URL(url).pathname.split("/").pop() || url;
  } catch {
    return url;
  }
}

function dimsLabel(d: VariantDims | undefined): string {
  if (d?.width && d?.height) return `${d.width}×${d.height}`;
  if (d?.width) return `${d.width}px wide`;
  if (d?.height) return `${d.height}px tall`;
  return "auto";
}

function MetaTable({ meta }: { meta: Record<string, string> }) {
  const entries = Object.entries(meta);
  if (entries.length === 0) return null;
  return (
    <Table>
      <Table.Tbody>
        {entries.map(([k, v]) => (
          <Table.Tr key={k}>
            <Table.Td>{k}</Table.Td>
            <Table.Td>{v}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
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
      <MetaTable meta={item.meta} />
      <Text size="sm" fw={600}>
        Variants — click to copy URL
      </Text>
      {detail.isLoading ? (
        <Center py="sm">
          <Loader size="sm" />
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
        {item.requireSignedURLs && <Badge color="orange">signed URLs</Badge>}
      </Group>
      <MetaTable meta={item.meta} />
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

export function MediaDetailDrawer({
  item,
  onClose,
}: {
  item: MediaItem | null;
  onClose: () => void;
}) {
  return (
    <Drawer opened={item !== null} onClose={onClose} position="right" size="lg" title={item?.name}>
      {item && (item.kind === "image" ? <ImageDetail item={item} /> : <VideoDetail item={item} />)}
    </Drawer>
  );
}
