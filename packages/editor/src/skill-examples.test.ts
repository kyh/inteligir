// the skills teach an agent the dialect by example, and an example the editor cannot hold is the
// agent taught to write bytes that lose what they say on a save, or that move on every save. read
// as files: @repo/agent-skills is content, never imported.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";

import { BASE_KIT } from "@repo/editor/kits/base-kit";
import { lettersKept, parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";

const SKILLS_DIR = fileURLToPath(new URL("../../agent-skills/skills", import.meta.url));

const FENCE_OPEN = /^(?<fence>`{3,}|~{3,})(?<info>[^`\s]*)/u;

interface Example {
  site: string;
  body: string;
}

// a fence closes on a run of its own character at least as long as the one that opened it, so a
// ````markdown example may hold a ``` block of its own.
const markdownExamples = (file: string, text: string): Example[] => {
  const examples: Example[] = [];
  let open: { fence: string; info: string; line: number; body: string[] } | null = null;
  for (const [index, line] of text.split("\n").entries()) {
    if (open === null) {
      const groups = FENCE_OPEN.exec(line)?.groups;
      if (groups !== undefined) {
        open = { body: [], fence: groups.fence ?? "", info: groups.info ?? "", line: index + 1 };
      }
      continue;
    }
    const { fence } = open;
    const closing = line.trim();
    if (closing.length >= fence.length && [...closing].every((char) => char === fence[0])) {
      if (open.info === "markdown") {
        examples.push({ body: `${open.body.join("\n")}\n`, site: `${file}:${String(open.line)}` });
      }
      open = null;
      continue;
    }
    open.body.push(line);
  }
  return examples;
};

const EXAMPLES = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) =>
    markdownExamples(
      `packages/agent-skills/skills/${entry.name}/SKILL.md`,
      readFileSync(`${SKILLS_DIR}/${entry.name}/SKILL.md`, "utf-8"),
    ),
  );

// one write: the note parsed into the codec's value and serialized back.
const saveOnce = (md: string): string => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error(`the example did not read: ${parsed.reason.kind}`);
  }
  return serializeNote(createSlateEditor({ plugins: BASE_KIT }), parsed.value);
};

describe("the skills' markdown examples", () => {
  it("finds them at all", () => {
    expect(EXAMPLES.length).toBeGreaterThan(5);
  });

  it.each(EXAMPLES)("$site keeps every letter and settles after one save", (example) => {
    const saved = saveOnce(example.body);
    expect(lettersKept(example.body, saved), `${example.site} loses words on a save`).toBe(1);
    expect(saveOnce(saved), `${example.site} still moves on its second save`).toBe(saved);
  });

  // a construct spelled wrong stays text, and the writer escapes what would read as one
  it.each(EXAMPLES)("$site spells every construct so it reads as one", (example) => {
    expect(saveOnce(example.body)).not.toMatch(/\\:|\\\[\\\[/u);
  });
});
