/* AGPL-3.0-or-later */
import { fetchJson } from "@/lib/api";

export type ConnectionStatus = {
  connected: boolean;
  accountId?: string;
  accountHash?: string | null;
  streamCode?: string | null;
  flexibleVariantsEnabled?: boolean;
};

export type ImageItem = {
  id: string;
  filename: string;
  uploaded: string;
  requireSignedURLs: boolean;
  meta: Record<string, string>;
  variants: string[];
  thumbnailUrl: string;
};
export type ImagesPage = { images: ImageItem[]; continuationToken: string | null };

export type StreamLink = { label: string; sublabel: string; url: string };

export type StreamItem = {
  uid: string;
  name: string;
  thumbnail: string;
  duration: number;
  width: number | null;
  height: number | null;
  status: string;
  readyToStream: boolean;
  requireSignedURLs: boolean;
  thumbnailTimestampPct: number;
  iframeUrl: string;
  links: StreamLink[];
  meta: Record<string, string>;
  created: string;
};
export type StreamPage = { videos: StreamItem[]; cursor: string | null };

export const getSettings = () => fetchJson<ConnectionStatus>("/api/settings");

export const saveSettings = (body: { accountId: string; token: string }) =>
  fetchJson<ConnectionStatus>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const testConnection = () =>
  fetchJson<ConnectionStatus>("/api/settings/test", { method: "POST" });

export const getMe = () => fetchJson<{ email: string }>("/api/me");

export const listImages = (cursor?: string) =>
  fetchJson<ImagesPage>(`/api/images${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);

export const listStream = (cursor?: string) =>
  fetchJson<StreamPage>(`/api/stream${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);

// Image detail with fully-signed variant URLs (the list only signs thumbnails).
export const getImage = (id: string) =>
  fetchJson<ImageItem>(`/api/images/${encodeURIComponent(id)}`);

export type VariantDims = { width: number | null; height: number | null };
export const getImageVariants = () =>
  fetchJson<{ variants: Record<string, VariantDims> }>("/api/images/variants");

export type MediaPatch = {
  name?: string;
  meta?: Record<string, string>;
  requireSignedURLs?: boolean;
};

export const updateImage = (id: string, patch: MediaPatch) =>
  fetchJson<ImageItem>(`/api/images/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const deleteImage = (id: string) =>
  fetchJson<{ ok: true }>(`/api/images/${encodeURIComponent(id)}`, { method: "DELETE" });

export const updateStream = (uid: string, patch: MediaPatch) =>
  fetchJson<StreamItem>(`/api/stream/${encodeURIComponent(uid)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const deleteStream = (uid: string) =>
  fetchJson<{ ok: true }>(`/api/stream/${encodeURIComponent(uid)}`, { method: "DELETE" });

export const getImageUploadUrl = (requireSignedURLs: boolean) =>
  fetchJson<{ uploadURL: string; id: string }>("/api/images/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requireSignedURLs }),
  });

export const getStreamUploadUrl = (input: {
  uploadLength: number;
  name?: string;
  requireSignedURLs?: boolean;
}) =>
  fetchJson<{ uploadURL: string; uid: string }>("/api/stream/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export const createClip = (
  uid: string,
  input: { startTimeSeconds: number; endTimeSeconds: number; name?: string },
) =>
  fetchJson<StreamItem>(`/api/stream/${encodeURIComponent(uid)}/clip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

export type AudioFile = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  createdAt: string;
  src: string;
};

export const listAudio = () => fetchJson<{ files: AudioFile[] }>("/api/audio");

export const updateAudio = (id: string, patch: { name?: string }) =>
  fetchJson<AudioFile>(`/api/audio/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });

export const deleteAudio = (id: string) =>
  fetchJson<{ ok: true }>(`/api/audio/${encodeURIComponent(id)}`, { method: "DELETE" });

export const transformDownloadUrl = (id: string, options: string, name: string): string => {
  const q = new URLSearchParams({ o: options, name }).toString();
  return `/api/images/${encodeURIComponent(id)}/transform-download?${q}`;
};

export const enableFlexibleVariants = () =>
  fetchJson<ConnectionStatus>("/api/images/flexible-variants", { method: "POST" });

export type DownloadInfo = { status: string; percentComplete: number; url: string | null };
export type DownloadsStatus = { default: DownloadInfo | null; audio: DownloadInfo | null };

export const getDownloads = (uid: string) =>
  fetchJson<DownloadsStatus>(`/api/stream/${encodeURIComponent(uid)}/downloads`);

export const enableDownload = (uid: string, type: "default" | "audio") =>
  fetchJson<{ ok: true }>(`/api/stream/${encodeURIComponent(uid)}/downloads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });

export const deleteDownload = (uid: string, type: "default" | "audio") =>
  fetchJson<{ ok: true }>(`/api/stream/${encodeURIComponent(uid)}/downloads?type=${type}`, {
    method: "DELETE",
  });

export type Caption = { language: string; label: string; generated: boolean; status: string };

export const listCaptions = (uid: string) =>
  fetchJson<{ captions: Caption[] }>(`/api/stream/${encodeURIComponent(uid)}/captions`);

export const generateCaption = (uid: string, lang: string) =>
  fetchJson<{ ok: true }>(
    `/api/stream/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}/generate`,
    { method: "POST" },
  );

export const uploadCaption = (uid: string, lang: string, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return fetchJson<{ ok: true }>(
    `/api/stream/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}`,
    { method: "PUT", body: fd },
  );
};

export const deleteCaption = (uid: string, lang: string) =>
  fetchJson<{ ok: true }>(
    `/api/stream/${encodeURIComponent(uid)}/captions/${encodeURIComponent(lang)}`,
    { method: "DELETE" },
  );
