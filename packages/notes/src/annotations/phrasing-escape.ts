// A line of text escaped as the editor's serializer escapes a text node between two annotation
// markers in a quote's paragraph, so a highlight written under `## Highlights` reads back as the
// text it quotes and nothing else: a hostile page's `[x](y)`, `<b>`, `{{1}}` or `%%i:…%%` stays
// text. This is mdast-util-to-markdown's `safe` (2.2) over the dialect processor's own unsafe
// patterns; this package exports no stringify of a text node, and the phone's runtime loads no
// serializer, so its algorithm is restated here and held to the editor's output by
// `apps/cli/src/workspace/place-quotes-roundtrip.test.ts`.

import { z } from "zod";

import { MD_PROCESSOR } from "../markdown/md-plugins";

// a construct list, one name or several, read as a list
const constructListSchema = z
  .union([z.string().transform((name) => [name]), z.array(z.string())])
  .optional();
const unsafePatternSchema = z.looseObject({
  after: z.string().optional(),
  afterNode: constructListSchema,
  atBreak: z.boolean().optional(),
  before: z.string().optional(),
  beforeNode: constructListSchema,
  character: z.string(),
  inConstruct: constructListSchema,
  notInConstruct: constructListSchema,
});
type UnsafePattern = z.infer<typeof unsafePatternSchema>;

const FULL_PHRASING_SPANS = [
  "autolink",
  "destinationLiteral",
  "destinationRaw",
  "reference",
  "titleQuote",
  "titleApostrophe",
];
const CODE_FENCE_INFO = [
  "codeFencedLangGraveAccent",
  "codeFencedLangTilde",
  "codeFencedMetaGraveAccent",
  "codeFencedMetaTilde",
  "destinationLiteral",
  "headingAtx",
];

// mdast-util-to-markdown 2.2's own list (lib/unsafe.js), before any extension's
const DEFAULT_UNSAFE: readonly UnsafePattern[] = z.array(unsafePatternSchema).parse([
  { after: String.raw`[\r\n]`, character: "\t", inConstruct: "phrasing" },
  { before: String.raw`[\r\n]`, character: "\t", inConstruct: "phrasing" },
  { character: "\t", inConstruct: ["codeFencedLangGraveAccent", "codeFencedLangTilde"] },
  { character: "\r", inConstruct: CODE_FENCE_INFO },
  { character: "\n", inConstruct: CODE_FENCE_INFO },
  { before: String.raw`[\r\n]`, character: "\r", inConstruct: "phrasing" },
  { after: String.raw`\r`, character: "\r", inConstruct: "phrasing" },
  { before: String.raw`\n`, character: "\n", inConstruct: "phrasing" },
  { after: String.raw`[\r\n]`, character: "\n", inConstruct: "phrasing" },
  { after: String.raw`[\r\n]`, character: " ", inConstruct: "phrasing" },
  { before: String.raw`[\r\n]`, character: " ", inConstruct: "phrasing" },
  { character: " ", inConstruct: ["codeFencedLangGraveAccent", "codeFencedLangTilde"] },
  {
    after: String.raw`\[`,
    character: "!",
    inConstruct: "phrasing",
    notInConstruct: FULL_PHRASING_SPANS,
  },
  { character: '"', inConstruct: "titleQuote" },
  { atBreak: true, character: "#" },
  { after: "(?:[\r\n]|$)", character: "#", inConstruct: "headingAtx" },
  { after: "[#A-Za-z]", character: "&", inConstruct: "phrasing" },
  { character: "'", inConstruct: "titleApostrophe" },
  { character: "(", inConstruct: "destinationRaw" },
  {
    before: String.raw`\]`,
    character: "(",
    inConstruct: "phrasing",
    notInConstruct: FULL_PHRASING_SPANS,
  },
  { atBreak: true, before: String.raw`\d+`, character: ")" },
  { character: ")", inConstruct: "destinationRaw" },
  { after: "(?:[ \t\r\n*])", atBreak: true, character: "*" },
  { character: "*", inConstruct: "phrasing", notInConstruct: FULL_PHRASING_SPANS },
  { after: "(?:[ \t\r\n])", atBreak: true, character: "+" },
  { after: "(?:[ \t\r\n-])", atBreak: true, character: "-" },
  { after: "(?:[ \t\r\n]|$)", atBreak: true, before: String.raw`\d+`, character: "." },
  { after: "[!/?A-Za-z]", atBreak: true, character: "<" },
  {
    after: "[!/?A-Za-z]",
    character: "<",
    inConstruct: "phrasing",
    notInConstruct: FULL_PHRASING_SPANS,
  },
  { character: "<", inConstruct: "destinationLiteral" },
  { atBreak: true, character: "=" },
  { atBreak: true, character: ">" },
  { character: ">", inConstruct: "destinationLiteral" },
  { atBreak: true, character: "[" },
  { character: "[", inConstruct: "phrasing", notInConstruct: FULL_PHRASING_SPANS },
  { character: "[", inConstruct: ["label", "reference"] },
  { after: String.raw`[\r\n]`, character: "\\", inConstruct: "phrasing" },
  { character: "]", inConstruct: ["label", "reference"] },
  { atBreak: true, character: "_" },
  { character: "_", inConstruct: "phrasing", notInConstruct: FULL_PHRASING_SPANS },
  { atBreak: true, character: "`" },
  { character: "`", inConstruct: ["codeFencedLangGraveAccent", "codeFencedMetaGraveAccent"] },
  { character: "`", inConstruct: "phrasing", notInConstruct: FULL_PHRASING_SPANS },
  { atBreak: true, character: "~" },
]);

