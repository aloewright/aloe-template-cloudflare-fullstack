/* AGPL-3.0-or-later */
import {
  type AudioFile,
  deleteAudio,
  deleteImage,
  deleteStream,
  type ImageItem,
  listAudio,
  listImages,
  listStream,
  type MediaPatch,
  type StreamItem,
  type StreamLink,
  updateAudio,
  updateImage,
  updateStream,
} from "@/lib/cf-api";

export type MediaKind = "image" | "video" | "audio";

export type MediaItem = {
  kind: MediaKind;
  id: string; // image id or video uid
  name: string;
  thumbnailUrl: string;
  createdAt: string; // ISO; uploaded (image) or created (video)
  requireSignedURLs: boolean;
  // video-only (null/empty for images)
  duration: number | null;
  width: number | null;
  height: number | null;
  status: string | null;
  readyToStream: boolean | null;
  iframeUrl: string | null;
  thumbnailTimestampPct: number | null;
  allowedOrigins: string[];
  links: StreamLink[];
  // image-only
  variants: string[];
  meta: Record<string, string>;
  // audio-only (null for image/video)
  src: string | null;
  contentType: string | null;
  size: number | null;
};

const MAX_PAGES = 40; // safety cap for client-side load-all

function imageToMedia(i: ImageItem): MediaItem {
  return {
    kind: "image",
    id: i.id,
    name: i.meta?.name ?? i.filename,
    thumbnailUrl: i.thumbnailUrl,
    createdAt: i.uploaded,
    requireSignedURLs: i.requireSignedURLs,
    duration: null,
    width: null,
    height: null,
    status: null,
    readyToStream: null,
    iframeUrl: null,
    thumbnailTimestampPct: null,
    allowedOrigins: [],
    links: [],
    variants: i.variants,
    meta: i.meta,
    src: null,
    contentType: null,
    size: null,
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
    width: v.width,
    height: v.height,
    status: v.status,
    readyToStream: v.readyToStream,
    iframeUrl: v.iframeUrl,
    thumbnailTimestampPct: v.thumbnailTimestampPct,
    allowedOrigins: v.allowedOrigins,
    links: v.links,
    variants: [],
    meta: v.meta,
    src: null,
    contentType: null,
    size: null,
  };
}

function audioToMedia(f: AudioFile): MediaItem {
  return {
    kind: "audio",
    id: f.id,
    name: f.name,
    thumbnailUrl: "",
    createdAt: f.createdAt,
    requireSignedURLs: false,
    duration: null,
    width: null,
    height: null,
    status: null,
    readyToStream: null,
    iframeUrl: null,
    thumbnailTimestampPct: null,
    allowedOrigins: [],
    links: [],
    variants: [],
    meta: {},
    src: f.src,
    contentType: f.contentType,
    size: f.size,
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

async function allAudio(): Promise<AudioFile[]> {
  return (await listAudio()).files;
}

export async function fetchAllMedia(): Promise<MediaItem[]> {
  const [images, videos, audio] = await Promise.all([allImages(), allStream(), allAudio()]);
  return [...images.map(imageToMedia), ...videos.map(streamToMedia), ...audio.map(audioToMedia)];
}

export type SortKey = "newest" | "oldest" | "nameAsc" | "nameDesc" | "type" | "duration";

export function filterAndSort(
  items: MediaItem[],
  type: "all" | "image" | "video" | "audio",
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
    case "type": {
      // images, then videos, then audio; by date within each group
      const order = (k: MediaItem["kind"]) => (k === "image" ? 0 : k === "video" ? 1 : 2);
      sorted.sort((a, b) => (a.kind === b.kind ? byDateDesc(a, b) : order(a.kind) - order(b.kind)));
      break;
    }
    case "duration":
      // longest videos first; images (null duration) sort to the end
      sorted.sort((a, b) => (b.duration ?? -1) - (a.duration ?? -1));
      break;
  }
  return sorted;
}

export function updateMediaItem(
  item: MediaItem,
  patch: MediaPatch,
): Promise<ImageItem | StreamItem | AudioFile> {
  if (item.kind === "audio") return updateAudio(item.id, { name: patch.name });
  return item.kind === "image" ? updateImage(item.id, patch) : updateStream(item.id, patch);
}

export function deleteMediaItem(item: MediaItem): Promise<{ ok: true }> {
  if (item.kind === "audio") return deleteAudio(item.id);
  return item.kind === "image" ? deleteImage(item.id) : deleteStream(item.id);
}
