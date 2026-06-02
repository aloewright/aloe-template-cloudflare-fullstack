/* AGPL-3.0-or-later */
export function parseAccountHash(deliveryUrl: string): string | null {
  return deliveryUrl.match(/imagedelivery\.net\/([^/]+)\//)?.[1] ?? null;
}

export function parseStreamCode(url: string): string | null {
  return url.match(/customer-([a-z0-9]+)\.cloudflarestream\.com/i)?.[1] ?? null;
}

export function pickImageThumbnail(variants: string[]): string {
  if (variants.length === 0) return "";
  return variants.find((v) => v.endsWith("/public")) ?? variants[0] ?? "";
}

export function streamIframeUrl(code: string, uid: string): string {
  return `https://customer-${code}.cloudflarestream.com/${uid}/iframe`;
}

// Cloudflare download `filename` must be [A-Za-z0-9-_]; the extension is
// appended automatically, so strip it and replace everything else.
export function sanitizeDownloadFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  const safe = base
    .replace(/[^A-Za-z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return safe || "video";
}
