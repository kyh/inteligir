// The built-in agent's tools: the library's own procedures, the same rows the connector lists but
// the person's Undo, each defined as the Messages API takes it and run by the cell as the agent's.
// The definitions are every new thread's cached prefix, so their JSON is a committed snapshot and
// a change to it shows in review; every answer fits the 40,000 characters a result is replayed
// at, however full the library.

import { McpServer } from "@modelcontextprotocol/server";
import { McpRegistrar } from "@orpc/mcp";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isLibraryTool } from "../connector/library-tools";
import { FILL_ACTOR } from "../library/cell-fills";
import { openCellLibrary } from "../library/cell-library";
import { principalFromHeader } from "../library/library-principal";
import { libraryRouter } from "../library/library-router";
import {
  agentCellIn,
  cellOf,
  createItem,
  inCell,
  landedValue,
  noteFields,
  paragraph,
  person,
  placed,
} from "../test-support/library-cell";
import {
  AGENT_RESULT_MAX_CHARS,
  AGENT_TOOL_DEFINITIONS,
  agentOpId,
  asksFirst,
  runAgentTool,
} from "./agent-tools";
import { AGENT_TOOL_POLICIES } from "./library-agent";

// the tools the connector's full registrar lists over the cell's router
const registered = async (): Promise<string[]> =>
  await inCell(cellOf(), async (state) => {
    const library = openCellLibrary(state, env);
    const agent = agentCellIn(state, library);
    const registrar = new McpRegistrar(libraryRouter, { filter: isLibraryTool });
    const { tools } = await registrar.register(new McpServer({ name: "inteligir", version: "0" }), {
      context: { actor: () => person(), agent, library, settle: agent.settle },
    });
    return Object.keys(tools);
  });

const words = (count: number, seed: string): string =>
  Array.from({ length: count }, (_, index) => `${seed}${String(index)}`).join(" ");

