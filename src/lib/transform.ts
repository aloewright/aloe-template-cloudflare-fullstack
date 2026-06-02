/* AGPL-3.0-or-later */
export type Fit = "scale-down" | "contain" | "cover" | "crop" | "pad";
export type Format = "auto" | "webp" | "avif" | "jpeg" | "png";
export type Metadata = "keep" | "copyright" | "none";

export type TransformOptions = {
  width?: number;
  height?: number;
  fit?: Fit;
  gravity?: string;
  dpr?: number;
  trim?: string;
  background?: string; // hex like #ffffff
  rotate?: 90 | 180 | 270;
  blur?: number;
  sharpen?: number;
  brightness?: number;
  contrast?: number;
  gamma?: number;
  format?: Format;
  quality?: number;
  metadata?: Metadata;
  anim?: boolean;
  compression?: "fast";
};

// Comma-separated flexible-variant options, only for keys that are set.
export function buildOptionsString(o: TransformOptions): string {
  const parts: string[] = [];
  const add = (k: string, v: string | number | undefined) => {
    if (v === undefined || v === "") return;
    parts.push(`${k}=${v}`);
  };
  add("width", o.width);
  add("height", o.height);
  add("fit", o.fit);
  add("gravity", o.gravity);
  add("dpr", o.dpr);
  add("trim", o.trim);
  if (o.background) parts.push(`background=${encodeURIComponent(o.background)}`);
  add("rotate", o.rotate);
  add("blur", o.blur);
  add("sharpen", o.sharpen);
  add("brightness", o.brightness);
  add("contrast", o.contrast);
  add("gamma", o.gamma);
  add("format", o.format);
  add("quality", o.quality);
  add("metadata", o.metadata);
  if (o.anim !== undefined) parts.push(`anim=${o.anim}`);
  add("compression", o.compression);
  return parts.join(",");
}

export function parseAccountHash(deliveryUrl: string): string | null {
  return deliveryUrl.match(/imagedelivery\.net\/([^/]+)\//)?.[1] ?? null;
}

export function buildDeliveryUrl(accountHash: string, imageId: string, options: string): string {
  const base = `https://imagedelivery.net/${accountHash}/${imageId}`;
  return options ? `${base}/${options}` : base;
}
