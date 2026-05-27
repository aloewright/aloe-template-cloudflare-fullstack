import { NavLink, Stack } from "@mantine/core";
import { Link, useRouterState } from "@tanstack/react-router";
import { pages } from "@/pages";

export function Sidebar() {
  const { location } = useRouterState();

  return (
    <Stack gap={2}>
      {pages.map((p) => (
        <NavLink
          key={p.path}
          component={Link}
          to={p.path}
          label={p.title}
          active={location.pathname === p.path}
          variant="light"
        />
      ))}
    </Stack>
  );
}
