// The library's rows as the connector's tools. A tool is a row carrying `openapi()` meta (its
// tool name, title, description, and the HTTP verb whose read-only and idempotent hints oRPC
// infers) and `mcp.tool()` meta (the hints no verb implies); a row with neither is no tool. The
// rows keep their schemas, so the cell implements this decorated contract while every client
// types against @repo/contract's plain one. Every tool reaches only the person's library, so
// none is open-world but save_link, whose page the cloud reads from the web.

import { getMcpToolMeta, mcp } from "@orpc/mcp";
import type { AnyProcedureContract } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import type { LibraryToolName } from "@repo/contract/library/agent-tools";
import { libraryContract } from "@repo/contract/rpc/library-contract";

const { guide, items, organize, search } = libraryContract;

// a read implies its read-only hint by its verb; it is closed-world
const read = mcp.tool({ annotations: { openWorldHint: false } });

// a write that only adds (a note) destroys nothing; one that changes or removes what is there
// does, and says so
const adds = mcp.tool({ annotations: { destructiveHint: false, openWorldHint: false } });
const changes = mcp.tool({ annotations: { destructiveHint: true, openWorldHint: false } });

export const libraryTools = {
  ...libraryContract,
  // the one tool under no name of the contract's table: the built-in agent's prompt holds this
  // text, so only a connected assistant lists it
  guide: guide.meta(
    openapi({
      description:
        "Answers how this library's notes are written, as markdown: the exact spelling of each block beyond plain markdown (links between items, dates, formulas, callouts, tabs, toggles, columns, charts, canvases and HTML), how an item's text reads, and how items are saved, filed and tagged. A block spelled wrong is kept as literal text with no error, so read this before create_note or edit_item writes one.",
      method: "GET",
      operationId: "read_guide",
      summary: "Read the writing guide",
    }),
    read,
  ),
  items: {
    ...items,
    createNote: items.createNote.meta(
      openapi({
        description:
          "Creates a note from markdown, optionally titled, tagged and filed in a folder. A link to another item is written [Title](mention:id), or [[Title]] for the one item so titled.",
        method: "POST",
        operationId: "create_note" satisfies LibraryToolName,
        summary: "Create a note",
      }),
      adds,
    ),
    delete: items.delete.meta(
      openapi({
        description:
          "Moves items to Deleted, where the person can restore them. The answer names the ids that matched nothing.",
        method: "DELETE",
        operationId: "delete_items" satisfies LibraryToolName,
        summary: "Move items to Deleted",
      }),
      changes,
    ),
    edit: items.edit.meta(
      openapi({
        description:
          "Changes an item's note by exact passages of its markdown, as read_item returned it. Each old text must stand exactly once in the note as it is now, and an empty old text adds its new text after the note; other passages, and anything written there meanwhile, are left as they are. A saved page's article is the page as it was read, and no edit changes it. New text links another item as [Title](mention:id), or [[Title]] for the one item so titled.",
        method: "PATCH",
        operationId: "edit_item" satisfies LibraryToolName,
        summary: "Edit an item",
      }),
      changes,
    ),
    list: items.list.meta(
      openapi({
        description:
          "Lists items by folder, tag, kind or pin, newest saved first unless sorted otherwise, 50 at most per page, with a cursor for the next.",
        method: "GET",
        operationId: "list_items" satisfies LibraryToolName,
        summary: "List items",
      }),
      read,
    ),
    organize: items.organize.meta(
      openapi({
        description:
          "Adds and removes tags, files into a folder (made when its path is new), pins or unpins, and renames, for one or more items in one write.",
        method: "PUT",
        operationId: "organize_items" satisfies LibraryToolName,
        summary: "Organize items",
      }),
      changes,
    ),
    read: items.read.meta(
      openapi({
        description:
          "Reads an item: its fields, a page of its text as markdown from a block position, and the items it links to and from. Links to other items are written [Title](mention:id).",
        method: "GET",
        operationId: "read_item" satisfies LibraryToolName,
        summary: "Read an item",
      }),
      read,
      // a long item still pages, so a read stays well under this; it keeps Claude Code from
      // writing a page to a file before the model sees it
      mcp.tool({ _meta: { "anthropic/maxResultSizeChars": 100_000 } }),
    ),
    saveLink: items.saveLink.meta(
      openapi({
        description:
          "Saves a web address as an item, optionally titled, tagged, filed and with a note; the page is read in the background. A link the library already holds answers that item unchanged; tag or file it with organize_items.",
        method: "PUT",
        operationId: "save_link" satisfies LibraryToolName,
        summary: "Save a link",
      }),
      // the only tool that reaches the web: the cloud reads the page it saves
      mcp.tool({ annotations: { destructiveHint: false, openWorldHint: true } }),
    ),
  },
  organize: {
    ...organize,
    outline: organize.outline.meta(
      openapi({
        description: "Lists the folder tree and every tag, each with how many items it holds.",
        method: "GET",
        operationId: "list_tags_and_folders" satisfies LibraryToolName,
        summary: "List tags and folders",
      }),
      read,
    ),
  },
  search: search.meta(
    openapi({
      description:
        "Searches item titles, notes and saved articles, with optional kind, tag, folder and saved-date filters, best matches first, with a cursor for the next page.",
      method: "GET",
      operationId: "search_library" satisfies LibraryToolName,
      summary: "Search the library",
    }),
    read,
  ),
};

// which rows a registrar exposes: those carrying tool meta, so a row added unannotated is no tool
export const isLibraryTool = (contract: AnyProcedureContract): boolean =>
  getMcpToolMeta(contract) !== undefined;
