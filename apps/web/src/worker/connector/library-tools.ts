// The library's rows as the connector's tools. A tool is a row carrying `openapi()` meta (its
// tool name, title, description, and the HTTP verb whose read-only and idempotent hints oRPC
// infers) and `mcp.tool()` meta (the hints no verb implies); a row with neither is no tool. The
// rows keep their schemas, so the cell implements this decorated contract while every client
// types against @repo/contract's plain one. Every tool reaches only the person's library, so
// none is open-world but save_link, whose page the cloud reads from the web.

import { getMcpToolMeta, mcp } from "@orpc/mcp";
import type { AnyProcedureContract } from "@orpc/contract";
import { openapi } from "@orpc/openapi";

import { libraryContract } from "@repo/contract/cloud/library/library-contract";

const { annotations, history, items, organize, search } = libraryContract;

// a read implies its read-only hint by its verb; it is closed-world, as every library tool is
const read = mcp.tool({ annotations: { openWorldHint: false } });

// a write that only adds (a note, a highlight) destroys nothing; one that changes or removes what
// is there does, and says so
const adds = mcp.tool({ annotations: { destructiveHint: false, openWorldHint: false } });
const changes = mcp.tool({ annotations: { destructiveHint: true, openWorldHint: false } });

export const libraryTools = {
  ...libraryContract,
  annotations: {
    ...annotations,
    add: annotations.add.meta(
      openapi({
        description:
          "Highlights a passage of an item, found by its exact text, with an optional note. A passage the item's text does not hold is kept as an unplaced highlight.",
        method: "POST",
        operationId: "add_highlight",
        summary: "Add a highlight",
      }),
      adds,
    ),
    list: annotations.list.meta(
      openapi({
        description:
          "Lists highlights and their notes, for one item or across the library since a date, newest first, with a cursor for the next page.",
        method: "GET",
        operationId: "list_highlights",
        summary: "List highlights",
      }),
      read,
    ),
  },
  history: {
    ...history,
    list: history.list.meta(
      openapi({
        description:
          "Lists the change sets that touched one item, or the library's most recent ones: who made each, when, and what it changed.",
        method: "GET",
        operationId: "item_history",
        summary: "Show history",
      }),
      read,
    ),
    undo: history.undo.meta(
      openapi({
        description:
          "Undoes change sets, newest first, in a change set of its own. An item edited since in the same places is kept as it is, and the answer names it.",
        method: "POST",
        operationId: "undo_change",
        summary: "Undo a change",
      }),
      changes,
    ),
  },
  items: {
    ...items,
    createNote: items.createNote.meta(
      openapi({
        description:
          "Creates a note from markdown, optionally titled, tagged and filed in a folder. Links to other items are written [[Title]] or [[Title|id]].",
        method: "POST",
        operationId: "create_note",
        summary: "Create a note",
      }),
      adds,
    ),
    delete: items.delete.meta(
      openapi({
        description:
          "Moves items to Deleted, where the person can restore them. The answer names the ids that matched nothing.",
        method: "DELETE",
        operationId: "delete_items",
        summary: "Move items to Deleted",
      }),
      changes,
    ),
    edit: items.edit.meta(
      openapi({
        description:
          "Replaces exact passages of an item's markdown, as read_item returned it at the sequence named as the base. Each old text must stand exactly once; other passages, their highlights included, are left as they are.",
        method: "PATCH",
        operationId: "edit_item",
        summary: "Edit an item",
      }),
      changes,
    ),
    list: items.list.meta(
      openapi({
        description:
          "Lists items by folder, tag, kind or pin, newest saved first unless sorted otherwise, 50 at most per page, with a cursor for the next.",
        method: "GET",
        operationId: "list_items",
        summary: "List items",
      }),
      read,
    ),
    organize: items.organize.meta(
      openapi({
        description:
          "Adds and removes tags, files into a folder (made when its path is new), pins or unpins, and renames, for one or more items in one change set.",
        method: "PUT",
        operationId: "organize_items",
        summary: "Organize items",
      }),
      changes,
    ),
    read: items.read.meta(
      openapi({
        description:
          "Reads an item: its fields, a page of its text as markdown from a block position, the items it links to and from, and how many highlights it has. Links to other items are written [[Title|id]].",
        method: "GET",
        operationId: "read_item",
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
          "Saves a web address as an item, optionally titled, tagged, filed and with a note. A link the library already holds keeps its item, which gains the tags; the page is read in the background.",
        method: "PUT",
        operationId: "save_link",
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
        operationId: "list_tags_and_folders",
        summary: "List tags and folders",
      }),
      read,
    ),
  },
  search: search.meta(
    openapi({
      description:
        "Searches item titles, notes, saved articles and highlights, with optional kind, tag, folder and saved-date filters, best matches first, with a cursor for the next page.",
      method: "GET",
      operationId: "search_library",
      summary: "Search the library",
    }),
    read,
  ),
};

// which rows a registrar exposes: those carrying tool meta, so a row added unannotated is no tool
export const isLibraryTool = (contract: AnyProcedureContract): boolean =>
  getMcpToolMeta(contract) !== undefined;