// a serializer extension as the serializer's `configure` merges it: its own patterns, then its
// nested extensions'
interface SerializerExtension {
  extensions?: SerializerExtension[] | undefined;
  unsafe?: UnsafePattern[] | undefined;
}
const serializerExtensionSchema: z.ZodType<SerializerExtension> = z.lazy(() =>
  z.looseObject({
    extensions: z.array(serializerExtensionSchema).optional(),
    unsafe: z.array(unsafePatternSchema).optional(),
  }),
);

const extensionPatterns = (extension: SerializerExtension): UnsafePattern[] => [
  ...(extension.unsafe ?? []),
  ...(extension.extensions ?? []).flatMap(extensionPatterns),
];

const inScope = (stack: readonly string[], list: readonly string[] | undefined, none: boolean) =>
  list === undefined || list.length === 0 ? none : list.some((item) => stack.includes(item));

const SPECIAL = /[$()*+.?[\\\]^{|}]/u;

const compile = (pattern: UnsafePattern): RegExp => {
  const before =
    (pattern.atBreak === true ? "[\\r\\n][\\t ]*" : "") +
    (pattern.before === undefined ? "" : `(?:${pattern.before})`);
  const head = before === "" ? "" : `(${before})`;
  const character = (SPECIAL.test(pattern.character) ? "\\" : "") + pattern.character;
  const tail = pattern.after === undefined ? "" : `(?:${pattern.after})`;
  return new RegExp(`${head}${character}${tail}`, "gu");
};

// the paragraph's text between two markers, inside a blockquote: no node pattern applies
const STACK = ["blockquote", "paragraph", "phrasing"];
const ESCAPABLE = /[!-/:-@[-`{-~]/u;
const PUNCTUATION = /\p{P}|\p{S}/u;

let compiledPatterns: { pattern: UnsafePattern; expression: RegExp }[] | null = null;

const patternsInScope = (): { pattern: UnsafePattern; expression: RegExp }[] => {
  compiledPatterns ??= [
    ...DEFAULT_UNSAFE,
    ...z
      .array(serializerExtensionSchema)
      .parse(MD_PROCESSOR.data("toMarkdownExtensions") ?? [])
      .flatMap(extensionPatterns),
  ]
    .filter(
      (pattern) =>
        inScope(STACK, pattern.inConstruct, true) &&
        !inScope(STACK, pattern.notInConstruct, false) &&
        pattern.beforeNode === undefined &&
        pattern.afterNode === undefined,
    )
    .map((pattern) => ({ expression: compile(pattern), pattern }));
  return compiledPatterns;
};

// micromark's classifyCharacter: 1 whitespace (or no character), 2 punctuation, else nothing
const classify = (character: string): 1 | 2 | undefined => {
  if (character === "" || /\s/u.test(character)) {
    return 1;
  }
  return PUNCTUATION.test(character) ? 2 : undefined;
};

const escapeBackslashes = (value: string, after: string): string => {
  const whole = value + after;
  let result = "";
  let start = 0;
  for (const match of whole.matchAll(/\\(?=[!-/:-@[-`{-~])/gu)) {
    if (match.index >= value.length) {
      break;
    }
    result += `${value.slice(start, match.index)}\\`;
    start = match.index;
  }
  return result + value.slice(start);
};

