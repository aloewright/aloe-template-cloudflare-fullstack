/* AGPL-3.0-or-later */
import { Audio } from "@gfazioli/mantine-audio";

// Compact: controls + timeline only (grid cards). Full: animated spectrum
// above the controls (detail drawer + cinema). Inherits the Mantine theme;
// customize via the Styles API if needed.
export function AudioPlayer({ src, variant }: { src: string; variant: "compact" | "full" }) {
  if (variant === "compact") {
    return <Audio src={src} controls size="sm" />;
  }
  return (
    <Audio src={src}>
      <Audio.Spectrum height={96} />
      <Audio.Controls>
        <Audio.PlayButton />
        <Audio.Timeline />
        <Audio.TimeDisplay />
        <Audio.VolumeSlider />
      </Audio.Controls>
    </Audio>
  );
}
