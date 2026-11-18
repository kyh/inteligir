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

export const isLibraryToolName = (name: string): name is LibraryToolName =>
  Object.hasOwn(LIBRARY_TOOLS, name);

const WEB_TOOLS = ["web_search", "web_fetch"] as const;

export type WebToolName = (typeof WEB_TOOLS)[number];

export const isWebToolName = (name: string): name is WebToolName =>
  WEB_TOOLS.some((tool) => tool === name);
