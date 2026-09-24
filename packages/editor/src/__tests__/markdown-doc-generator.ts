// Output is not byte-canonical (toCanonical normalizes it) and avoids opaque
// constructs, so the property test exercises the modelled nodes.

import { ALERT_VARIANTS } from "@repo/editor/markdown/alert-marker";

// oxlint-disable no-bitwise -- mulberry32 is defined in terms of 32-bit word math; the seeded sequence is the point
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
};
// oxlint-enable no-bitwise

type Rng = () => number;

const int = (rng: Rng, n: number): number => Math.floor(rng() * n);
const pick = <T>(rng: Rng, xs: readonly T[]): T => {
  const item = xs[int(rng, xs.length)];
  if (item === undefined) {
    throw new Error("pick from empty array");
  }
  return item;
};
const chance = (rng: Rng, p: number): boolean => rng() < p;

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

const MATH_BODIES = ["E=mc^2", "\\int_0^1 x^2 dx", "a^2 + b^2 = c^2", "x + y = z"];

const words = (rng: Rng, n: number): string =>
  Array.from({ length: n }, () => pick(rng, WORDS)).join(" ");

// no pipe alias, so it can sit in a table cell without `\|` escaping
const wikiLinkPlain = (rng: Rng): string => {
  const target = pick(rng, WIKI_TARGETS);
  return chance(rng, 0.2) ? `![[${target}]]` : `[[${target}]]`;
};

const wikiLink = (rng: Rng): string => {
  const target = pick(rng, WIKI_TARGETS);
  switch (int(rng, 4)) {
    case 0: {
      return `[[${target}]]`;
    }
    case 1: {
      return `[[${target}|${words(rng, 1)}]]`;
    }
    case 2: {
      return `![[${target}]]`;
    }
    default: {
      return `[[${target}#${words(rng, 1)}|${words(rng, 1)}]]`;
    }
  }
};

const INLINE_LEAVES: ((rng: Rng) => string)[] = [
  (rng) => words(rng, 1),
  (rng) => `**${words(rng, 1)}**`,
  (rng) => `_${words(rng, 1)}_`,
  (rng) => `\`${words(rng, 1)}\``,
  (rng) => `**_${words(rng, 1)}_**`,
  (rng) => `_**${words(rng, 1)}**_`,
  (rng) => `**${words(rng, 1)}**_${words(rng, 1)}_`,
  (rng) => `**${words(rng, 1)}** **${words(rng, 1)}**`,
  (rng) => wikiLink(rng),
  (rng) => `_${wikiLink(rng)}_`,
  (rng) => `**${wikiLink(rng)}**`,
  (rng) =>
    `$$${pick(
      rng,
      MATH_BODIES.map((b) => b.split(" ")[0] ?? b),
    )}$$`,
  (rng) => `<date value="2026-07-0${1 + int(rng, 9)}" />`,
];

const inlineText = (rng: Rng, minWords = 3, maxWords = 10): string => {
  const n = minWords + int(rng, maxWords - minWords + 1);
  const parts: string[] = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(chance(rng, 0.4) ? pick(rng, INLINE_LEAVES)(rng) : words(rng, 1));
  }
  return parts.join(" ");
};

const heading = (rng: Rng): string => {
  const level = 1 + int(rng, 6);
  return `${"#".repeat(level)} ${inlineText(rng, 2, 5)}`;
};

const paragraph = (rng: Rng): string => inlineText(rng, 4, 16);

const taskMarker = (rng: Rng): string => (chance(rng, 0.5) ? "- [x] " : "- [ ] ");

const listBlock = (rng: Rng): string => {
  const n = 2 + int(rng, 4);
  const task = chance(rng, 0.4);
  const lines: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const marker = task ? taskMarker(rng) : "- ";
    lines.push(`${marker}${inlineText(rng, 2, 6)}`);
    if (!task && chance(rng, 0.3)) {
      lines.push(`  - ${inlineText(rng, 2, 5)}`);
    }
  }
  return lines.join("\n");
};

const tableRow = (cells: string[]): string => `| ${cells.join(" | ")} |`;

const table = (rng: Rng): string => {
  const cols = 2 + int(rng, 2);
  const rows = 1 + int(rng, 3);
  const cell = () => (chance(rng, 0.2) ? wikiLinkPlain(rng) : words(rng, 1));
  const header = Array.from({ length: cols }, () => words(rng, 1));
  const sep = Array.from({ length: cols }, () => "---");
  const bodyRows = Array.from({ length: rows }, () => Array.from({ length: cols }, cell));
  return [tableRow(header), tableRow(sep), ...bodyRows.map(tableRow)].join("\n");
};

