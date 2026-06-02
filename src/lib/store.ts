/* AGPL-3.0-or-later */
import { create } from "zustand";
import type { MediaItem, SortKey } from "@/lib/media";

export type View = "grid" | "table" | "cinema";
export type MediaType = "all" | "image" | "video";

type UIState = {
  view: View;
  mediaType: MediaType;
  sort: SortKey;
  selected: MediaItem | null;
  selectedIds: Record<string, boolean>;
  uploadOpen: boolean;
  setView: (view: View) => void;
  setMediaType: (mediaType: MediaType) => void;
  setSort: (sort: SortKey) => void;
  setSelected: (selected: MediaItem | null) => void;
  setSelectedIds: (ids: Record<string, boolean>) => void;
  setUploadOpen: (open: boolean) => void;
};

// UI/client state (view, filter, sort, drawer selection). Server data stays in
// TanStack Query; this store lets the command palette + hotkeys drive the same
// state the gallery renders from.
export const useUIStore = create<UIState>((set) => ({
  view: "grid",
  mediaType: "all",
  sort: "newest",
  selected: null,
  selectedIds: {},
  uploadOpen: false,
  setView: (view) => set({ view }),
  setMediaType: (mediaType) => set({ mediaType }),
  setSort: (sort) => set({ sort }),
  setSelected: (selected) => set({ selected }),
  setSelectedIds: (selectedIds) => set({ selectedIds }),
  setUploadOpen: (uploadOpen) => set({ uploadOpen }),
}));
