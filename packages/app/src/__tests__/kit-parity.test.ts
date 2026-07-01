import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createSlateEditor } from "platejs";
import { MarkdownPlugin, serializeMd } from "@platejs/markdown";

import { BASE_KIT } from "@repo/app/editor/kits/base-kit";
import { MD_REMARK_PLUGINS, MD_STRINGIFY } from "@repo/app/editor/markdown/md-plugins";
import { MD_RULES } from "@repo/app/editor/markdown/md-rules";
import { parseMarkdown } from "@repo/app/editor/markdown/markdown-doc";

// Mirror-sync-by-construction (WP1, Base half): every editor built from the
// kits carries THE shared MarkdownPlugin instance — reference-identical
// options — and serializes the canonical corpus deterministically. WP2 extends
// this test to EDITOR_KIT (React halves) once it exists; identical node +
// markdown behavior across the two editors is the premise the old
// "keep this list in sync" comment relied on — this converts it into CI.

const FIXTURES = fileURLToPath(new URL("fixtures/roundtrip/canonical/", import.meta.url));

describe("kit parity (Base half)", () => {
  it("BASE_KIT editors share the MarkdownPlugin config by reference", () => {
    const a = createSlateEditor({ plugins: BASE_KIT });
    const b = createSlateEditor({ plugins: BASE_KIT });
    const optionsA = a.getOptions(MarkdownPlugin);
    const optionsB = b.getOptions(MarkdownPlugin);
    expect(optionsA.rules).toBe(MD_RULES);
    expect(optionsB.rules).toBe(MD_RULES);
    expect(optionsA.remarkPlugins).toBe(MD_REMARK_PLUGINS);
    expect(optionsB.remarkPlugins).toBe(MD_REMARK_PLUGINS);
    expect(optionsA.disallowedNodes).toEqual(["suggestion", "ai"]);
  });

  it("serializes the canonical corpus identically across editor instances", () => {
    const a = createSlateEditor({ plugins: BASE_KIT });
    const b = createSlateEditor({ plugins: BASE_KIT });
    for (const name of readdirSync(FIXTURES).toSorted()) {
      const src = readFileSync(`${FIXTURES}${name}`, "utf8");
      const parsed = parseMarkdown(src);
      expect(parsed.ok, `${name} must parse`).toBe(true);
      if (!parsed.ok) continue;
      const outA = serializeMd(a, { remarkStringifyOptions: MD_STRINGIFY, value: parsed.value });
      const outB = serializeMd(b, { remarkStringifyOptions: MD_STRINGIFY, value: parsed.value });
      expect(outA, `${name} must serialize deterministically`).toBe(outB);
      expect(outA.trimEnd(), `${name} must match its canonical bytes`).toBe(src.trimEnd());
    }
  });
});
