// The built-in agent's tools: the library's own procedures, the same rows the connector lists but
// the person's Undo, each defined as the Messages API takes it and run by the cell as the agent's.
// The definitions are every new thread's cached prefix, so their JSON is a committed snapshot and
// a change to it shows in review; every answer fits the 40,000 characters a result is replayed
// at, however full the library.

import { McpServer } from "@modelcontextprotocol/server";
import { McpRegistrar } from "@orpc/mcp";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { isLibraryTool } from "../connector/library-tools";
import { FILL_ACTOR } from "../library/cell-fills";
import { appPrincipalSchema, connectorPrincipalSchema } from "../library/library-principal";
import { libraryRouter } from "../library/library-router";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import {
  cellIn,
  cellOf,
  createItem,
  headOf,
  inCell,
  landedValue,
  placed,
} from "../test-support/library-cell";
import {
  AGENT_RESULT_MAX_CHARS,
  AGENT_TOOL_DEFINITIONS,
  agentOpId,
  asksFirst,
  callStart,
  runAgentTool,
} from "./agent-tools";
import { AGENT_TOOL_POLICIES } from "./library-agent";

// the tools the connector's full registrar lists over the cell's router
const registered = async (): Promise<string[]> =>
  await inCell(cellOf(), async (state) => {
    const registrar = new McpRegistrar(libraryRouter, { filter: isLibraryTool });
    const { tools } = await registrar.register(new McpServer({ name: "inteligir", version: "0" }), {
      context: cellIn(state).context,
    });
    return Object.keys(tools);
  });

const words = (count: number, seed: string): string =>
  Array.from({ length: count }, (_, index) => `${seed}${String(index)}`).join(" ");

describe("the built-in agent's tools", () => {
  it("are the connector's tools but its guide, each by its name, deleting and reaching the web on the person's word", async () => {
    const listed = await registered();
    const names = AGENT_TOOL_DEFINITIONS.map((tool) => tool.name);
    // the guide's text is the agent's prompt, so it is the one tool the agent is not handed
    expect([...names, "read_guide"].toSorted()).toStrictEqual(listed.toSorted());
    expect(Object.keys(AGENT_TOOL_POLICIES).toSorted()).toStrictEqual(names);
    expect(names.filter(asksFirst)).toStrictEqual(["delete_items", "save_link"]);
  });

  it("reads a call that asks through its row's own input, and answers one the row refuses", () => {
    const id = crypto.randomUUID();
    expect(callStart("delete_items", { ids: [id] })).toStrictEqual({
      ask: { ids: [id], kind: "delete" },
      kind: "ask",
    });
    const url = "https://collector.example/?d=a-private-note";
    expect(callStart("save_link", { tags: ["later"], url })).toStrictEqual({
      ask: { kind: "save", url },
      kind: "ask",
    });
    expect(callStart("organize_items", { ids: [] })).toStrictEqual({ kind: "run" });
    const refused = {
      answer: { content: expect.stringMatching(/^Input validation failed\n/u), isError: true },
      kind: "refused",
    };
    expect(callStart("delete_items", { ids: [] })).toStrictEqual(refused);
    expect(callStart("delete_items", { everything: true, ids: [id] })).toStrictEqual(refused);
    expect(callStart("save_link", { url: "not a link" })).toStrictEqual(refused);
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
        const { context, library } = cellIn(state);
        for (let index = 0; index < 60; index += 1) {
          landedValue(
            createItem(library, FILL_ACTOR, {
              blocks: placed([paragraph("a", words(80, `body${String(index)}x`))]),
              fields: noteFixture({
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
            fields: noteFixture({ title: "The long one" }),
            id: longId,
          }),
        );
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
          .object({ cursor: z.number().nullable(), hits: z.array(z.unknown()) })
          .parse(JSON.parse(fitted.content));
        expect(page.hits.length).toBeLessThan(50);
        expect(page.cursor).toBe(page.hits.length);
      });
    },
  );

  it("answer a call they cannot run as an error the agent reads, never a failed turn", async () => {
    await inCell(cellOf(), async (state) => {
      const { context } = cellIn(state);
      const call = { threadId: "thread-1", toolUseId: "toolu_1" };
      await expect(
        runAgentTool(libraryRouter, context, { ...call, input: {}, name: "empty_library" }),
      ).resolves.toStrictEqual({ content: "There is no tool named empty_library.", isError: true });
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

  it("refuse a write once its turn has ended, and land nothing", async () => {
    await inCell(cellOf(), async (state) => {
      const { library, runTool } = cellIn(state);
      await expect(
        runTool({
          input: { markdown: "Too late." },
          name: "create_note",
          threadId: "thread-1",
          toolUseId: "toolu_1",
          turn: 1,
        }),
      ).resolves.toStrictEqual({ content: "This turn has ended.", isError: true });
      expect(headOf(library)).toBe(0);
    });
  });
});

describe("the built-in agent's principal", () => {
  it("is no argument's: the cell names it for one turn of one thread, and neither door takes one", () => {
    const claimed = {
      accountId: "account-1",
      actor: { kind: "agent", threadId: "thread-1", turn: 1 },
    };
    expect(appPrincipalSchema.safeParse(claimed).success).toBe(false);
    expect(connectorPrincipalSchema.safeParse(claimed).success).toBe(false);
  });
});
