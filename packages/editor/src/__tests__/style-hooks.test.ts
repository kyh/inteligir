// ---------------------------------------------------------------------------
// The stylesheet ↔ hook lockstep.
//
// The kits emit behaviour hooks — `data-toggle-collapsed`, the callout marker
// classes — and styles.css's rules over them are what make a toggle collapse
// and a callout badge replace its raw `> [!TIP]` line. Nothing else connects
// the two: the hooks are strings, the rules are selectors, and a drift on
// either side is behaviour that silently stops applying (the whole editor
// once shipped with the stylesheet missing and no test noticed). So the hook
// vocabulary is spelled ONCE in style-hooks.ts, and this suite pins
// styles.css to that table, refuses a literal re-spelling anywhere else in
// the package, and pins the highlight theme to what the shipped grammars
// actually emit.
//
// Detection is textual and therefore a lower bound, stated rather than
// implied: it finds hooks spelled as string tokens, not every computed way a
// class could be assembled. What it buys is that the known drift cannot come
// back.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { CodeBlockPlugin } from "@platejs/code-block/react";
import { createLowlight } from "lowlight";
import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";

import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import * as styleHooks from "@repo/editor/style-hooks";

const SRC = path.resolve(import.meta.dirname, "..");
const STYLES = path.join(SRC, "styles.css");
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** The one place the hook spellings live; every value is a selector hook. */
const DECLARED_HOOKS: readonly string[] = Object.values(styleHooks).toSorted();

/** Slate stamps these on every rendered node — the toggle rule addresses the
 *  document's own blocks through Slate's DOM contract, not a hook a kit
 *  emits, so the lockstep has nothing to check against them. */
const SLATE_ATTR = /^data-slate-/;

const HLJS_PREFIX = "hljs-";

interface Rule {
  selector: string;
  body: string;
}

const RULE = /([^{}]+)\{([^{}]*)\}/g;

function readStylesheet() {
  const css = fs.readFileSync(STYLES, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(RULE)].map((match) => ({
    selector: (match[1] ?? "").trim(),
    body: match[2] ?? "",
  }));
  return { rules, unparsed: css.replace(RULE, "").trim() };
}

/** A rule that only declares custom properties (the `:root`/`.dark` syntax
 *  palette) defines tokens, not behaviour — its selector is theme plumbing,
 *  not a hook. */
function isTokenBlock(rule: Rule): boolean {
  const declarations = rule.body
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration.length > 0);
  return declarations.length > 0 && declarations.every((line) => line.startsWith("--"));
}

function selectorHooks() {
  const hooks = new Set<string>();
  const themeScopes = new Set<string>();
  for (const rule of readStylesheet().rules) {
    if (isTokenBlock(rule)) continue;
    for (const match of rule.selector.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)) {
      const className = match[1] ?? "";
      if (className.startsWith(HLJS_PREFIX)) themeScopes.add(className.slice(HLJS_PREFIX.length));
      else hooks.add(className);
    }
    for (const match of rule.selector.matchAll(/\[(data-[a-z-]+)/g)) {
      const attribute = match[1] ?? "";
      if (!SLATE_ATTR.test(attribute)) hooks.add(attribute);
    }
  }
  return { hooks: [...hooks].toSorted(), themeScopes: [...themeScopes].toSorted() };
}

/** Every package source file that could emit a hook — a walk rather than a
 *  list, so a module written tomorrow is covered the day it appears. The
 *  hooks module itself is the one allowed spelling. */
function packageSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : packageSources(full);
    if (!/\.tsx?$/u.test(entry.name)) return [];
    return full === path.join(SRC, "style-hooks.ts") ? [] : [full];
  });
}