describe("the built-in agent's tools", () => {
  it("are the connector's tools but undo_change, each by its name, deleting and reaching the web on the person's word", async () => {
    const listed = await registered();
    const names = AGENT_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toStrictEqual(listed.filter((name) => name !== "undo_change").toSorted());
    expect(Object.keys(AGENT_TOOL_POLICIES).toSorted()).toStrictEqual(names);
    expect(names.filter(asksFirst)).toStrictEqual(["delete_items", "save_link"]);
  });

  it("are defined as the committed snapshot holds them, with no op id the agent could write", async () => {
    for (const tool of AGENT_TOOL_DEFINITIONS) {
      expect(JSON.stringify(tool.input_schema), tool.name).not.toContain('"opId"');
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(0);
    }
    await expect(`${JSON.stringify(AGENT_TOOL_DEFINITIONS, null, 2)}\n`).toMatchFileSnapshot(
      "./__snapshots__/agent-tools.json",
    );
  });

  it("mints one op id a call, the same however often it runs", async () => {
    const once = await agentOpId("thread-1", "toolu_1");
    expect(once).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    await expect(agentOpId("thread-1", "toolu_1")).resolves.toBe(once);
    await expect(agentOpId("thread-1", "toolu_2")).resolves.not.toBe(once);
    await expect(agentOpId("thread-2", "toolu_1")).resolves.not.toBe(once);
  });

  // sixty items of long titles and a note of four hundred long paragraphs, past one page's budget
  // on purpose
  it(
    "answer under 40,000 characters across their page sizes, however full the library",
    { timeout: 60_000 },
    async () => {
      await inCell(cellOf(), async (state) => {
        const library = openCellLibrary(state, env);
        for (let index = 0; index < 60; index += 1) {
          landedValue(
            createItem(library, FILL_ACTOR, {
              blocks: placed([paragraph("a", words(80, `body${String(index)}x`))]),
              fields: noteFields({
                description: words(60, "about"),
                tags: ["travel", `tag-${String(index % 7)}`],
                title: `Paris ${words(45, "title")} ${String(index)}`,
              }),
              id: crypto.randomUUID(),
            }),
          );
        }
        const longId = crypto.randomUUID();
        landedValue(
          createItem(library, FILL_ACTOR, {
            blocks: placed(
              Array.from({ length: 400 }, (_, index) =>
                paragraph(`p${String(index)}`, words(60, `line${String(index)}x`)),
              ),
            ),
            fields: noteFields({ title: "The long one" }),
            id: longId,
          }),
        );
        const agent = agentCellIn(state, library);
        const context = { actor: () => person(), agent, library, settle: agent.settle };
        const run = async (name: string, input: Readonly<Record<string, string | number>>) =>
          await runAgentTool(libraryRouter, context, {
            input,
            name,
            threadId: "thread-1",
            toolUseId: crypto.randomUUID(),
          });
        const calls: readonly (readonly [string, Readonly<Record<string, string | number>>])[] = [
          ["search_library", { limit: 50, query: "Paris", responseFormat: "detailed" }],
          ["search_library", { limit: 50, query: "Paris" }],
          ["list_items", { limit: 50, responseFormat: "detailed" }],
          ["list_items", { limit: 50 }],
          ["list_items", { limit: 5 }],
          ["read_item", { count: 500, id: longId, responseFormat: "detailed" }],
          ["read_item", { from: 200, id: longId }],
          ["list_highlights", { limit: 50 }],
          ["item_history", { limit: 50 }],
          ["list_tags_and_folders", {}],
          ["create_note", { markdown: words(2000, "note") }],
        ];
        for (const [name, input] of calls) {
          const result = await run(name, input);
          expect(result.content.length, name).toBeLessThan(AGENT_RESULT_MAX_CHARS);
          expect(result.isError, `${name}: ${result.content.slice(0, 200)}`).toBe(false);
        }
        // a page that would pass the budget answers what fits, with the cursor for the rest
        const fitted = await run("search_library", {
          limit: 50,
          query: "Paris",
          responseFormat: "detailed",
        });
        const page = z
          .object({ cursor: z.string().nullable(), hits: z.array(z.unknown()) })
          .parse(JSON.parse(fitted.content));
        expect(page.hits.length).toBeLessThan(50);
        expect(page.cursor).toBe(String(page.hits.length));
      });
    },
  );

  it("answer a call they cannot run as an error the agent reads, never a failed turn", async () => {
    await inCell(cellOf(), async (state) => {
      const library = openCellLibrary(state, env);
      const agent = agentCellIn(state, library);
      const context = { actor: () => person(), agent, library, settle: agent.settle };
      const call = { threadId: "thread-1", toolUseId: "toolu_1" };
      await expect(
        runAgentTool(libraryRouter, context, { ...call, input: {}, name: "undo_change" }),
      ).resolves.toStrictEqual({ content: "There is no tool named undo_change.", isError: true });
      await expect(
        runAgentTool(libraryRouter, context, { ...call, input: [], name: "list_items" }),
      ).resolves.toStrictEqual({ content: "A tool's input is a JSON object.", isError: true });
      const unread = await runAgentTool(libraryRouter, context, {
        ...call,
        input: { id: 7 },
        name: "read_item",
      });
      expect(unread.isError).toBe(true);
      expect(unread.content).toMatch(/^Input validation failed\n/u);
    });
  });
});

describe("the built-in agent's principal", () => {
  it("is no header's: the cell names it for one turn of one thread, and a request never does", () => {
    const claimed = {
      accountId: "account-1",
      actor: { kind: "agent", threadId: "thread-1", turn: 1 },
      scopes: ["library"],
    };
    expect(principalFromHeader(encodeURIComponent(JSON.stringify(claimed)))).toBeNull();
    const assistant = {
      ...claimed,
      actor: { clientId: "client-1", clientName: "Claude", grantId: "grant-1", kind: "assistant" },
    };
    expect(principalFromHeader(encodeURIComponent(JSON.stringify(assistant)))).toStrictEqual(
      assistant,
    );
  });
});
