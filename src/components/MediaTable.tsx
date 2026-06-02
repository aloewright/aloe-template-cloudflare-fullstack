/* AGPL-3.0-or-later */
import { Badge, Center, Checkbox, Group, Image, Table, Text, UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowsSort, IconArrowUp, IconMusic } from "@tabler/icons-react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useState } from "react";
import type { MediaItem } from "@/lib/media";
import { useUIStore } from "@/lib/store";

function fmtDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
}

const columns: ColumnDef<MediaItem>[] = [
  {
    id: "select",
    size: 44,
    enableSorting: false,
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        onClick={(e) => e.stopPropagation()}
      />
    ),
  },
  {
    id: "thumb",
    size: 56,
    enableSorting: false,
    header: () => null,
    cell: ({ row }) =>
      row.original.kind === "audio" ? (
        <Center w={40} h={40}>
          <IconMusic size={20} opacity={0.6} />
        </Center>
      ) : row.original.thumbnailUrl ? (
        <Image
          src={row.original.thumbnailUrl}
          alt={row.original.name}
          w={40}
          h={40}
          radius="sm"
          fit="cover"
          loading="lazy"
        />
      ) : null,
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <Text size="sm" lineClamp={1} title={row.original.name}>
        {row.original.name}
      </Text>
    ),
  },
  {
    accessorKey: "kind",
    header: "Type",
    size: 90,
    cell: ({ row }) => (
      <Badge
        variant="light"
        color={
          row.original.kind === "video" ? "grape" : row.original.kind === "audio" ? "teal" : "blue"
        }
      >
        {row.original.kind}
      </Badge>
    ),
  },
  {
    id: "date",
    accessorKey: "createdAt",
    header: "Date",
    size: 120,
    cell: ({ row }) => (
      <Text size="sm" c="dimmed">
        {fmtDate(row.original.createdAt)}
      </Text>
    ),
  },
  {
    id: "duration",
    accessorFn: (r) => r.duration ?? -1,
    header: "Duration",
    size: 100,
    cell: ({ row }) => (
      <Text size="sm" c="dimmed">
        {fmtDuration(row.original.duration)}
      </Text>
    ),
  },
  {
    id: "access",
    header: "Access",
    size: 90,
    enableSorting: false,
    cell: ({ row }) =>
      row.original.requireSignedURLs ? (
        <Badge color="orange" variant="light">
          signed
        </Badge>
      ) : (
        <Badge color="gray" variant="light">
          public
        </Badge>
      ),
  },
];

export function MediaTable({
  items,
  onOpen,
}: {
  items: MediaItem[];
  onOpen: (item: MediaItem) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const rowSelection = useUIStore((s) => s.selectedIds);
  const setRowSelection = useUIStore((s) => s.setSelectedIds);

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: (updater) =>
      setRowSelection(typeof updater === "function" ? updater(rowSelection) : updater),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    getRowId: (r) => `${r.kind}-${r.id}`,
  });

  const rows = table.getRowModel().rows;
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 53,
    overscan: 12,
  });
  const vItems = virtualizer.getVirtualItems();
  const paddingTop = vItems.length > 0 ? (vItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    vItems.length > 0 ? virtualizer.getTotalSize() - (vItems[vItems.length - 1]?.end ?? 0) : 0;

  return (
    <div ref={parentRef} style={{ height: "calc(100vh - 210px)", overflow: "auto" }}>
      <Table highlightOnHover stickyHeader verticalSpacing="xs" style={{ tableLayout: "fixed" }}>
        <Table.Thead>
          {table.getHeaderGroups().map((hg) => (
            <Table.Tr key={hg.id}>
              {hg.headers.map((h) => {
                const sorted = h.column.getIsSorted();
                return (
                  <Table.Th key={h.id} style={{ width: h.getSize() }}>
                    {h.isPlaceholder ? null : h.column.getCanSort() ? (
                      <UnstyledButton
                        onClick={h.column.getToggleSortingHandler()}
                        style={{ font: "inherit" }}
                      >
                        <Group gap={4} wrap="nowrap">
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sorted === "asc" ? (
                            <IconArrowUp size={14} />
                          ) : sorted === "desc" ? (
                            <IconArrowDown size={14} />
                          ) : (
                            <IconArrowsSort size={14} opacity={0.4} />
                          )}
                        </Group>
                      </UnstyledButton>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </Table.Th>
                );
              })}
            </Table.Tr>
          ))}
        </Table.Thead>
        <Table.Tbody>
          {paddingTop > 0 && (
            <Table.Tr>
              <Table.Td
                colSpan={columns.length}
                style={{ height: paddingTop, padding: 0, border: 0 }}
              />
            </Table.Tr>
          )}
          {vItems.map((vi) => {
            const row = rows[vi.index];
            if (!row) return null;
            return (
              <Table.Tr
                key={row.id}
                onClick={() => onOpen(row.original)}
                style={{ cursor: "pointer" }}
              >
                {row.getVisibleCells().map((cell) => (
                  <Table.Td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </Table.Td>
                ))}
              </Table.Tr>
            );
          })}
          {paddingBottom > 0 && (
            <Table.Tr>
              <Table.Td
                colSpan={columns.length}
                style={{ height: paddingBottom, padding: 0, border: 0 }}
              />
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </div>
  );
}
