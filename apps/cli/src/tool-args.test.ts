import type { Tool } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

import { toolArguments, UsageError } from "./tool-args";

const SCHEMA: Tool["inputSchema"] = {
  properties: {
    limit: { type: "number" },
    pinned: { type: "boolean" },
    query: { type: "string" },
    tags: { items: { type: "string" }, type: "array" },
  },
  required: ["query"],
  type: "object",
};

describe("a tool's arguments from the command line", () => {
  it("reads name=value as text where the tool takes text, and as JSON elsewhere", () => {
    expect(
      toolArguments(["query=42", "limit=5", "pinned=true", 'tags=["a","b"]'], SCHEMA),
    ).toStrictEqual({ limit: 5, pinned: true, query: "42", tags: ["a", "b"] });
  });

  it("keeps a value that isn't JSON as text, and an = inside a value", () => {
    expect(toolArguments(["limit=five", "query=a=b"], SCHEMA)).toStrictEqual({
      limit: "five",
      query: "a=b",
    });
  });

  it("takes one JSON object whole", () => {
    expect(toolArguments(['{"query":"garden","limit":2}'], SCHEMA)).toStrictEqual({
      limit: 2,
      query: "garden",
    });
  });

  it("refuses a word with no name, and JSON that isn't an object", () => {
    expect(() => toolArguments(["garden"], SCHEMA)).toThrow(UsageError);
    expect(() => toolArguments(["=x"], SCHEMA)).toThrow(UsageError);
    expect(() => toolArguments(["{not json"], SCHEMA)).toThrow(UsageError);
  });
});
