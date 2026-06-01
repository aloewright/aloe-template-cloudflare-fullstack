/* AGPL-3.0-or-later */
import { useMantineColorScheme } from "@mantine/core";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useUIStore } from "@/lib/store";

// Thin wrapper around TanStack Hotkeys (alpha) so the alpha API churn is
// contained in one place. Registers the app-wide keyboard map; mount once.
export function AppHotkeys() {
  const setView = useUIStore((s) => s.setView);
  const setMediaType = useUIStore((s) => s.setMediaType);
  const setSelected = useUIStore((s) => s.setSelected);
  const { toggleColorScheme } = useMantineColorScheme();

  useHotkey({ key: "g" }, () => setView("grid"));
  useHotkey({ key: "t" }, () => setView("table"));
  useHotkey("1", () => setMediaType("all"));
  useHotkey("2", () => setMediaType("image"));
  useHotkey("3", () => setMediaType("video"));
  useHotkey({ key: "d" }, () => toggleColorScheme());
  useHotkey("Escape", () => setSelected(null));

  return null;
}
