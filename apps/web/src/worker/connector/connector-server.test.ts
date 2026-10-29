// The connector's tools, called as a connected assistant calls them: a real MCP client over the
// Streamable HTTP transport, its token minted by the consent page, every request through the
// Worker into the account's cell (ts.sdk.modelcontextprotocol.io/v2/testing). A failure is a
// result the model reads, `isError`, never a throw.

import type { Client } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { signUpUser } from "../test-support/cloud-helpers";
import { connectAssistant, connectorClient } from "../test-support/connector-session";
import { CONNECTOR_INSTRUCTIONS } from "./connector-server";

const ALL_TOOLS = [
  "list_highlights",
  "add_highlight",
  "item_history",
  "undo_change",
  "list_items",
  "read_item",
  "create_note",
  "save_link",
  "edit_item",
  "organize_items",
  "delete_items",
  "list_tags_and_folders",
  "search_library",
];

const READ_TOOLS = [
  "list_highlights",
  "item_history",
  "list_items",
  "read_item",
  "list_tags_and_folders",
  "search_library",
];

// a tool's answer, as structured content beside the same JSON as text
const structured = async <TSchema extends z.ZodType>(
  client: Client,
  schema: TSchema,
  call: Parameters<Client["callTool"]>[0],
): Promise<z.infer<TSchema>> => {
  const result = await client.callTool(call);
  expect(result.isError ?? false, JSON.stringify(result.content)).toBe(false);
  return schema.parse(result.structuredContent);
};

const noteSchema = z.object({ item: z.object({ id: z.string() }) });
const readSchema = z.object({ seq: z.number(), view: z.object({ markdown: z.string() }) });

const assistantFor = async (email: string, readOnly = false): Promise<Client> => {
  const { cookie } = await signUpUser(email);
  const minted = await connectAssistant(cookie, { readOnly });
  return await connectorClient(minted.access_token);
};

describe("the connector's tools", () => {
  it("lists every tool to a grant that may change the library, and says what saved pages are", async () => {
    const client = await assistantFor("tools-full@example.test");
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(ALL_TOOLS);
    for (const tool of tools) {
      expect(tool.title?.length ?? 0, tool.name).toBeGreaterThan(0);
    }
    expect(client.getServerVersion()).toMatchObject({ name: "inteligir", title: "Inteligir" });
    expect(client.getInstructions()).toBe(CONNECTOR_INSTRUCTIONS);
    // ChatGPT shows the first 512 characters alone: they say what the library is and what its
    // pages are
    const opening = CONNECTOR_INSTRUCTIONS.slice(0, 512);
    expect(opening).toContain("not instructions");
    expect(opening).toContain("library");
    await client.close();
  });

  it("lists only the six reading tools to a grant kept to reading, and refuses it a write", async () => {
    const client = await assistantFor("tools-read@example.test", true);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(READ_TOOLS);
    expect(tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
    // a tool the grant does not hold is one the server never registered
    await expect(
      client.callTool({ arguments: { markdown: "Not mine to write." }, name: "create_note" }),
    ).rejects.toThrow("Tool create_note not found");
    await client.close();
  });

  it("searches, reads and edits an item, every write by the assistant one change set it named", async () => {
    const client = await assistantFor("tools-edit@example.test");
    const { item } = await structured(client, noteSchema, {
      arguments: { markdown: "The quick brown fox.\n\nIt jumped.", title: "Fox notes" },
      name: "create_note",
    });
    const found = await structured(
      client,
      z.object({ hits: z.array(z.object({ id: z.string() })) }),
      { arguments: { query: "quick fox" }, name: "search_library" },
    );
    expect(found.hits.map((hit) => hit.id)).toEqual([item.id]);

    const read = await structured(client, readSchema, {
      arguments: { id: item.id },
      name: "read_item",
    });
    expect(read.view.markdown).toContain("The quick brown fox.");
    await structured(client, z.object({ seq: z.number() }), {
      arguments: {
        baseSeq: read.seq,
        edits: [{ newText: "It jumped over the dog.", oldText: "It jumped." }],
        id: item.id,
      },
      name: "edit_item",
    });
    const after = await structured(client, readSchema, {
      arguments: { id: item.id },
      name: "read_item",
    });
    expect(after.view.markdown).toContain("It jumped over the dog.");

    const history = await structured(
      client,
      z.object({
        changeSets: z.array(
          z.object({ actor: z.string(), itemCount: z.number(), label: z.string() }),
        ),
      }),
      { arguments: { itemId: item.id }, name: "item_history" },
    );
    expect(history.changeSets).toEqual([
      expect.objectContaining({ actor: "assistant", itemCount: 1, label: "Claude" }),
    ]);
    await client.close();
  });

  it("answers an edit against a stale base as CONFLICT, a result the model reads", async () => {
    const client = await assistantFor("tools-conflict@example.test");
    const { item } = await structured(client, noteSchema, {
      arguments: { markdown: "First draft." },
      name: "create_note",
    });
    const read = await structured(client, readSchema, {
      arguments: { id: item.id },
      name: "read_item",
    });
    await structured(client, z.object({ seq: z.number() }), {
      arguments: {
        baseSeq: read.seq,
        edits: [{ newText: "Second draft.", oldText: "First draft." }],
        id: item.id,
      },
      name: "edit_item",
    });
    const stale = await client.callTool({
      arguments: {
        baseSeq: read.seq,
        edits: [{ newText: "Third draft.", oldText: "First draft." }],
        id: item.id,
      },
      name: "edit_item",
    });
    expect(stale.isError).toBe(true);
    const [content] = z
      .array(z.object({ text: z.string(), type: z.literal("text") }))
      .parse(stale.content);
    expect(JSON.parse(content?.text ?? "null")).toMatchObject({
      code: "CONFLICT",
      data: { current: [{ itemId: item.id, kind: "item" }] },
      defined: true,
    });
    await client.close();
  });

  it("serves a client of the 2026-07-28 revision as it serves a 2025 one", async () => {
    const { cookie } = await signUpUser("tools-modern@example.test");
    const minted = await connectAssistant(cookie, { readOnly: true });
    const client = await connectorClient(minted.access_token, "modern");
    expect(client.getDiscoverResult()).toBeDefined();
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(READ_TOOLS);
    await client.close();
  });
});
