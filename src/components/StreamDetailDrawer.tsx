/* AGPL-3.0-or-later */
import { Alert, Badge, Drawer, Group, Stack, Table, Text } from "@mantine/core";
import type { StreamItem } from "@/lib/cf-api";

export function StreamDetailDrawer({
  item,
  onClose,
}: {
  item: StreamItem | null;
  onClose: () => void;
}) {
  return (
    <Drawer opened={item !== null} onClose={onClose} position="right" size="lg" title={item?.name}>
      {item && (
        <Stack>
          {item.readyToStream && item.iframeUrl ? (
            <div style={{ position: "relative", paddingTop: "56.25%" }}>
              <iframe
                title={item.name}
                src={item.iframeUrl}
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                allowFullScreen
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  border: 0,
                }}
              />
            </div>
          ) : (
            <Alert color="yellow">
              {item.requireSignedURLs
                ? "This video requires signed URLs; playback needs a token (added in a later phase)."
                : `Video is not ready to stream (status: ${item.status}).`}
            </Alert>
          )}
          <Group gap="xs">
            <Badge variant="light">{item.uid}</Badge>
            <Badge color={item.status === "ready" ? "green" : "gray"}>{item.status}</Badge>
            {item.requireSignedURLs && <Badge color="orange">signed URLs</Badge>}
          </Group>
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
          <Text size="sm" c="dimmed">
            Created {item.created || "—"}
          </Text>
        </Stack>
      )}
    </Drawer>
  );
}
