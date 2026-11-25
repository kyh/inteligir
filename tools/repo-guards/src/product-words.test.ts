import { describe, expect, it } from "vitest";
import { readTextFile, shippedFiles, sourceOf, workspaces } from "./repo";

const SURFACES = [
  "@repo/client",
  "@repo/contract",
  "@repo/desktop",
  "@repo/editor",
  "@repo/extension",
  "@repo/mobile",
  "@repo/service",
  "@repo/ui",
  "@repo/web",
] as const;

const LEGAL_PAGES = ["docs/privacy.md", "docs/terms.md"] as const;

const ALLOWED: ReadonlyMap<string, string> = new Map<string, string>();

interface Word {
  name: string;
  pattern: RegExp;
}

const WORDS: readonly Word[] = [
  { name: "vault", pattern: /\bvaults?\b/iu },
  {
    name: "an engine word",
    pattern: /\b(?:git|commits?|committed(?! to\b)|remotes?|repos?|repository|terminal)\b/iu,
  },
  { name: "an engine word", pattern: /\b(?:CLI|PATH|MCP)\b/u },
];

const LOG_LINE = /\bconsole\.\w+\s*\(/u;

const TRAILING_COMMENT = /\s\/\/\s.*$/u;

const DOUBLE_QUOTED = /"(?<body>(?:[^"\\\n]|\\.)*)"/gu;
const SINGLE_QUOTED = /'(?<body>(?:[^'\\\n]|\\.)*)'/gu;
const TEMPLATE = /`(?<body>(?:[^`\\]|\\.)*)`/gu;

interface SplitTemplate {
  text: string;
  held: string[];
}

const splitTemplate = (body: string) => {
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

  return { held, text } satisfies SplitTemplate;
};

const collect = (pattern: RegExp, line: string, found: string[]) => {
  pattern.lastIndex = 0;

  return line.replaceAll(pattern, (_match, body: string) => {
    found.push(body);

    return " ";
  });
};

const literalsOf = (line: string) => {
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

const jsxTextOf = (line: string) => {
  const trimmed = line.trim();
  const match = /^(?<text>[A-Za-z][^<>{}=;()`"|]*?)\s*(?:\{[^{}]*\})?$/u.exec(trimmed);
  const text = match?.groups?.text;

  if (text === undefined || !/\s/u.test(text) || CODE_LEAD.test(text)) {
    return null;
  }

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

const hitsIn = (file: string, text: string) => {
  for (const word of WORDS) {
    if (word.pattern.test(text)) {
      return [{ file, line: 0, text, word: word.name }] satisfies Hit[];
    }
  }

  return [] satisfies Hit[];
};

const INLINE_JSX_TEXT = />(?<text>[^<>{}=;()`"|]+)</gu;
const TRAILING_JSX_TEXT = />(?<text>[^<>{}=;()`"|]+)$/u;

const inlineJsxTextOf = (line: string) =>
  [...line.matchAll(INLINE_JSX_TEXT), TRAILING_JSX_TEXT.exec(line)].flatMap((match) => {
    const text = match?.groups?.text?.trim() ?? "";

    return /\s/u.test(text) && /^[A-Za-z]/u.test(text) ? [text] : [];
  });

const HTML_ENTITY = /&(?:[A-Za-z]+|#\d+|#x[\da-fA-F]+);/gu;

const LOG_TAGGED = /^\[[\w -]+\]\s/u;

const scanLines = (file: string, lines: readonly string[], jsx: boolean) => {
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

const longTemplateHits = (file: string, lines: readonly string[]) => {
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

const scanScript = (file: string, lines: readonly string[], jsx: boolean) =>
  [...scanLines(file, lines, jsx), ...longTemplateHits(file, lines)] satisfies Hit[];

const scriptHits = (file: string) => {
  const kept = new Set(sourceOf(file).split("\n"));

  const lines = readTextFile(file)
    .split("\n")
    .map((line) => (kept.has(line) ? line : ""));

  return scanScript(file, lines, file.endsWith(".tsx"));
};

const LINK_TARGET = /\]\([^)]*\)/gu;

const markdownHits = (file: string) =>
  readTextFile(file)
    .split("\n")
    .flatMap((line, index) =>
      hitsIn(file, line.replaceAll(LINK_TARGET, "]")).map((hit) => ({ ...hit, line: index + 1 })),
    );

const surfaceFiles = () =>
  workspaces()
    .filter((workspace) => SURFACES.some((name) => name === workspace.name))
    .flatMap((workspace) => shippedFiles(workspace))
    .toSorted();

const allHits = () =>
  [
    ...surfaceFiles().flatMap((file) => scriptHits(file)),
    ...LEGAL_PAGES.flatMap((file) => markdownHits(file)),
  ] satisfies Hit[];

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
