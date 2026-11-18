// The library's rows as tools: a row tagged `mcp.tool()` carries its tool name, title,
// description and every hint, and a row without the tag is no tool. The built-in agent and the
// connector both list the rows tagged here, so a tool is added by tagging its row, never by a
// list kept beside it. The rows keep their schemas, so the library implements this decorated
// contract (`./library-access`) while every client types against @repo/contract's plain one.
// Every tool reaches only the person's library, so none is open-world but save_link, whose page
// the cloud reads from the web.

import type { LibraryToolName } from "@repo/contract/library/agent-tools";
import { libraryContract } from "@repo/contract/rpc/library-contract";
import { getMcpToolMeta, mcp } from "@orpc/mcp";
import type { McpToolMeta } from "@orpc/mcp";
import { walkProcedureContractsSync } from "@orpc/server";

const { guide, items, organize, search } = libraryContract;

// MCP's defaults (destructive, open-world) are wrong for most tools, so every hint is stated
const READ = { openWorldHint: false, readOnlyHint: true } as const;
const ADDS = { destructiveHint: false, openWorldHint: false } as const;
const CHANGES = { destructiveHint: true, openWorldHint: false } as const;

type ToolTag = McpToolMeta & { readonly name: LibraryToolName };

const tagTool = ({ annotations, ...meta }: ToolTag) =>
  mcp.tool({ ...meta, annotations: { ...annotations, title: meta.title } });

export const libraryTools = {
  ...libraryContract,
  // the one tool under no name of the contract's table: the built-in agent's prompt holds this
  // text, so only a connected assistant lists it
  guide: guide.meta(
    mcp.tool({
      annotations: { ...READ, title: "Read the writing guide" },
      description:
        "Answers how this library's notes are written, as markdown: the exact spelling of each block beyond plain markdown (links between items, dates, formulas, callouts, tabs, toggles, columns, charts, canvases and HTML), how an item's text reads, and how items are saved, filed and tagged. A block spelled wrong is kept as literal text with no error, so read this before create_note or edit_item writes one.",
      name: "read_guide",
      title: "Read the writing guide",
    }),
  ),
  items: {
    ...items,
    createNote: items.createNote.meta(
      tagTool({
        annotations: ADDS,
        description:
          "Creates a note from markdown, optionally titled, tagged and filed in a folder. A link to another item is written [Title](mention:id), or [[Title]] for the one item so titled.",
        name: "create_note",
        title: "Create a note",
      }),
    ),
    delete: items.delete.meta(
      tagTool({
        annotations: { ...CHANGES, idempotentHint: true },
        description:
          "Moves items to Deleted, where the person can restore them. The answer names the ids that matched nothing.",
        name: "delete_items",
        title: "Move items to Deleted",
      }),
    ),
    edit: items.edit.meta(
      tagTool({
        annotations: CHANGES,
        description:
          "Changes an item's note by exact passages of its markdown, as read_item returned it. Each old text must stand exactly once in the note as it is now, and an empty old text adds its new text after the note; other passages, and anything written there meanwhile, are left as they are. A saved page's article is the page as it was read, and no edit changes it. New text links another item as [Title](mention:id), or [[Title]] for the one item so titled.",
        name: "edit_item",
        title: "Edit an item",
      }),
    ),
    list: items.list.meta(
      tagTool({
        annotations: READ,
        description:
          "Lists items by folder, tag, kind or pin, newest saved first unless sorted otherwise, 50 at most per page, with a cursor for the next. An item's tags include each #tag written in its text, which organize_items cannot remove: only edit_item takes one out of the text.",
        name: "list_items",
        title: "List items",
      }),
    ),
    organize: items.organize.meta(
      tagTool({
        annotations: { ...CHANGES, idempotentHint: true },
        description:
          "Adds and removes tags, files into a folder (made when its path is new), pins or unpins, and renames, for one or more items in one write. A #tag written in an item's text, which its answer and list_items name among the item's tags, stays after a remove: only edit_item takes one out of the text.",
        name: "organize_items",
        title: "Organize items",
      }),
    ),
    read: items.read.meta(
      tagTool({
        // a long item still pages, so a read stays well under this; it keeps Claude Code from
        // writing a page to a file before the model sees it
        _meta: { "anthropic/maxResultSizeChars": 100_000 },
        annotations: READ,
        description:
          "Reads an item: its fields, a page of its text as markdown from a block position, and the items it links to and from. Links to other items are written [Title](mention:id). Its tags are those organize_items adds and removes; a #tag written in its text, which list_items also names among an item's tags, changes only by edit_item.",
        name: "read_item",
        title: "Read an item",
      }),
    ),
    saveLink: items.saveLink.meta(
      tagTool({
        // the only tool that reaches the web: the cloud reads the page it saves
        annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
        description:
          "Saves a web address as an item, optionally titled, tagged, filed and with a note; the page is read in the background. A link the library already holds answers that item unchanged; tag or file it with organize_items.",
        name: "save_link",
        title: "Save a link",
      }),
    ),
  },
  organize: {
    ...organize,
    outline: organize.outline.meta(
      tagTool({
        annotations: READ,
        description: "Lists the folder tree and every tag, each with how many items it holds.",
        name: "list_tags_and_folders",
        title: "List tags and folders",
      }),
    ),
  },
  search: search.meta(
    tagTool({
      annotations: READ,
      description:
        "Searches item titles, notes and saved articles, with optional kind, tag, folder and saved-date filters, best matches first, with a cursor for the next page.",
      name: "search_library",
      title: "Search the library",
    }),
  ),
};

export interface TaggedRow {
  readonly path: readonly string[];
  readonly tool: McpToolMeta;
}

// every row tagged a tool, in the contract's order
export const TAGGED_ROWS: readonly TaggedRow[] = (() => {
  const rows: TaggedRow[] = [];
  walkProcedureContractsSync(libraryTools, (contract, path) => {
    const tool = getMcpToolMeta(contract);
    if (tool !== undefined) {
      rows.push({ path, tool });
    }
  });
  return rows;
})();
