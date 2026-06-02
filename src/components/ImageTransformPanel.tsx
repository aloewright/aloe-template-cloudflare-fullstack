/* AGPL-3.0-or-later */
import {
  Accordion,
  Alert,
  Button,
  ColorInput,
  CopyButton,
  Group,
  Image,
  NumberInput,
  Select,
  Slider,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconCopy, IconDownload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { enableFlexibleVariants, getSettings, transformDownloadUrl } from "@/lib/cf-api";
import type { MediaItem } from "@/lib/media";
import {
  buildDeliveryUrl,
  buildOptionsString,
  parseAccountHash,
  type TransformOptions,
} from "@/lib/transform";

const FIT = ["scale-down", "contain", "cover", "crop", "pad"];
const FORMAT = ["auto", "webp", "avif", "jpeg", "png"];
const META = ["keep", "copyright", "none"];
const GRAVITY = ["auto", "left", "right", "top", "bottom"];

export function ImageTransformPanel({ item }: { item: MediaItem }) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const queryClient = useQueryClient();
  const [opts, setOpts] = useState<TransformOptions>({});
  const [debounced] = useDebouncedValue(opts, 350);
  const [failed, setFailed] = useState(false);

  const enable = useMutation({
    mutationFn: enableFlexibleVariants,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["settings"] }),
    onError: () =>
      notifications.show({ message: "Could not enable flexible variants", color: "red" }),
  });

  const hash = useMemo(
    () => parseAccountHash(item.thumbnailUrl || item.variants[0] || ""),
    [item.thumbnailUrl, item.variants],
  );
  const optionsStr = useMemo(() => buildOptionsString(debounced), [debounced]);
  const previewUrl = hash ? buildDeliveryUrl(hash, item.id, optionsStr) : "";
  const set = (patch: Partial<TransformOptions>) => setOpts((o) => ({ ...o, ...patch }));

  if (item.requireSignedURLs) {
    return (
      <Alert color="yellow" title="Transforms unavailable">
        Flexible-variant transforms can't be used on images that require signed URLs. Turn off
        "Require signed URLs" above, or use a named variant.
      </Alert>
    );
  }
  if (!settings.data?.flexibleVariantsEnabled) {
    return (
      <Alert color="blue" title="Flexible variants are off">
        <Stack gap="xs">
          <Text size="sm">Enable flexible variants to transform images on the fly.</Text>
          <Button size="xs" loading={enable.isPending} onClick={() => enable.mutate()}>
            Enable flexible variants
          </Button>
        </Stack>
      </Alert>
    );
  }
  if (!hash) {
    return <Alert color="yellow">Couldn't determine the account hash for this image.</Alert>;
  }

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        Transform
      </Text>
      {previewUrl && (
        <Image
          src={previewUrl}
          alt={item.name}
          radius="md"
          onLoad={() => setFailed(false)}
          onError={() => setFailed(true)}
        />
      )}
      {failed && (
        <Text size="xs" c="red">
          Couldn't render — check the options.
        </Text>
      )}
      <Accordion multiple defaultValue={["size"]} variant="contained">
        <Accordion.Item value="size">
          <Accordion.Control>Size &amp; fit</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Group grow>
                <NumberInput label="Width" min={1} value={opts.width} onChange={(v) => set({ width: typeof v === "number" ? v : undefined })} />
                <NumberInput label="Height" min={1} value={opts.height} onChange={(v) => set({ height: typeof v === "number" ? v : undefined })} />
              </Group>
              <Select label="Fit" data={FIT} clearable value={opts.fit ?? null} onChange={(v) => set({ fit: (v as TransformOptions["fit"]) ?? undefined })} />
              <Select label="Gravity" data={GRAVITY} clearable value={opts.gravity ?? null} onChange={(v) => set({ gravity: v ?? undefined })} />
              <NumberInput label="DPR" min={1} max={3} value={opts.dpr} onChange={(v) => set({ dpr: typeof v === "number" ? v : undefined })} />
              <ColorInput label="Background (for pad)" format="hex" value={opts.background ?? ""} onChange={(v) => set({ background: v || undefined })} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="adjust">
          <Accordion.Control>Adjust</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Select label="Rotate" data={["90", "180", "270"]} clearable value={opts.rotate ? String(opts.rotate) : null} onChange={(v) => set({ rotate: v ? (Number(v) as 90 | 180 | 270) : undefined })} />
              <Text size="xs">Blur</Text>
              <Slider min={0} max={250} value={opts.blur ?? 0} onChange={(v) => set({ blur: v || undefined })} />
              <Text size="xs">Sharpen</Text>
              <Slider min={0} max={10} step={0.5} value={opts.sharpen ?? 0} onChange={(v) => set({ sharpen: v || undefined })} />
              <NumberInput label="Brightness" step={0.1} value={opts.brightness} onChange={(v) => set({ brightness: typeof v === "number" ? v : undefined })} />
              <NumberInput label="Contrast" step={0.1} value={opts.contrast} onChange={(v) => set({ contrast: typeof v === "number" ? v : undefined })} />
              <NumberInput label="Gamma" step={0.1} value={opts.gamma} onChange={(v) => set({ gamma: typeof v === "number" ? v : undefined })} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="output">
          <Accordion.Control>Output</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Select label="Format" data={FORMAT} clearable value={opts.format ?? null} onChange={(v) => set({ format: (v as TransformOptions["format"]) ?? undefined })} />
              <NumberInput label="Quality" min={1} max={100} value={opts.quality} onChange={(v) => set({ quality: typeof v === "number" ? v : undefined })} />
              <Select label="Metadata" data={META} clearable value={opts.metadata ?? null} onChange={(v) => set({ metadata: (v as TransformOptions["metadata"]) ?? undefined })} />
              <Switch label="Keep animation (anim)" checked={opts.anim ?? true} onChange={(e) => set({ anim: e.currentTarget.checked ? undefined : false })} />
              <Switch label="Fast compression" checked={opts.compression === "fast"} onChange={(e) => set({ compression: e.currentTarget.checked ? "fast" : undefined })} />
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
      {optionsStr && (
        <Text size="xs" c="dimmed" style={{ wordBreak: "break-all" }}>
          {optionsStr}
        </Text>
      )}
      <Group>
        <CopyButton value={previewUrl} timeout={1500}>
          {({ copied, copy }) => (
            <Button size="xs" variant="light" leftSection={<IconCopy size={14} />} onClick={copy}>
              {copied ? "Copied!" : "Copy URL"}
            </Button>
          )}
        </CopyButton>
        <Button
          size="xs"
          variant="light"
          component="a"
          href={transformDownloadUrl(item.id, optionsStr, `${item.name || item.id}`)}
          leftSection={<IconDownload size={14} />}
        >
          Download
        </Button>
      </Group>
    </Stack>
  );
}
