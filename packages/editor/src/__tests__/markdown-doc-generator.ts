// Deterministic seeded document generator over the app's modelled constructs
// (headings, marks, lists, tables, blockquotes/alerts, code fences, math,
// wiki-links, images, toggles, columns) — the property test's source of
// "arbitrary but legal" documents. Test-only; the header of
// markdown-roundtrip-property.test.ts carries the rationale + seed contract.
//
// The generator does NOT aim to produce byte-canonical markdown (padding,
// exact list markers, etc.) — `toCanonical` normalizes whatever it produces.
// It stays clear of opaque constructs (unknown JSX, expressions, HTML) so the
// property test exercises the MODELLED nodes; those are pinned by the fixture
// matrix and markdown-pipeline.test.ts instead.

// Tiny seeded PRNG (mulberry32) — deterministic, no dependency.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

function int(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}
function pick<T>(rng: Rng, xs: readonly T[]): T {
  const item = xs[int(rng, xs.length)];
  if (item === undefined) throw new Error("pick from empty array");
  return item;
}
function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

const WORDS = [
  "alpha",
  "bravo",
  "charlie",
  "delta",
  "echo",
  "foxtrot",
  "golf",
  "hotel",
  "india",
  "juliet",
  "kilo",
  "lima",
  "mike",
  "november",
  "oscar",
  "papa",
  "quebec",
  "romeo",
  "sierra",
  "tango",
  "uniform",
  "victor",
  "whiskey",
  "yankee",
  "zulu",
];

const WIKI_TARGETS = ["Alpha Note", "Some Note", "Other", "Project X", "Hub"];

const ALERT_KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

const MATH_BODIES = ["E=mc^2", "\\int_0^1 x^2 dx", "a^2 + b^2 = c^2", "x + y = z"];

function words(rng: Rng, n: number): string {
  return Array.from({ length: n }, () => pick(rng, WORDS)).join(" ");
}

// A wiki-link/embed with NO pipe alias — safe to drop inside a GFM table cell
// without needing `\|` escaping (the generator's choice, not a vocabulary
// limit: markdown-adversarial.test.ts already covers escaped-pipe cells).
function wikiLinkPlain(rng: Rng): string {
  const target = pick(rng, WIKI_TARGETS);
  return chance(rng, 0.2) ? `![[${target}]]` : `[[${target}]]`;
}

// Every wiki-link shape the vocabulary supports: plain, alias, section+alias,
// transclusion.
function wikiLink(rng: Rng): string {
  const target = pick(rng, WIKI_TARGETS);
  switch (int(rng, 4)) {
    case 0:
      return `[[${target}]]`;
    case 1:
      return `[[${target}|${words(rng, 1)}]]`;
    case 2:
      return `![[${target}]]`;
    default:
      return `[[${target}#${words(rng, 1)}|${words(rng, 1)}]]`;
  }
}

// Leaf inline generators — the classic serializer killers: adjacent marks,
// nested marks, marks wrapping a wiki-link, inline math, date chips.
const INLINE_LEAVES: Array<(rng: Rng) => string> = [
  (rng) => words(rng, 1),
  (rng) => `**${words(rng, 1)}**`,
  (rng) => `_${words(rng, 1)}_`,
  (rng) => `\`${words(rng, 1)}\``,
  (rng) => `**_${words(rng, 1)}_**`, // nested bold+italic
  (rng) => `_**${words(rng, 1)}**_`, // nested italic+bold
  (rng) => `**${words(rng, 1)}**_${words(rng, 1)}_`, // adjacent, no separating space
  (rng) => `**${words(rng, 1)}** **${words(rng, 1)}**`, // adjacent bold, separated
  (rng) => wikiLink(rng),
  (rng) => `_${wikiLink(rng)}_`, // marked wiki-link
  (rng) => `**${wikiLink(rng)}**`,
  (rng) =>
    `$$${pick(
      rng,
      MATH_BODIES.map((b) => b.split(" ")[0] ?? b),
    )}$$`, // inline math
  (rng) => `<date value="2026-07-0${1 + int(rng, 9)}" />`,
];

