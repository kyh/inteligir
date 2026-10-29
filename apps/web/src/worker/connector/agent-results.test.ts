// What the built-in agent can get back through the connector: every result, its text and its
// structured content together, under the 40,000 characters past which Managed Agents writes a
// result into the sandbox, however full the library; a list page past it answers fewer rows and
// the cursor for the rest. The calls are the agent's own, with the token its grant mints, while a turn is open.

import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { grantBuiltInAgent } from "../agent/built-in-client";
import { openCellLibrary } from "../library/cell-library";
import { holdTurnOpen } from "../test-support/agent-turns";
import { connectorClient } from "../test-support/connector-session";
import {
  cellOf,
  inCell,
  landedValue,
  newAccountId,
  noteFields,
  paragraph,
  placed,
  SYSTEM,
} from "../test-support/library-cell";
import { connectorAuth } from "./connector-auth";
import { AGENT_RESULT_MAX_CHARS } from "./connector-server";

const resultSchema = z.looseObject({
  content: z.array(z.looseObject({ text: z.string().optional(), type: z.string() })),
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
});

const charsOf = (result: z.infer<typeof resultSchema>): number =>
  JSON.stringify(result.content).length + JSON.stringify(result.structuredContent ?? null).length;

const words = (count: number, seed: string): string =>
  Array.from({ length: count }, (_, index) => `${seed}${String(index)}`).join(" ");

describe("the built-in agent's tool results", () => {
  it(
    "stay under 40,000 characters, text and structured content together, however full the library",
    { timeout: 60_000 },
    async () => {
      const accountId = newAccountId();
      const longId = crypto.randomUUID();
      await inCell(cellOf(accountId), (state) => {
        const library = openCellLibrary(state, env);
        // sixty items with long titles and descriptions, and one of four hundred long paragraphs
        for (let index = 0; index < 60; index += 1) {
          landedValue(
            library.create(SYSTEM, {
              blocks: placed([paragraph("a", words(80, `body${String(index)}x`))]),
              fields: noteFields({
                description: words(60, "about"),
                tags: ["travel", `tag-${String(index % 7)}`],
                title: `Paris ${words(25, "title")} ${String(index)}`,
              }),
              id: crypto.randomUUID(),
            }),
          );
        }
        landedValue(
          library.create(SYSTEM, {
            blocks: placed(
              Array.from({ length: 400 }, (_, index) =>
                paragraph(`p${String(index)}`, words(60, `line${String(index)}x`)),
              ),
            ),
            fields: noteFields({ title: "The long one" }),
            id: longId,
          }),
        );
        holdTurnOpen(library);
      });
      const grant = await grantBuiltInAgent(connectorAuth(env), env, {
        accountId,
        endpoint: exports.default,
      });
      const client = await connectorClient(grant.accessToken);
      const calls: readonly (readonly [string, Readonly<Record<string, string | number>>])[] = [
        ["search_library", { limit: 50, query: "Paris", responseFormat: "detailed" }],
        ["search_library", { limit: 50, query: "Paris" }],
        ["list_items", { limit: 50, responseFormat: "detailed" }],
        ["list_items", { limit: 50 }],
        ["read_item", { count: 500, id: longId, responseFormat: "detailed" }],
        ["read_item", { from: 200, id: longId }],
        ["list_highlights", { limit: 50 }],
        ["item_history", { limit: 50 }],
        ["list_tags_and_folders", {}],
        ["create_note", { markdown: words(2000, "note") }],
      ];
      for (const [name, args] of calls) {
        const result = resultSchema.parse(await client.callTool({ arguments: args, name }));
        expect(charsOf(result), name).toBeLessThan(AGENT_RESULT_MAX_CHARS);
        expect(result.isError ?? false, name).toBe(false);
      }
      // a page that would pass the budget answers what fits, with the cursor for the rest
      const fitted = resultSchema.parse(
        await client.callTool({
          arguments: { limit: 50, query: "Paris", responseFormat: "detailed" },
          name: "search_library",
        }),
      );
      const page = z
        .object({ cursor: z.string().nullable(), hits: z.array(z.unknown()) })
        .parse(fitted.structuredContent);
      expect(page.hits.length).toBeLessThan(50);
      expect(page.cursor).toBe(String(page.hits.length));
      await client.close();
    },
  );
});
