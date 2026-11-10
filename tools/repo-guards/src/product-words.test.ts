// a product surface speaks the person's words: the whole of it is the library and what is in it are
// items, and no surface names the engine (git, commit, remote, repo, terminal, CLI, PATH, MCP;
// AGENTS.md § Rules that matter).
// detection is textual and a lower bound: it reads the quoted literals
// that hold a space, with a template's `${…}` set aside and its own literals read too, every line
// of a template that runs over several, which is how the site's pages are written, a .tsx file's
// lines of JSX text, which is where the window's, the phone's and the shell's sentences live, and
// the legal pages' prose.

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, sourceOf, workspaceFiles, workspaces } from "./repo";

// the workspaces whose src/ holds words a person reads, besides the shell's Rust: @repo/web for the
// site, @repo/service for the Worker's mail, consent page and refusals, @repo/contract for the
// refusals and notices it hands a surface to show. tools/ui-gallery is not one:
// it is never deployed, so no person reads its sample words
const SURFACES = [
  "@repo/agent-panel",
  "@repo/contract",
  "@repo/editor",
  "@repo/extension",
  "@repo/mobile",
  "@repo/service",
  "@repo/ui",
  "@repo/web",
] as const;

const RUST_UI_DIR = "apps/desktop/src-tauri/src";

// the site serves these from the doc itself
const LEGAL_PAGES = ["docs/privacy.md", "docs/terms.md"] as const;

// a file that may say a word, and why: a row that no longer matches anything is stale
const ALLOWED: ReadonlyMap<string, string> = new Map<string, string>([
  [
    "packages/service/src/agent/agent-prompt.ts",
    "the built-in agent's instructions keep their words (AGENTS.md § Rules that matter)",
  ],
]);

interface Word {
  name: string;
  pattern: RegExp;
}

const WORDS: readonly Word[] = [
  { name: "vault", pattern: /\bvaults?\b/iu },
  {
    name: "an engine word",
    // "committed to" is a promise, which a legal page makes, and no engine's word
    pattern: /\b(?:git|commits?|committed(?! to\b)|remotes?|repos?|repository|terminal)\b/iu,
  },
  { name: "an engine word", pattern: /\b(?:CLI|PATH|MCP)\b/u },
];

// a log line, a fault's panic or an assertion is read by whoever debugs, not the person
const LOG_LINE = /\b(?:console\.\w+|e?println!|panic!|assert\w*!|debug_assert\w*!)\s*\(/u;

// a trailing `// …` after code, which an apostrophe in it would otherwise pair into a literal
const TRAILING_COMMENT = /\s\/\/\s.*$/u;

const DOUBLE_QUOTED = /"(?<body>(?:[^"\\\n]|\\.)*)"/gu;
const SINGLE_QUOTED = /'(?<body>(?:[^'\\\n]|\\.)*)'/gu;
const TEMPLATE = /`(?<body>(?:[^`\\]|\\.)*)`/gu;

// a template's text with each `${…}` set aside, and what those held, whose literals count too
interface SplitTemplate {
  text: string;
  held: string[];
}

const splitTemplate = (body: string): SplitTemplate => {
  let text = "";
  const held: string[] = [];
  let index = 0;
  while (index < body.length) {
    if (body.startsWith("${", index)) {
      let depth = 1;
      let end = index + 2;
      while (end < body.length && depth > 0) {
        if (body[end] === "{") {
          depth += 1;
        } else if (body[end] === "}") {
          depth -= 1;
        }
        end += 1;
      }
      held.push(body.slice(index + 2, end - 1));
      text += " ";
      index = end;
      continue;
    }
    text += body[index];
    index += 1;
  }
  return { held, text };
};

const collect = (pattern: RegExp, line: string, found: string[]): string => {
  pattern.lastIndex = 0;
  return line.replaceAll(pattern, (_match, body: string) => {
    found.push(body);
    return " ";
  });
};

// templates first, so a quote inside one pairs with nothing outside it, then double quotes, so an
// apostrophe inside "won't" never opens a single-quoted literal
const literalsOf = (line: string): string[] => {
  const found: string[] = [];
  TEMPLATE.lastIndex = 0;
  const outside = line.replaceAll(TEMPLATE, (_match, body: string) => {
    const { held, text } = splitTemplate(body);
    found.push(text);
    for (const inner of held) {
      found.push(...literalsOf(inner));
    }
    return " ";
  });
  collect(SINGLE_QUOTED, collect(DOUBLE_QUOTED, outside, found), found);
  return found.filter((literal) => /\s/u.test(literal.trim()));
};

const CODE_LEAD =
  /^(?:import|export|const|let|var|return|type|interface|case|default|if|else|for|while|function|async|await|new|throw|try|catch|from|switch|break|continue|yield|declare|enum|class|extends|implements)\b/u;

// a line of JSX text: words with no code punctuation, optionally ending in one `{…}`
const jsxTextOf = (line: string): string | null => {
  const trimmed = line.trim();
  const match = /^(?<text>[A-Za-z][^<>{}=;()`"|]*?)\s*(?:\{[^{}]*\})?$/u.exec(trimmed);
  const text = match?.groups?.text;
  if (text === undefined || !/\s/u.test(text) || CODE_LEAD.test(text)) {
    return null;
  }
  // an object's key or a type's member, never a sentence
  if (/^\w+\??:(?:\s|$)/u.test(text)) {
    return null;
  }
  return text;
};

