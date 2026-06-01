/* AGPL-3.0-or-later */
import { Badge, CopyButton, Drawer, Group, Image, Stack, Table, Text } from "@mantine/core";
import type { ImageItem } from "@/lib/cf-api";

export function ImageDetailDrawer({
  item,
  onClose,
}: {
  item: ImageItem | null;
  onClose: () => void;
}) {
  return (
    <Drawer
      opened={item !== null}
      onClose={onClose}
      position="right"
      size="lg"
      title={item?.filename}
    >
      {item && (
        <Stack>
          {item.thumbnailUrl && <Image src={item.thumbnailUrl} alt={item.filename} radius="md" />}
          <Group gap="xs">
            <Badge variant="light">{item.id}</Badge>
            {item.requireSignedURLs && <Badge color="orange">signed URLs</Badge>}
          </Group>
          <Text size="sm" c="dimmed">
            Uploaded {item.uploaded || "—"}
          </Text>
          {Object.keys(item.meta).length > 0 && (
            <Table>
              <Table.Tbody>
                {Object.entries(item.meta).map(([k, v]) => (
                  <Table.Tr key={k}>
                    <Table.Td>{k}</Table.Td>
                    <Table.Td>{v}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Text size="sm" fw={600}>
            Variants
          </Text>
          {item.variants.map((v) => (
            <Group key={v} gap="xs" wrap="nowrap">
              <Text size="xs" style={{ wordBreak: "break-all" }}>
                {v}
              </Text>
              <CopyButton value={v}>
                {({ copied, copy }) => (
                  <Text size="xs" c="indigo" onClick={copy} style={{ cursor: "pointer" }}>
                    {copied ? "copied" : "copy"}
                  </Text>
                )}
              </CopyButton>
            </Group>
          ))}
        </Stack>
      )}
    </Drawer>
  );
}
