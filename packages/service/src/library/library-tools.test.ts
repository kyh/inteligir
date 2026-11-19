import { isLibraryToolName, LIBRARY_TOOLS } from "@repo/contract/library/agent-tools";
import { expect, it } from "vitest";
import { z } from "zod";

import { TAGGED_ROWS } from "./library-tools";

const EXPLICIT_HINTS = z.union([
  z.object({ openWorldHint: z.boolean(), readOnlyHint: z.literal(true), title: z.string() }),
  z.object({ destructiveHint: z.boolean(), openWorldHint: z.boolean(), title: z.string() }),
]);

const DESCRIPTION_MAX = 4096;

it("states every hint and a description a client loads whole", () => {
  for (const { path, tool } of TAGGED_ROWS) {
    expect(EXPLICIT_HINTS.safeParse(tool.annotations).success, path.join(".")).toBe(true);
    expect(tool.description?.length ?? 0).toBeGreaterThan(0);
    expect(tool.description?.length ?? 0).toBeLessThanOrEqual(DESCRIPTION_MAX);
  }
});

it("tags each of the contract's tool names once, read-only as its table says", () => {
  const named = TAGGED_ROWS.flatMap(({ tool }) =>
    tool.name !== undefined && isLibraryToolName(tool.name)
      ? [{ name: tool.name, readOnly: tool.annotations?.readOnlyHint === true }]
      : [],
  );

  expect(named.map(({ name }) => name).toSorted()).toStrictEqual(
    Object.keys(LIBRARY_TOOLS).toSorted(),
  );

  for (const { name, readOnly } of named) {
    expect(readOnly, name).toBe(LIBRARY_TOOLS[name].reads);
  }
});

it("tags the guide as the one tool beyond the table, the connector's alone", () => {
  const beyond = TAGGED_ROWS.filter(
    ({ tool }) => tool.name === undefined || !isLibraryToolName(tool.name),
  );

  expect(beyond.map(({ path, tool }) => [path.join("."), tool.name])).toStrictEqual([
    ["guide", "read_guide"],
  ]);
});

it("says on every tool answering an item's tags that a #tag in its text changes only by edit_item", () => {
  const answering = new Set(["list_items", "organize_items", "read_item"]);

  const described = TAGGED_ROWS.flatMap(({ tool: { description, name } }) =>
    name !== undefined && answering.has(name) ? [{ description, name }] : [],
  );

  expect(described.map(({ name }) => name).toSorted()).toStrictEqual([...answering]);

  for (const { description, name } of described) {
    expect(description, name).toMatch(/#tag written in (?:its|an item's) text/u);
    expect(description, name).toMatch(/only by edit_item|only edit_item/u);
  }
});
