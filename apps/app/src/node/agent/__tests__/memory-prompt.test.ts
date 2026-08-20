// The memory index is a GOLDEN, for the same reason the view-context block is:
// it rides every turn that carries memory, it costs tokens, and a silent
// rewording is the kind of change nobody notices. So the bytes are pinned, the
// cap is pinned against its code-point boundary, and the empty case — which is
// what keeps a turn with no memory byte-identical to today's input — is pinned
// as `undefined`.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MemoryEntry } from "@repo/server-contract/memory";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import {
  composeMemoryBlock,
  MEMORY_INDEX_MAX_BYTES,
  readMemoryPromptBlock,
} from "../memory-prompt";

const PREAMBLE =
  "Your memory of this user, kept as files in $INTELIGIR_MEMORY_DIR (read one for its full text; write or delete files there to update what you remember):";

function fact(overrides: Partial<MemoryEntry> & Pick<MemoryEntry, "name" | "type">): MemoryEntry {
  return { file: `${overrides.name}.md`, description: "", body: "", ...overrides };
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe("composeMemoryBlock", () => {
  it("groups facts by type under headings, with a name — description line each", () => {
    const block = composeMemoryBlock([
      fact({ name: "Kaiyu", description: "builds inteligir", type: "user" }),
      fact({ name: "Concise commits", description: "short, imperative", type: "preference" }),
    ]);
    expect(block).toBe(
      [
        PREAMBLE,
        "Who they are:\n- Kaiyu — builds inteligir",
        "How they want you to work:\n- Concise commits — short, imperative",
      ].join("\n\n"),
    );
  });

  it("drops the em-dash when a fact has no description", () => {
    const block = composeMemoryBlock([fact({ name: "Terse", type: "preference" })]);
    expect(block).toBe(`${PREAMBLE}\n\nHow they want you to work:\n- Terse`);
  });

  it("caps the index on a code-point boundary against its own budget", () => {
    // A 4-byte code point repeated past the budget: slicing by string length
    // would halve a surrogate pair and hand the model U+FFFD.
    const description = "😀".repeat(MEMORY_INDEX_MAX_BYTES);
    const block = composeMemoryBlock([fact({ name: "Big", description, type: "user" })]);
    const index = block.slice(`${PREAMBLE}\n\n`.length);
    expect(utf8Length(index)).toBeLessThanOrEqual(MEMORY_INDEX_MAX_BYTES);
    expect(index).not.toContain("�");
  });
});

describe("readMemoryPromptBlock", () => {
  it("is undefined for an empty or missing directory", () => {
    const missing = join(makeTempDir("memory-prompt-"), "none");
    expect(readMemoryPromptBlock(missing)).toBeUndefined();
    expect(readMemoryPromptBlock(makeTempDir("memory-prompt-"))).toBeUndefined();
  });

  it("composes the block from the files on disk", () => {
    const dir = makeTempDir("memory-prompt-");
    writeFileSync(
      join(dir, "role.md"),
      "---\nname: Role\ndescription: writes notes\ntype: user\n---\nfull text\n",
      "utf8",
    );
    const block = readMemoryPromptBlock(dir);
    expect(block).toBe(`${PREAMBLE}\n\nWho they are:\n- Role — writes notes`);
  });
});
