/* AGPL-3.0-or-later */
import { Badge, Image, Table, Text } from "@mantine/core";
import type { MediaItem } from "@/lib/media";

function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

export function MediaTable({
  items,
  onOpen,
}: {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  return (
    <Table highlightOnHover stickyHeader verticalSpacing="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th w={64} />
          <Table.Th>Name</Table.Th>
          <Table.Th w={90}>Type</Table.Th>
          <Table.Th w={120}>Date</Table.Th>
          <Table.Th w={90}>Duration</Table.Th>
          <Table.Th w={90}>Access</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {items.map((item) => (
          <Table.Tr
            key={`${item.kind}-${item.id}`}
            onClick={() => onOpen(item)}
            style={{ cursor: "pointer" }}
          >
            <Table.Td>
              {item.thumbnailUrl ? (
                <Image
                  src={item.thumbnailUrl}
                  alt={item.name}
                  w={48}
                  h={48}
                  radius="sm"
                  fit="cover"
                  loading="lazy"
                />
              ) : null}
            </Table.Td>
            <Table.Td>
              <Text size="sm" lineClamp={1} title={item.name}>
                {item.name}
              </Text>
            </Table.Td>
            <Table.Td>
              <Badge variant="light" color={item.kind === "video" ? "grape" : "blue"}>
                {item.kind}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Text size="sm" c="dimmed">
                {fmtDate(item.createdAt)}
              </Text>
            </Table.Td>
            <Table.Td>
              <Text size="sm" c="dimmed">
                {fmtDuration(item.duration)}
              </Text>
            </Table.Td>
            <Table.Td>
              {item.requireSignedURLs ? (
                <Badge color="orange" variant="light">
                  signed
                </Badge>
              ) : (
                <Badge color="gray" variant="light">
                  public
                </Badge>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
