import { Anchor, Code, List, Table, Text, Title } from "@mantine/core";
import type { MDXComponents } from "mdx/types";

export const mdxComponents: MDXComponents = {
  h1: (props) => <Title order={1} mb="lg" {...props} />,
  h2: (props) => <Title order={2} mt="xl" mb="md" {...props} />,
  h3: (props) => <Title order={3} mt="lg" mb="sm" {...props} />,
  p: (props) => <Text component="p" mb="md" {...props} />,
  a: (props) => <Anchor target={props.href?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" {...props} />,
  ul: (props) => <List withPadding mb="md" {...props} />,
  ol: (props) => <List type="ordered" withPadding mb="md" {...props} />,
  li: (props) => <List.Item {...props} />,
  // `code` here is INLINE code only — Shiki wraps block code in <pre><code> which bypasses these mappings.
  code: (props) => <Code {...props} />,
  table: (props) => <Table mb="md" striped withTableBorder {...props} />,
  thead: (props) => <Table.Thead {...props} />,
  tbody: (props) => <Table.Tbody {...props} />,
  tr: (props) => <Table.Tr {...props} />,
  th: (props) => <Table.Th {...props} />,
  td: (props) => <Table.Td {...props} />,
};