interface Info {
  before: boolean;
  after: boolean;
}

// where the value holds a character some pattern says to escape, and on what condition
interface UnsafeScan {
  positions: number[];
  infos: Map<number, Info>;
}

const unsafePositions = (value: string): UnsafeScan => {
  const positions: number[] = [];
  const infos = new Map<number, Info>();
  for (const { pattern, expression } of patternsInScope()) {
    expression.lastIndex = 0;
    for (const match of value.matchAll(expression)) {
      const before = pattern.before !== undefined || pattern.atBreak === true;
      const after = pattern.after !== undefined;
      const position = match.index + (before ? (match[1] ?? "").length : 0);
      const known = infos.get(position);
      if (known === undefined) {
        positions.push(position);
        infos.set(position, { after, before });
      } else {
        known.before &&= before;
        known.after &&= after;
      }
    }
  }
  positions.sort((a, b) => a - b);
  return { infos, positions };
};

// the escape's view of one value: the unsafe positions, and where the text sits between its context
interface Scan {
  positions: readonly number[];
  infos: ReadonlyMap<number, Info>;
  offset: number;
  end: number;
}

// an intraword run of underscores (`a_b`) cannot form emphasis, so it stays as written
const intrawordUnderscores = (value: string, index: number, scan: Scan): number => {
  const position = scan.positions[index] ?? -1;
  if (
    value.charAt(position) !== "_" ||
    position <= 0 ||
    classify(value.charAt(position - 1)) !== undefined ||
    scan.infos.has(position - 1) ||
    (position - 1 === scan.offset && /[*_]/u.test(value.charAt(scan.offset - 1)))
  ) {
    return -1;
  }
  let sequenceEnd = position + 1;
  while (sequenceEnd < scan.end && value.charAt(sequenceEnd) === "_") {
    sequenceEnd += 1;
  }
  const skip = sequenceEnd - position - 1;
  const intraword =
    scan.positions[index + skip] === sequenceEnd - 1 &&
    sequenceEnd < value.length &&
    classify(value.charAt(sequenceEnd)) === undefined &&
    !scan.infos.has(sequenceEnd) &&
    !(sequenceEnd === scan.end - 1 && /[*_]/u.test(value.charAt(scan.end)));
  return intraword ? skip : -1;
};

// a character escaped only for what follows (or precedes) it, when that neighbor is escaped anyway
const coveredByNeighbor = (scan: Scan, index: number): boolean => {
  const position = scan.positions[index] ?? -1;
  const info = scan.infos.get(position);
  const next = scan.infos.get(position + 1);
  const previous = scan.infos.get(position - 1);
  const byNext =
    position + 1 < scan.end &&
    scan.positions[index + 1] === position + 1 &&
    info?.after === true &&
    next !== undefined &&
    !next.before &&
    !next.after;
  const byPrevious =
    scan.positions[index - 1] === position - 1 &&
    info?.before === true &&
    previous !== undefined &&
    !previous.before &&
    !previous.after;
  return byNext || byPrevious;
};

// `text`, written between characters `before` and `after`
export const escapePhrasingText = (text: string, context: { before: string; after: string }) => {
  const value = context.before + text + context.after;
  const offset = context.before.length;
  const end = value.length - context.after.length;
  const { positions, infos } = unsafePositions(value);
  const scan: Scan = { end, infos, offset, positions };
  let result = "";
  let start = offset;
  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index] ?? -1;
    const info = infos.get(position);
    if (position < start || position >= end || info === undefined) {
      continue;
    }
    const skip = intrawordUnderscores(value, index, scan);
    if (skip !== -1) {
      index += skip;
      continue;
    }
    if (coveredByNeighbor(scan, index)) {
      continue;
    }
    if (start !== position) {
      result += escapeBackslashes(value.slice(start, position), "\\");
    }
    start = position;
    if (ESCAPABLE.test(value.charAt(position))) {
      result += "\\";
    } else {
      result += `&#x${(value.codePointAt(position) ?? 0).toString(16).toUpperCase()};`;
      start += 1;
    }
  }
  return result + escapeBackslashes(value.slice(start, end), context.after);
};
