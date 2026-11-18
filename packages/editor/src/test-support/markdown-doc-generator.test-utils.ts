import { ALERT_VARIANTS } from "@repo/contract/library/library-nodes";
import { mulberry32, pick } from "@repo/contract/test-support/seeded-random.test-utils";

type Rng = () => number;

const int = (rng: Rng, n: number) => Math.floor(rng() * n);
const chance = (rng: Rng, p: number) => rng() < p;

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

const pageLink = (rng: Rng) => {
  const at = int(rng, WIKI_TARGETS.length);

  return `[${WIKI_TARGETS[at] ?? ""}](mention:0190a000-0000-7000-8000-00000000000${String(at)})`;
};

const MATH_BODIES = ["E=mc^2", "\\int_0^1 x^2 dx", "a^2 + b^2 = c^2", "x + y = z"];

const words = (rng: Rng, n: number) => Array.from({ length: n }, () => pick(rng, WORDS)).join(" ");

const wikiLinkPlain = (rng: Rng) => {
  const target = pick(rng, WIKI_TARGETS);

  return chance(rng, 0.2) ? `![[${target}]]` : pageLink(rng);
};

const wikiLink = (rng: Rng) => {
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
      return pageLink(rng);
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
  (rng) => `:date[2026-07-0${String(1 + int(rng, 9))}]`,
  (rng) => `~~${words(rng, 1)}~~`,
];

const inlineText = (rng: Rng, minWords = 3, maxWords = 10) => {
  const n = minWords + int(rng, maxWords - minWords + 1);
  const parts: string[] = [];

  for (let i = 0; i < n; i += 1) {
    parts.push(chance(rng, 0.4) ? pick(rng, INLINE_LEAVES)(rng) : words(rng, 1));
  }

  return parts.join(" ");
};

const heading = (rng: Rng) => {
  const level = 1 + int(rng, 6);

  return `${"#".repeat(level)} ${inlineText(rng, 2, 5)}`;
};

const paragraph = (rng: Rng) => inlineText(rng, 4, 16);

const taskMarker = (rng: Rng) => (chance(rng, 0.5) ? "- [x] " : "- [ ] ");

const listBlock = (rng: Rng) => {
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

const tableRow = (cells: string[]) => `| ${cells.join(" | ")} |`;

const table = (rng: Rng) => {
  const cols = 2 + int(rng, 2);
  const rows = 1 + int(rng, 3);
  const cell = () => (chance(rng, 0.2) ? wikiLinkPlain(rng) : words(rng, 1));
  const header = Array.from({ length: cols }, () => words(rng, 1));
  const sep = Array.from({ length: cols }, () => "---");
  const bodyRows = Array.from({ length: rows }, () => Array.from({ length: cols }, cell));

  return [tableRow(header), tableRow(sep), ...bodyRows.map(tableRow)].join("\n");
};

const blockquote = (rng: Rng) => {
  if (chance(rng, 0.5)) {
    const variant = pick(rng, ALERT_VARIANTS);
    const kind = chance(rng, 0.3) ? variant.toLowerCase() : variant;

    return `> [!${kind}]\n> ${inlineText(rng, 3, 8)}`;
  }

  return `> ${inlineText(rng, 3, 8)}`;
};

const codeFence = (rng: Rng) => {
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

const mathBlock = (rng: Rng) => `$$\n${pick(rng, MATH_BODIES)}\n$$`;

const image = (rng: Rng) => {
  const alt = words(rng, 2);
  const file = `${pick(rng, WORDS)}.png`;

  return chance(rng, 0.5) ? `![${alt}](https://example.com/${file})` : `![${alt}](assets/${file})`;
};

const toggle = (rng: Rng) => `:::toggle\n${inlineText(rng, 3, 8)}\n:::`;

const columns = (rng: Rng) => {
  const cols = Array.from({ length: 2 }, () => `:::column\n${inlineText(rng, 2, 6)}\n:::`);

  return `::::columns\n${cols.join("\n\n")}\n::::`;
};

const tabs = (rng: Rng) => {
  const panels = Array.from(
    { length: 2 },
    () => `:::tab[${words(rng, 1)}]\n${inlineText(rng, 2, 6)}\n:::`,
  );

  return `::::tabs\n${panels.join("\n\n")}\n::::`;
};

const BLOCK_GENERATORS: ((rng: Rng) => string)[] = [
  heading,
  paragraph,
  paragraph,
  listBlock,
  table,
  blockquote,
  codeFence,
  mathBlock,
  image,
  toggle,
  columns,
  tabs,
];

export const generateDoc = (seed: number) => {
  const rng = mulberry32(seed);
  const n = 5 + int(rng, 36);
  const blocks: string[] = [];

  for (let i = 0; i < n; i += 1) {
    blocks.push(pick(rng, BLOCK_GENERATORS)(rng));
  }

  return `${blocks.join("\n\n")}\n`;
};

const TAGS = ["#field", "#todo", "#idea/draft", "#ref"];

const dialectParagraph = (rng: Rng) => {
  if (chance(rng, 0.5)) {
    return `${inlineText(rng, 3, 8)} ${pick(rng, TAGS)} ${inlineText(rng, 2, 6)}`;
  }

  const a = 1 + int(rng, 9);
  const b = 1 + int(rng, 9);
  const formula = `:formula[${String(a + b)}]{source="${String(a)}+${String(b)}"}`;

  return `${inlineText(rng, 3, 8)} ${formula} ${inlineText(rng, 2, 6)}`;
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
  tabs,
];

const SECTION_BLOCKS = 6;

const noteBlock = (rng: Rng, index: number) => {
  if (index % SECTION_BLOCKS === 0) {
    return `## ${inlineText(rng, 2, 5)}`;
  }

  return chance(rng, 0.25) ? dialectParagraph(rng) : pick(rng, NOTE_BLOCKS)(rng);
};

const lineCount = (block: string) => block.split("\n").length;

export const generateLongNote = (seed: number, lines: number) => {
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
