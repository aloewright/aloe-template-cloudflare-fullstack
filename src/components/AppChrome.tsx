/* AGPL-3.0-or-later */
import { useMantineColorScheme } from "@mantine/core";
import { nprogress } from "@mantine/nprogress";
import { Spotlight, type SpotlightActionData } from "@mantine/spotlight";
import {
  IconLayoutGrid,
  IconMoon,
  IconPhoto,
  IconSettings,
  IconTable,
  IconVideo,
} from "@tabler/icons-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useUIStore } from "@/lib/store";

// Drives the Mantine route progress bar from the router's load status.
export function RouteProgress() {
  const status = useRouterState({ select: (s) => s.status });
  useEffect(() => {
    if (status === "pending") nprogress.start();
    else nprogress.complete();
  }, [status]);
  return null;
}

// ⌘K command palette wired to the same UI store + theme + navigation.
export function AppSpotlight() {
  const router = useRouter();
  const setView = useUIStore((s) => s.setView);
  const setMediaType = useUIStore((s) => s.setMediaType);
  const { toggleColorScheme } = useMantineColorScheme();

  const actions: SpotlightActionData[] = [
    {
      id: "grid",
      label: "Grid view",
      onClick: () => setView("grid"),
      leftSection: <IconLayoutGrid size={18} />,
    },
    {
      id: "table",
      label: "Table view",
      onClick: () => setView("table"),
      leftSection: <IconTable size={18} />,
    },
    {
      id: "all",
      label: "Show all media",
      onClick: () => setMediaType("all"),
      leftSection: <IconPhoto size={18} />,
    },
    {
      id: "images",
      label: "Filter: Images",
      onClick: () => setMediaType("image"),
      leftSection: <IconPhoto size={18} />,
    },
    {
      id: "videos",
      label: "Filter: Videos",
      onClick: () => setMediaType("video"),
      leftSection: <IconVideo size={18} />,
    },
    {
      id: "theme",
      label: "Toggle light / dark",
      onClick: () => toggleColorScheme(),
      leftSection: <IconMoon size={18} />,
    },
    {
      id: "settings",
      label: "Open Settings",
      onClick: () => router.navigate({ to: "/settings" }),
      leftSection: <IconSettings size={18} />,
    },
  ];

  return (
    <Spotlight
      actions={actions}
      shortcut="mod + K"
      nothingFound="Nothing found"
      searchProps={{ placeholder: "Search actions…" }}
    />
  );
}
