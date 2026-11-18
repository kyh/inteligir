// The built-in agent's tools by the one name each goes by. A library tool's: the connector lists a
// row under it, the built-in agent calls it by it, a thread's events carry it, and each device
// words it. `reads` says a tool only reads the library. A plain table: which row a name tags, and
// how, is the service's (packages/service/src/library/library-tools.ts), so no client bundles MCP.

export const LIBRARY_TOOLS = {
  create_note: { reads: false },
  delete_items: { reads: false },
  edit_item: { reads: false },
  list_items: { reads: true },
  list_tags_and_folders: { reads: true },
  organize_items: { reads: false },
  read_item: { reads: true },
  save_link: { reads: false },
  search_library: { reads: true },
} as const;

export type LibraryToolName = keyof typeof LIBRARY_TOOLS;

// false for a name a newer cloud's event carries
export const isLibraryToolName = (name: string): name is LibraryToolName =>
  Object.hasOwn(LIBRARY_TOOLS, name);

// the built-in agent's own reach beyond the library, by its tools' file names
// (apps/web/agent/tools): its model's web search and a public page's fetch, neither touching an item
const WEB_TOOLS = ["web_search", "web_fetch"] as const;

export type WebToolName = (typeof WEB_TOOLS)[number];

export const isWebToolName = (name: string): name is WebToolName =>
  WEB_TOOLS.some((tool) => tool === name);