function inlineText(rng: Rng, minWords = 3, maxWords = 10): string {
  const n = minWords + int(rng, maxWords - minWords + 1);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(chance(rng, 0.4) ? pick(rng, INLINE_LEAVES)(rng) : words(rng, 1));
  }
  return parts.join(" ");
}

// --- block generators -----------------------------------------------------

function heading(rng: Rng): string {
  const level = 1 + int(rng, 6);
  return `${"#".repeat(level)} ${inlineText(rng, 2, 5)}`;
}

function paragraph(rng: Rng): string {
  return inlineText(rng, 4, 16);
}

function listBlock(rng: Rng): string {
  const n = 2 + int(rng, 4);
  const task = chance(rng, 0.4);
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const marker = task ? (chance(rng, 0.5) ? "- [x] " : "- [ ] ") : "- ";
    lines.push(`${marker}${inlineText(rng, 2, 6)}`);
    if (!task && chance(rng, 0.3)) {
      // nested sub-item
      lines.push(`  - ${inlineText(rng, 2, 5)}`);
    }
  }
  return lines.join("\n");
}

function tableRow(cells: string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function table(rng: Rng): string {
  const cols = 2 + int(rng, 2);
  const rows = 1 + int(rng, 3);
  const cell = () => (chance(rng, 0.2) ? wikiLinkPlain(rng) : words(rng, 1));
  const header = Array.from({ length: cols }, () => words(rng, 1));
  const sep = Array.from({ length: cols }, () => "---");
  const bodyRows = Array.from({ length: rows }, () => Array.from({ length: cols }, cell));
  return [tableRow(header), tableRow(sep), ...bodyRows.map(tableRow)].join("\n");
}

function blockquote(rng: Rng): string {
  if (chance(rng, 0.5)) {
    const kind = pick(rng, ALERT_KINDS);
    return `> [!${kind}]\n> ${inlineText(rng, 3, 8)}`;
  }
  return `> ${inlineText(rng, 3, 8)}`;
}

function codeFence(rng: Rng): string {
  if (chance(rng, 0.4)) return "```mermaid\ngraph TD;\nA-->B;\n```";
  const lines = 1 + int(rng, 3);
  const body = Array.from(
    { length: lines },
    () => `const ${pick(rng, WORDS)} = ${int(rng, 100)};`,
  ).join("\n");
  return `\`\`\`\n${body}\n\`\`\``;
}

function mathBlock(rng: Rng): string {
  return `$$\n${pick(rng, MATH_BODIES)}\n$$`;
}

function image(rng: Rng): string {
  const alt = words(rng, 2);
  const file = `${pick(rng, WORDS)}.png`;
  return chance(rng, 0.5) ? `![${alt}](https://example.com/${file})` : `![${alt}](assets/${file})`;
}

function toggle(rng: Rng): string {
  return `<toggle>\n  ${inlineText(rng, 3, 8)}\n</toggle>`;
}

function columns(rng: Rng): string {
  const cols = Array.from(
    { length: 2 },
    () => `  <column>\n    ${inlineText(rng, 2, 6)}\n  </column>`,
  );
  return `<column_group>\n${cols.join("\n\n")}\n</column_group>`;
}

const BLOCK_GENERATORS: Array<(rng: Rng) => string> = [
  heading,
  paragraph,
  paragraph, // weighted — prose dominates real documents
  listBlock,
  table,
  blockquote,
  codeFence,
  mathBlock,
  image,
  toggle,
  columns,
];

/** Generate a ~5-40 block vocabulary-legal document for seed `seed`. */
export function generateDoc(seed: number): string {
  const rng = mulberry32(seed);
  const n = 5 + int(rng, 36);
  const blocks: string[] = [];
  for (let i = 0; i < n; i++) blocks.push(pick(rng, BLOCK_GENERATORS)(rng));
  return `${blocks.join("\n\n")}\n`;
}
