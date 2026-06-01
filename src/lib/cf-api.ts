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
