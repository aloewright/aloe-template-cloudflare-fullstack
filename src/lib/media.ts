/* AGPL-3.0-or-later */
import { type ImageItem, listImages, listStream, type StreamItem } from "@/lib/cf-api";

export type MediaKind = "image" | "video";

export type MediaItem = {
  kind: MediaKind;
  id: string; // image id or video uid
  name: string;
  thumbnailUrl: string;
  createdAt: string; // ISO; uploaded (image) or created (video)
  requireSignedURLs: boolean;
  // video-only (null for images)
  duration: number | null;
  status: string | null;
  readyToStream: boolean | null;
  iframeUrl: string | null;
  // image-only
  variants: string[];
  meta: Record<string, string>;
};

const MAX_PAGES = 40; // safety cap for client-side load-all

function imageToMedia(i: ImageItem): MediaItem {
  return {
    kind: "image",
    id: i.id,
    name: i.filename,
    thumbnailUrl: i.thumbnailUrl,
    createdAt: i.uploaded,
    requireSignedURLs: i.requireSignedURLs,
    duration: null,
    status: null,
    readyToStream: null,
    iframeUrl: null,
    variants: i.variants,
    meta: i.meta,
  };
}

function streamToMedia(v: StreamItem): MediaItem {
  return {
    kind: "video",
    id: v.uid,
    name: v.name,
    thumbnailUrl: v.thumbnail,
    createdAt: v.created,
    requireSignedURLs: v.requireSignedURLs,
    duration: v.duration,
    status: v.status,
    readyToStream: v.readyToStream,
    iframeUrl: v.iframeUrl,
    variants: [],
    meta: v.meta,
  };
}

async function allImages(): Promise<ImageItem[]> {
  const out: ImageItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await listImages(cursor);
    out.push(...page.images);
    if (!page.continuationToken) break;
    cursor = page.continuationToken;
  }
  return out;
}

async function allStream(): Promise<StreamItem[]> {
  const out: StreamItem[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await listStream(cursor);
    out.push(...page.videos);
    if (!page.cursor) break;
    cursor = page.cursor;
  }
  return out;
}

export async function fetchAllMedia(): Promise<MediaItem[]> {
  const [images, videos] = await Promise.all([allImages(), allStream()]);
  return [...images.map(imageToMedia), ...videos.map(streamToMedia)];
}

export type SortKey = "newest" | "oldest" | "nameAsc" | "nameDesc" | "type" | "duration";

export function filterAndSort(
  items: MediaItem[],
  type: "all" | "image" | "video",
  sort: SortKey,
): MediaItem[] {
  const filtered = type === "all" ? items : items.filter((i) => i.kind === type);
  const byName = (a: MediaItem, b: MediaItem) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  const byDateDesc = (a: MediaItem, b: MediaItem) => b.createdAt.localeCompare(a.createdAt);
  const sorted = [...filtered];
  switch (sort) {
    case "newest":
      sorted.sort(byDateDesc);
      break;
    case "oldest":
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "nameAsc":
      sorted.sort(byName);
      break;
    case "nameDesc":
      sorted.sort((a, b) => byName(b, a));
      break;
    case "type":
      // images first, then videos; stable-ish by date within each
      sorted.sort((a, b) => (a.kind === b.kind ? byDateDesc(a, b) : a.kind === "image" ? -1 : 1));
      break;
    case "duration":
      // longest videos first; images (null duration) sort to the end
      sorted.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1));
      break;
  }
  return sorted;
}
