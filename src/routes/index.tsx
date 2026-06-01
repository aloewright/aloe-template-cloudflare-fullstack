/* AGPL-3.0-or-later */
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { Gallery } from "@/features/Gallery";
import { getSettings } from "@/lib/cf-api";

function IndexRoute() {
  const router = useRouter();
  const { data, isLoading } = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  useEffect(() => {
    if (data && !data.connected) router.navigate({ to: "/settings" });
  }, [data, router]);

  if (isLoading || !data || !data.connected) return null;
  return <Gallery />;
}

export const Route = createFileRoute("/")({ component: IndexRoute });