const blockquote = (rng: Rng): string => {
  if (chance(rng, 0.5)) {
    const variant = pick(rng, ALERT_VARIANTS);
    // GitHub reads the marker in any case, so the dialect must round-trip one written lowercase
    const kind = chance(rng, 0.3) ? variant.toLowerCase() : variant;
    return `> [!${kind}]\n> ${inlineText(rng, 3, 8)}`;
  }
  return `> ${inlineText(rng, 3, 8)}`;
};

const codeFence = (rng: Rng): string => {
  if (chance(rng, 0.4)) {
    return "```mermaid\ngraph TD;\nA-->B;\n```";
  }
  const lines = 1 + int(rng, 3);
  const body = Array.from(
    { length: lines },
    () => `const ${pick(rng, WORDS)} = ${int(rng, 100)};`,
  ).join("\n");
  return `\`\`\`\n${body}\n\`\`\``;
};

const mathBlock = (rng: Rng): string => `$$\n${pick(rng, MATH_BODIES)}\n$$`;

const image = (rng: Rng): string => {
  const alt = words(rng, 2);
  const file = `${pick(rng, WORDS)}.png`;
  return chance(rng, 0.5) ? `![${alt}](https://example.com/${file})` : `![${alt}](assets/${file})`;
};

const toggle = (rng: Rng): string => `<toggle>\n  ${inlineText(rng, 3, 8)}\n</toggle>`;

const columns = (rng: Rng): string => {
  const cols = Array.from(
    { length: 2 },
    () => `  <column>\n    ${inlineText(rng, 2, 6)}\n  </column>`,
  );
  return `<column_group>\n${cols.join("\n\n")}\n</column_group>`;
};

const BLOCK_GENERATORS: ((rng: Rng) => string)[] = [
  heading,
  paragraph,
  // weighted: prose dominates real documents
  paragraph,
  listBlock,
  table,
  blockquote,
  codeFence,
  mathBlock,
  image,
  toggle,
  columns,
];

export const generateDoc = (seed: number): string => {
  const rng = mulberry32(seed);
  const n = 5 + int(rng, 36);
  const blocks: string[] = [];
  for (let i = 0; i < n; i += 1) {
    blocks.push(pick(rng, BLOCK_GENERATORS)(rng));
  }
  return `${blocks.join("\n\n")}\n`;
};

const TAGS = ["#field", "#todo", "#idea/draft", "#ref"];

// the dialect's marks inside prose, which only a pass over the whole note would find
const dialectParagraph = (rng: Rng, anchor: number): string => {
  switch (int(rng, 3)) {
    case 0: {
      return `${inlineText(rng, 3, 8)} ${pick(rng, TAGS)} ${inlineText(rng, 2, 6)}`;
    }
    case 1: {
      const a = 1 + int(rng, 9);
      const b = 1 + int(rng, 9);
      return `${inlineText(rng, 3, 8)} {{${String(a)}+${String(b)}|${String(a + b)}}} ${inlineText(rng, 2, 6)}`;
    }
    default: {
      const id = `c${String(anchor)}`;
      return `${inlineText(rng, 2, 5)} %%i:${id}:start%%${words(rng, 3)}%%i:${id}:end%% ${inlineText(rng, 2, 5)}`;
    }
  }
};

const NOTE_BLOCKS: ((rng: Rng) => string)[] = [
  paragraph,
  paragraph,
  paragraph,
  paragraph,
  listBlock,
  listBlock,
  table,
  blockquote,
  codeFence,
  mathBlock,
  image,
  toggle,
  columns,
];

const SECTION_BLOCKS = 6;

const noteBlock = (rng: Rng, index: number): string => {
  if (index % SECTION_BLOCKS === 0) {
    return `## ${inlineText(rng, 2, 5)}`;
  }
  return chance(rng, 0.25) ? dialectParagraph(rng, index) : pick(rng, NOTE_BLOCKS)(rng);
};

const lineCount = (block: string): number => block.split("\n").length;

// A note as one is written: sections of mostly prose under headings, every modelled construct
// turning up now and then, and the dialect's marks inside the prose.
export const generateLongNote = (seed: number, lines: number): string => {
  const rng = mulberry32(seed);
  const blocks = ["---\ntitle: Long note\ntags:\n  - field\n---", "# Long note"];
  let count = blocks.reduce((sum, block) => sum + lineCount(block) + 1, 0);
  while (count < lines) {
    const block = noteBlock(rng, blocks.length);
    blocks.push(block);
    count += lineCount(block) + 1;
  }
  return `${blocks.join("\n\n")}\n`;
};
