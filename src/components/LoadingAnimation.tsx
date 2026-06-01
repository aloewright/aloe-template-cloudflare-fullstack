/* AGPL-3.0-or-later */

// Self-animating brand loader (SMIL animation lives in /public/loader.svg).
export function LoadingAnimation({ size = 64 }: { size?: number }) {
  return (
    <img src="/loader.svg" alt="Loading…" width={size} height={size} style={{ display: "block" }} />
  );
}
