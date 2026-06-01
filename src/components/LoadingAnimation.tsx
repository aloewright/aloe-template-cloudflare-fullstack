/* AGPL-3.0-or-later */
import loaderSvg from "@/assets/loader.svg?raw";

// Inline the self-animating brand SVG so it ships inside the JS bundle (served
// reliably via /assets) instead of relying on a root public file, which the
// TanStack Start + Cloudflare worker does not serve. Strip the XML prolog and
// make the SVG fill its (sized) container.
const markup = loaderSvg
  .replace(/<\?xml[^>]*\?>/, "")
  .replace("<svg ", '<svg width="100%" height="100%" ');

export function LoadingAnimation({ size = 64 }: { size?: number }) {
  return (
    <div
      role="img"
      aria-label="Loading…"
      style={{ width: size, height: size }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted build-time static asset
      // oxlint-disable-next-line no-danger
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
