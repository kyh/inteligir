// Intent-parse robustness: the classifier reply is model text, so the parser
// must survive casing, punctuation, JSON, prose — and resolve anything
// ambiguous to "generate" (the non-destructive branch).

import { describe, expect, it } from "vitest";

import { parseAiIntent } from "../inline-ai";

describe("parseAiIntent", () => {
  it.each([
    ["edit", "edit"],
    ["EDIT", "edit"],
    ["Edit.", "edit"],
    ["  edit\n", "edit"],
    ['{"intent":"edit"}', "edit"],
    ["The intent is: EDIT", "edit"],
    ["generate", "generate"],
    ["Generate!", "generate"],
    ['{"intent": "generate"}', "generate"],
  ])("parses %j as %s", (input, expected) => {
    expect(parseAiIntent(input)).toBe(expected);
  });

  it.each([
    "", // empty
    "banana", // off-script
    "editorial", // substring must not match
    "edit or generate, hard to say", // names both → safe branch
    "I would generate an edit", // names both
    "0", // numeric garbage
  ])("falls back to generate for %j", (input) => {
    expect(parseAiIntent(input)).toBe("generate");
  });
});
