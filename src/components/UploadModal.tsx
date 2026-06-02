/* AGPL-3.0-or-later */
import { Modal, Progress, Stack, Switch, Text, Group } from "@mantine/core";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import "@mantine/dropzone/styles.css";
import { notifications } from "@mantine/notifications";
import { IconUpload } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { isUploadable, uploadFile } from "@/lib/upload";
import { useUIStore } from "@/lib/store";

type Item = { name: string; percent: number; state: "uploading" | "done" | "error" };
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/*"];

export function UploadModal() {
  const opened = useUIStore((s) => s.uploadOpen);
  const setOpen = useUIStore((s) => s.setUploadOpen);
  const queryClient = useQueryClient();
  const [signed, setSigned] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const onDrop = async (files: File[]) => {
    const accepted = files.filter(isUploadable);
    if (accepted.length === 0) return;
    setBusy(true);
    setItems(accepted.map((f) => ({ name: f.name, percent: 0, state: "uploading" })));
    const update = (i: number, patch: Partial<Item>) =>
      setItems((cur) => cur.map((it, j) => (j === i ? { ...it, ...patch } : it)));

    const results = await Promise.allSettled(
      accepted.map((file, i) =>
        uploadFile(file, signed, (p) => update(i, { percent: p })).then(
          () => update(i, { percent: 100, state: "done" }),
          (e) => {
            update(i, { state: "error" });
            throw e;
          },
        ),
      ),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    setBusy(false);
    void queryClient.invalidateQueries({ queryKey: ["media"] });
    notifications.show({
      message:
        failed === 0
          ? `Uploaded ${results.length} file(s)`
          : `Uploaded ${results.length - failed} of ${results.length} (${failed} failed)`,
      color: failed === 0 ? "green" : "orange",
    });
  };

  return (
    <Modal opened={opened} onClose={() => setOpen(false)} title="Upload media" size="lg">
      <Stack>
        <Switch
          label="Require signed URLs"
          checked={signed}
          onChange={(e) => setSigned(e.currentTarget.checked)}
        />
        <Dropzone onDrop={onDrop} accept={[...IMAGE_MIME_TYPE, ...VIDEO_MIME]} loading={busy}>
          <Group justify="center" gap="sm" mih={120} style={{ pointerEvents: "none" }}>
            <IconUpload size={32} />
            <Text>Drag images or videos here, or click to choose</Text>
          </Group>
        </Dropzone>
        {items.length > 0 && (
          <Stack gap="xs">
            {items.map((it) => (
              <div key={it.name}>
                <Group justify="space-between" gap="xs">
                  <Text size="sm" lineClamp={1}>
                    {it.name}
                  </Text>
                  <Text size="xs" c={it.state === "error" ? "red" : "dimmed"}>
                    {it.state === "error"
                      ? "failed"
                      : it.state === "done"
                        ? "done"
                        : `${it.percent}%`}
                  </Text>
                </Group>
                <Progress
                  value={it.percent}
                  color={it.state === "error" ? "red" : it.state === "done" ? "green" : "blue"}
                />
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
