import { McpRegistrar } from "@orpc/mcp";
import { implement, ORPCError } from "@orpc/server";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isLibraryTool, libraryTools } from "./library-tools";

// the tools exactly as a client lists them, in the contract's own order: name, title and the
// hints it reads before calling
const TOOLS = [
  ["list_highlights", "List highlights", { openWorldHint: false, readOnlyHint: true }],
  ["add_highlight", "Add a highlight", { destructiveHint: false, openWorldHint: false }],
  ["item_history", "Show history", { openWorldHint: false, readOnlyHint: true }],
  ["undo_change", "Undo a change", { destructiveHint: true, openWorldHint: false }],
  ["list_items", "List items", { openWorldHint: false, readOnlyHint: true }],
  ["read_item", "Read an item", { openWorldHint: false, readOnlyHint: true }],
  ["create_note", "Create a note", { destructiveHint: false, openWorldHint: false }],
  [
    "save_link",
    "Save a link",
    { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  ],
  ["edit_item", "Edit an item", { destructiveHint: true, openWorldHint: false }],
  [
    "organize_items",
    "Organize items",
    { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  ],
  [
    "delete_items",
    "Move items to Deleted",
    { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  ],
  ["list_tags_and_folders", "List tags and folders", { openWorldHint: false, readOnlyHint: true }],
  ["search_library", "Search the library", { openWorldHint: false, readOnlyHint: true }],
] as const;

// a read says it changes nothing, a write whether it changes what is there, and each whether it
// reaches past the library: MCP's defaults (destructive, open-world) are wrong for most tools
const EXPLICIT_HINTS = z.union([
  z.object({ openWorldHint: z.boolean(), readOnlyHint: z.literal(true) }),
  z.object({ destructiveHint: z.boolean(), openWorldHint: z.boolean() }),
]);

// Claude Code cuts a description loaded up front at this many characters
const DESCRIPTION_MAX = 4096;

const unimplemented = (): never => {
  throw new ORPCError("NOT_IMPLEMENTED");
};

// every row answered by nothing: what registering reads is the rows' meta and schemas alone
const os = implement(libraryTools);
const router = os.router({
  agent: {
    cancel: os.agent.cancel.handler(unimplemented),
    delete: os.agent.delete.handler(unimplemented),
    events: os.agent.events.handler(unimplemented),
    list: os.agent.list.handler(unimplemented),
    respond: os.agent.respond.handler(unimplemented),
    send: os.agent.send.handler(unimplemented),
    setEnabled: os.agent.setEnabled.handler(unimplemented),
    status: os.agent.status.handler(unimplemented),
  },
  annotations: {
    add: os.annotations.add.handler(unimplemented),
    list: os.annotations.list.handler(unimplemented),
  },
  folders: { write: os.folders.write.handler(unimplemented) },
  history: {
    list: os.history.list.handler(unimplemented),
    revision: os.history.revision.handler(unimplemented),
    undo: os.history.undo.handler(unimplemented),
  },
  items: {
    create: os.items.create.handler(unimplemented),
    createFile: os.items.createFile.handler(unimplemented),
    createNote: os.items.createNote.handler(unimplemented),
    delete: os.items.delete.handler(unimplemented),
    edit: os.items.edit.handler(unimplemented),
    list: os.items.list.handler(unimplemented),
    organize: os.items.organize.handler(unimplemented),
    purge: os.items.purge.handler(unimplemented),
    read: os.items.read.handler(unimplemented),
    refresh: os.items.refresh.handler(unimplemented),
    restore: os.items.restore.handler(unimplemented),
    save: os.items.save.handler(unimplemented),
    saveLink: os.items.saveLink.handler(unimplemented),
  },
  organize: { outline: os.organize.outline.handler(unimplemented) },
  search: os.search.handler(unimplemented),
  sync: {
    bodies: os.sync.bodies.handler(unimplemented),
    pull: os.sync.pull.handler(unimplemented),
  },
  write: os.write.handler(unimplemented),
});

const registered = async () => {
  const registrar = new McpRegistrar(router, { filter: isLibraryTool });
  const { tools } = await registrar.register(new McpServer({ name: "inteligir", version: "0" }));
  return tools;
};

describe("the library's tools", () => {
  it("are the thirteen tagged rows, in the router's order, titled and hinted", async () => {
    const tools = await registered();
    expect(
      Object.entries(tools).map(([name, tool]) => [name, tool.title, tool.annotations]),
    ).toEqual(TOOLS);
  });

  it("each carry a short name, a title, a description and an explicit read-only or destructive hint", async () => {
    for (const [name, tool] of Object.entries(await registered())) {
      expect(name).toMatch(/^[a-z_]{1,64}$/u);
      expect(tool.title?.length ?? 0).toBeGreaterThan(0);
      expect(tool.description?.length ?? 0).toBeGreaterThan(0);
      expect(tool.description?.length ?? 0).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(EXPLICIT_HINTS.validate(tool.annotations), name).toBe(true);
    }
  });

  it("lets a long item's read stay whole in Claude Code", async () => {
    const tools = await registered();
    expect(tools["read_item"]?._meta).toEqual({ "anthropic/maxResultSizeChars": 100_000 });
  });

  it("advertises each tool's input and output as JSON Schema objects", async () => {
    for (const [name, tool] of Object.entries(await registered())) {
      expect(
        tool.inputSchema?.["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
        name,
      ).toMatchObject({ type: "object" });
      expect(
        tool.outputSchema?.["~standard"].jsonSchema.output({ target: "draft-2020-12" }),
        name,
      ).toMatchObject({ type: "object" });
    }
  });
});