interface Hit {
  file: string;
  line: number;
  word: string;
  text: string;
}

const hitsIn = (file: string, text: string): Hit[] => {
  for (const word of WORDS) {
    if (word.pattern.test(text)) {
      return [{ file, line: 0, text, word: word.name }];
    }
  }
  return [];
};

// JSX text that shares its line with the tags around it: `<p>Remote content, not loaded</p>`, and
// text after a tag that runs on to the next line: `<code>open</code> in a window, or`
const INLINE_JSX_TEXT = />(?<text>[^<>{}=;()`"|]+)</gu;
const TRAILING_JSX_TEXT = />(?<text>[^<>{}=;()`"|]+)$/u;

const inlineJsxTextOf = (line: string): string[] =>
  [...line.matchAll(INLINE_JSX_TEXT), TRAILING_JSX_TEXT.exec(line)].flatMap((match) => {
    const text = match?.groups?.text?.trim() ?? "";
    return /\s/u.test(text) && /^[A-Za-z]/u.test(text) ? [text] : [];
  });

// an HTML entity in JSX text (`&apos;`, `&rsquo;`, `&#8217;`) read as the mark it draws, so its `;`
// never reads as code punctuation
const HTML_ENTITY = /&(?:[A-Za-z]+|#\d+|#x[\da-fA-F]+);/gu;

// a literal a log line opens with its tag, `[desktop] …`, even when the call began a line above
const LOG_TAGGED = /^\[[\w -]+\]\s/u;

const scanLines = (file: string, lines: readonly string[], jsx: boolean): Hit[] => {
  const hits: Hit[] = [];
  for (const [index, raw] of lines.entries()) {
    if (LOG_LINE.test(raw)) {
      continue;
    }
    const line = raw.replace(TRAILING_COMMENT, "");
    const texts = literalsOf(line).filter((literal) => !LOG_TAGGED.test(literal));
    if (jsx) {
      const marks = line.replaceAll(HTML_ENTITY, "'");
      const jsxText = jsxTextOf(marks);
      if (jsxText !== null) {
        texts.push(jsxText);
      }
      texts.push(...inlineJsxTextOf(marks));
    }
    for (const text of texts) {
      hits.push(...hitsIn(file, text).map((hit) => ({ ...hit, line: index + 1 })));
    }
  }
  return hits;
};

// a template over several lines is read here, since no one line of it holds both its backticks
const longTemplateHits = (file: string, lines: readonly string[]): Hit[] => {
  const source = lines.join("\n");
  return [...source.matchAll(TEMPLATE)].flatMap((match) => {
    const rows = splitTemplate(match.groups?.body ?? "").text.split("\n");
    const first = source.slice(0, match.index).split("\n").length;
    return rows.length === 1
      ? []
      : rows.flatMap((row, offset) =>
          hitsIn(file, row).map((hit) => ({ ...hit, line: first + offset })),
        );
  });
};

const scanScript = (file: string, lines: readonly string[], jsx: boolean): Hit[] => [
  ...scanLines(file, lines, jsx),
  ...longTemplateHits(file, lines),
];

// sourceOf drops whole-line comments but keeps every other line, so a hit's number is the file's
const scriptHits = (file: string): Hit[] => {
  const kept = new Set(sourceOf(file).split("\n"));
  const lines = fs
    .readFileSync(path.join(REPO_ROOT, file), "utf-8")
    .split("\n")
    .map((line) => (kept.has(line) ? line : ""));
  return scanScript(file, lines, file.endsWith(".tsx"));
};

// a link's target is an address no one reads as a sentence
const LINK_TARGET = /\]\([^)]*\)/gu;

const markdownHits = (file: string): Hit[] =>
  fs
    .readFileSync(path.join(REPO_ROOT, file), "utf-8")
    .split("\n")
    .flatMap((line, index) =>
      hitsIn(file, line.replaceAll(LINK_TARGET, "]")).map((hit) => ({ ...hit, line: index + 1 })),
    );

// a Rust file's tests sit in its trailing `#[cfg(test)]` module, read by no one but cargo
const rustHits = (file: string): Hit[] => {
  const all = fs.readFileSync(path.join(REPO_ROOT, file), "utf-8").split("\n");
  const testsAt = all.findIndex((line) => line.trim() === "#[cfg(test)]");
  const shipped = (testsAt === -1 ? all : all.slice(0, testsAt)).map((line) =>
    /^\s*\/\//u.test(line) ? "" : line,
  );
  return scanLines(file, shipped, false);
};

const surfaceFiles = (): string[] => {
  const scripts = workspaces()
    .filter((workspace) => SURFACES.some((name) => name === workspace.name))
    .flatMap((workspace) => workspaceFiles(workspace).shipped);
  const rust = fs
    .readdirSync(path.join(REPO_ROOT, RUST_UI_DIR))
    .filter((name) => name.endsWith(".rs"))
    .map((name) => `${RUST_UI_DIR}/${name}`);
  return [...scripts, ...rust].toSorted();
};

const allHits = (): Hit[] => [
  ...surfaceFiles().flatMap((file) => (file.endsWith(".rs") ? rustHits(file) : scriptHits(file))),
  ...LEGAL_PAGES.flatMap((file) => markdownHits(file)),
];

describe("product surfaces speak the person's words", () => {
  it("the detector finds each shape it reads", () => {
    const planted: [string, string, boolean][] = [
      ['label: "Open Vault…",', "a double-quoted label", false],
      ["return 'Your vault is full';", "a single-quoted sentence", false],
      [`\`Saved \${count} to the vault\``, "a template's own text", false],
      [
        `\`\${a ? " Your vault stops syncing." : ""} Done.\``,
        "a literal held in a template",
        false,
      ],
      ["        Each vault on this Mac signs in on its own.", "a line of JSX text", true],
      ['<p className="m-0">Remote content, not loaded</p>', "JSX text between its tags", true],
      ["  <code>inteligir open</code> in a terminal, or choose", "JSX text after a tag", true],
      ["        Your vault&apos;s copy is kept.", "JSX text holding an entity", true],
      ["  <b>Saved</b> to your vault&rsquo;s top", "JSX text after a tag, with an entity", true],
      ['  "Uses this Mac\'s git credentials."', "an engine word", false],
      ['  "Run it from the CLI first"', "an uppercase engine word", false],
      ["const page = `# Home\n\nYour vault is kept.\n`;", "a template's later line", false],
      [`\`## \${name}\n\n- **Saved** to the \${x} repo (for now)\n\``, "a page's markdown", false],
    ];
    const blind = planted.flatMap(([line, what, jsx]) =>
      scanScript("planted", line.split("\n"), jsx).length === 0
        ? [`BLIND DETECTOR  ${what}: ${line}`]
        : [],
    );
    const quiet: [string, boolean][] = [
      ['queryKey: ["vault", "status"],', false],
      ["        vault: session.actions,", true],
      ['console.warn("[vaults] the shell did not answer", error);', false],
      ['            "[desktop] {} is not a recent-vaults list; starting over",', false],
      ['label: "Folder path",', false],
      [`  const url = \`https://example.com/\${path}\`; // the vault's door`, false],
      [`const page = \`# Home\n\n\${vault.name} is kept.\n\`;`, false],
    ];
    const noisy = quiet.flatMap(([line, jsx]) =>
      scanScript("planted", line.split("\n"), jsx).length > 0 ? [`FALSE HIT  ${line}`] : [],
    );
    expect([...blind, ...noisy], `\n${[...blind, ...noisy].join("\n")}\n`).toStrictEqual([]);
  });

  it("no surface says vault, or an engine word", () => {
    const violations = allHits()
      .filter((hit) => !ALLOWED.has(hit.file))
      .map(
        (hit) =>
          `${hit.file}:${String(hit.line)}  says ${hit.word}: "${hit.text.trim()}"\n` +
          `  rule: a product surface says the library and its items, and names no engine; the engine words stay code's (AGENTS.md § Rules that matter)\n` +
          `  fix: say library or item, or the person's own words for the engine; a file that must say it is a row of ALLOWED with its reason`,
      );
    expect(violations, `\n${violations.join("\n\n")}\n`).toStrictEqual([]);
  });

  it("no ALLOWED row is stale", () => {
    const said = new Set(allHits().map((hit) => hit.file));
    const stale = [...ALLOWED].flatMap(([file, why]) =>
      said.has(file)
        ? []
        : [`STALE ROW  ${file}\n  it says none of the words now, so its reason is spent: ${why}`],
    );
    expect(stale, `\n${stale.join("\n\n")}\n`).toStrictEqual([]);
  });
});
