/* AGPL-3.0-or-later */
import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "@/features/Settings";

export const Route = createFileRoute("/settings")({ component: Settings });
