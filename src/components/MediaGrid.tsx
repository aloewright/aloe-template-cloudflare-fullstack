/* AGPL-3.0-or-later */
import type { ReactNode } from "react";

// Simple CSS-columns masonry. Children should set `break-inside-avoid`.
export function MediaGrid({ children }: { children: ReactNode }) {
  return <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 [&>*]:mb-3">{children}</div>;
}