describe("editor style hooks", () => {
  it("styles.css stays flat, so the lockstep can read it", () => {
    expect(
      readStylesheet().unparsed,
      `packages/editor/src/styles.css has content outside top-level rules.\n` +
        `  rule: the sheet stays FLAT — no nesting, no at-rules — because this guard reads it with a flat-rule parser, and a rule the parser cannot see is a rule the lockstep does not hold\n`,
    ).toBe("");
  });

  it("styles.css selects exactly the hooks style-hooks.ts spells", () => {
    expect(
      selectorHooks().hooks,
      `packages/editor/src/styles.css and packages/editor/src/style-hooks.ts disagree.\n` +
        `  rule: a hook a kit emits with no rule over it is inert markup (a toggle that never collapses); a rule over a hook nothing emits is dead CSS wearing a working name\n` +
        `  fix: add the missing rule to styles.css, or drop the stale spelling from style-hooks.ts — never re-spell either side by hand\n`,
    ).toEqual(DECLARED_HOOKS);
  });

  it("no module re-spells a hook as a raw literal", () => {
    const violations: string[] = [];
    for (const file of packageSources(SRC).toSorted()) {
      const stripped = fs
        .readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      const tokens = new Set(stripped.split(/[^A-Za-z0-9_-]+/u));
      for (const hook of DECLARED_HOOKS) {
        if (tokens.has(hook)) violations.push(`  ${path.relative(SRC, file)}  ${hook}`);
      }
    }
    expect(
      violations,
      `These spell a style hook as a literal instead of importing it.\n` +
        `  rule: the hooks live in @repo/editor/style-hooks so the stylesheet has ONE spelling to be pinned against — a literal copy is exactly the drift the lockstep exists to refuse\n` +
        `${violations.join("\n")}\n`,
    ).toEqual([]);
  });

  it("the highlight theme names exactly the scopes the shipped grammars emit", () => {
    const editor = createSlateEditor({ plugins: EDITOR_KIT });
    const lowlight = editor.getOptions(CodeBlockPlugin).lowlight;
    if (lowlight === null || lowlight === undefined) {
      throw new Error("the shipped editor kit registers no lowlight highlighter");
    }
    const emitted = new Set<string>();
    for (const [language, code] of Object.entries(HIGHLIGHT_CORPUS)) {
      collectScopes(lowlight.highlight(language, code), emitted);
    }
    expect(
      selectorHooks().themeScopes,
      `The .hljs-* theme in packages/editor/src/styles.css disagrees with what the kit's grammars emit over the corpus in this file.\n` +
        `  rule: a scope the theme leaves unnamed renders colourless by accident — name it, with \`color: inherit\` when riding the foreground is the choice; a scope the corpus never emits is a rule nothing reaches — drop it, or add a snippet that emits it\n`,
    ).toEqual([...emitted].toSorted());
  });

  it("the foreground group leads the theme, so a scope nested in it keeps its colour", () => {
    const theme = readStylesheet().rules.filter((rule) =>
      rule.selector.includes(`.${HLJS_PREFIX}`),
    );
    const colourOf = (rule: Rule) => /(?:^|;)\s*color\s*:\s*([^;]+)/u.exec(rule.body)?.[1]?.trim();
    const lastInherit = theme.findLastIndex((rule) => colourOf(rule) === "inherit");
    const firstColoured = theme.findIndex((rule) => {
      const colour = colourOf(rule);
      return colour !== undefined && colour !== "inherit";
    });
    expect(
      lastInherit < firstColoured,
      `packages/editor/src/styles.css puts a \`color: inherit\` theme rule after a coloured one.\n` +
        `  rule: Plate flattens ancestor scopes onto each leaf, so a leaf carries its container's class too — at equal specificity the later rule wins, and an inherit rule placed after the palette uncolours every token inside a function, params or subst scope\n` +
        `  inherit rule at ${lastInherit}: ${theme[lastInherit]?.selector.replaceAll(/\s+/gu, " ")}\n` +
        `  coloured rule at ${firstColoured}: ${theme[firstColoured]?.selector.replaceAll(/\s+/gu, " ")}\n`,
    ).toBe(true);
  });

  it("the desktop renderer imports the sheet, so the rules actually ship", () => {
    const globals = fs.readFileSync(
      path.join(REPO_ROOT, "apps/desktop/src/renderer/styles/globals.css"),
      "utf8",
    );
    expect(
      globals.includes(`@import "@repo/editor/styles.css";`),
      `apps/desktop/src/renderer/styles/globals.css does not import @repo/editor/styles.css.\n` +
        `  rule: every rule this suite pins is inert until the app's stylesheet pulls the sheet in — the lockstep proves the selectors agree, this proves anyone loads them\n`,
    ).toBe(true);
  });
});

type Highlighter = ReturnType<typeof createLowlight>;
type HastRoot = ReturnType<Highlighter["highlight"]>;
type HastNode = HastRoot | HastRoot["children"][number];

function collectScopes(node: HastNode, into: Set<string>): void {
  if (node.type === "element") {
    const className = node.properties.className;
    if (Array.isArray(className)) {
      for (const entry of className) {
        if (entry.startsWith(HLJS_PREFIX)) into.add(entry.slice(HLJS_PREFIX.length));
      }
    }
  }
  if ("children" in node) {
    for (const child of node.children) collectScopes(child, into);
  }
}

/** Small but deliberate: together these snippets emit every scope the theme
 *  names, so the theme↔emission comparison can run both directions. A
 *  grammar update that starts emitting a new scope fails the suite, which is
 *  the moment to decide the scope's colour rather than render it colourless. */
const HIGHLIGHT_CORPUS = {
  css: "a.b#c[href]:hover::before { color: #fff; margin: 1px !important; }",
  diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new",
  go: 'type T struct { x int }\nfunc main() { fmt.Println("hi", 1, nil) }',
  json: '{"a": [1, true, null]}',
  markdown: "# Title\n> quote\n- **strong** _em_ `code` [link](http://x)",
  python: 'def f(x: int = 1) -> None:\n    """doc"""\n    print(f"{x}")',
  ruby: ':sym\ndef f(a) puts "#{a}" end',
  typescript: [
    "// note",
    "/** @param x */",
    "export async function f<T>(x: T, n = 0x1f): Promise<T> {",
    "  const s = `t ${x}`;",
    '  if (x === null || true) return await new Map<string, T>().get("k");',
    "  class C extends B { #p = /re+/g; get z() { return this.#p; } }",
    "  return x;",
    "}",
  ].join("\n"),
  xml: '<!DOCTYPE html><div class="a"><!-- c -->&amp;</div>',
};
