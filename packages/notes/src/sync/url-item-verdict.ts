// Two versions of one saved link settle on one text, whichever device asks: when both carry the
// same url key and at least one changed the fill since their base, the fill that wins comes from a
// total order, and the other side's edits since base are carried onto it. reconcile-file asks it
// before its line merge, and the editor's merges ask mergeItemTexts, so the sync, the phone's
// queue and an open item's save all land the same bytes.
//
// Every rule is phrased by role (the winner and the loser, the filler and the editor), never by
// which side is `mine`, and every diff3 runs in one orientation per role, so the two devices that
// meet one pair compute one text.

import { bodyOf, withBody } from "../items/item-body";
import { readItemFacts, replaceItemYaml } from "../items/item-frontmatter";
import type { ItemFacts } from "../items/item-frontmatter";
import { FILL_OWNED_KEYS, ITEM_KEYS, URL_ITEM_KINDS } from "../items/item-kind";
import type { ItemKind } from "../items/item-kind";
import { addFrontmatterTags, removeFrontmatterTags } from "../items/item-tags";
import {
  frontmatterYaml,
  parseProperties,
  replaceTopLevelKey,
  TAGS_KEY,
  topLevelKeyRange,
  yamlScalarText,
  yamlStringEntries,
} from "../markdown/frontmatter";
import type { TypedProperty } from "../markdown/frontmatter";
import { diff3 } from "../text/diff3";
import type { Diff3Result } from "../text/diff3";
import { splitLines } from "../text/source-lines";

export interface ItemTexts {
  // null: no common version
  readonly base: string | null;
  readonly mine: string;
  readonly theirs: string;
}

interface Side {
  readonly text: string;
  readonly yaml: string;
  readonly lines: readonly string[];
  readonly keys: readonly string[];
  readonly facts: ItemFacts;
  // `fetched` as written, or null when the side has none (unfetched)
  readonly mark: string | null;
  readonly body: string;
}

const ALIASES_KEY = "aliases";

// the keys a carry never moves one at a time: the fill's, `url` and `saved` (written once),
// `id`, and the two lists, which merge by entry
const NOT_CARRIED = new Set<string>([...ITEM_KEYS, "id", TAGS_KEY, ALIASES_KEY]);

// a url item, or a link a fill turned into an image or a PDF (which keeps its url)
const SETTLING_KINDS = new Set<ItemKind>([...URL_ITEM_KINDS, "image", "pdf"]);

// topLevelKeyRange builds its pattern from the key, so a person's own key is spelled literally
// (a `-` stays bare: the pattern is a unicode one, where `\-` is no escape)
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/gu;
const keyPattern = (key: string): string => key.replaceAll(REGEX_SPECIAL, String.raw`\$&`);

const markOf = (prop: TypedProperty | undefined): string | null => {
  if (prop === undefined) {
    return null;
  }
  let written: string;
  if (prop.type === "unsupported") {
    written = prop.rawYaml;
  } else if (prop.type === "tags") {
    written = prop.value.join(", ");
  } else {
    written = String(prop.value);
  }
  const trimmed = written.trim();
  return trimmed === "" ? null : trimmed;
};

const readSide = (text: string): Side | null => {
  const yaml = frontmatterYaml(text);
  if (yaml === null) {
    return null;
  }
  const parsed = parseProperties(yaml);
  if (parsed.kind !== "valid") {
    return null;
  }
  return {
    body: bodyOf(text),
    facts: readItemFacts(parsed),
    keys: parsed.properties.map((prop) => prop.key),
    lines: splitLines(yaml),
    mark: markOf(parsed.properties.find((prop) => prop.key === "fetched")),
    text,
    yaml,
  };
};

const settles = (side: Side): boolean =>
  side.facts.urlKey !== null && SETTLING_KINDS.has(side.facts.kind);

// a key's own lines, or null when the block does not hold it
const keyLines = (lines: readonly string[], key: string): readonly string[] | null => {
  const range = topLevelKeyRange(lines, keyPattern(key));
  return range === null ? null : lines.slice(range.start, range.end);
};

const sameLines = (a: readonly string[] | null, b: readonly string[] | null): boolean => {
  if (a === null || b === null) {
    return a === b;
  }
  return a.length === b.length && a.every((line, i) => line === b[i]);
};

const sameKey = (a: Side, b: Side, key: string): boolean =>
  sameLines(keyLines(a.lines, key), keyLines(b.lines, key));

// where a key the block lacks goes: an item key in its compose position, as the fill writes it
// (after the nearest present key before it, else before the nearest one after it, else after
// `id:`); any other key last
const ITEM_KEY_ORDER: readonly string[] = ITEM_KEYS;

const insertionAt = (lines: readonly string[], key: string): number => {
  const at = ITEM_KEY_ORDER.indexOf(key);
  if (at === -1) {
    return lines.length;
  }
  for (const before of ITEM_KEYS.slice(0, at).toReversed()) {
    const range = topLevelKeyRange(lines, before);
    if (range !== null) {
      return range.end;
    }
  }
  for (const after of ITEM_KEYS.slice(at + 1)) {
    const range = topLevelKeyRange(lines, after);
    if (range !== null) {
      return range.start;
    }
  }
  return topLevelKeyRange(lines, "id")?.end ?? 0;
};

// the top-level key line cut: the key's lines replaced, removed (null) or added
const withKeyLines = (
  lines: readonly string[],
  key: string,
  value: readonly string[] | null,
): string[] => {
  const pattern = keyPattern(key);
  const range = topLevelKeyRange(lines, pattern);
  if (value === null) {
    return range === null ? [...lines] : replaceTopLevelKey(lines, pattern, []);
  }
  if (range !== null) {
    return replaceTopLevelKey(lines, pattern, value);
  }
  const at = key === "id" ? 0 : insertionAt(lines, key);
  return [...lines.slice(0, at), ...value, ...lines.slice(at)];
};

// a side's mark against the base's; with no base, every side changed the fill
const changedFill = (side: Side, base: Side | null): boolean =>
  base === null || side.mark !== base.mark;

const LATEST = Number.POSITIVE_INFINITY;

const compareNumbers = (a: number, b: number): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const compareTexts = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

// the total order case (A) picks its winner by: a fetched side first, then the earlier fetch
// (by time, then as written), then the earlier save, then the smaller text; negative: a wins
const beats = (a: Side, b: Side): number => {
  if ((a.mark === null) !== (b.mark === null)) {
    return a.mark === null ? 1 : -1;
  }
  if (a.mark !== null && b.mark !== null) {
    const byTime = compareNumbers(a.facts.fetchedMs ?? LATEST, b.facts.fetchedMs ?? LATEST);
    if (byTime !== 0) {
      return byTime;
    }
    const byMark = compareTexts(a.mark, b.mark);
    if (byMark !== 0) {
      return byMark;
    }
  }
  const bySave = compareNumbers(a.facts.savedMs ?? LATEST, b.facts.savedMs ?? LATEST);
  return bySave === 0 ? compareTexts(a.text, b.text) : bySave;
};

// `saved` is the earlier of the two, so a link keeps the first time anyone saved it
const withEarlierSaved = (lines: readonly string[], start: Side, other: Side): string[] =>
  (other.facts.savedMs ?? LATEST) < (start.facts.savedMs ?? LATEST)
    ? withKeyLines(lines, "saved", keyLines(other.lines, "saved"))
    : [...lines];

// the start's id, or the other's when the start carries none
const withAdoptedId = (lines: readonly string[], start: Side, other: Side): string[] => {
  const id = keyLines(other.lines, "id");
  return start.facts.hasId || !other.facts.hasId || id === null
    ? [...lines]
    : withKeyLines(lines, "id", id);
};

// every other key the carrier changed since base (with no base: the ones the start lacks) takes
// the carrier's value, through the line cut
const withCarriedKeys = (lines: readonly string[], carrier: Side, base: Side | null): string[] => {
  let next = [...lines];
  const keys = new Set([...carrier.keys, ...(base?.keys ?? [])]);
  for (const key of keys) {
    if (NOT_CARRIED.has(key)) {
      continue;
    }
    const changed = base === null ? keyLines(next, key) === null : !sameKey(carrier, base, key);
    if (changed) {
      next = withKeyLines(next, key, keyLines(carrier.lines, key));
    }
  }
  return next;
};

// `#a` and `a` name one tag, in any case; an alias is a name, in any case
const entryKey = (written: string): string =>
  (written.startsWith("#") ? written.slice(1) : written).trim().toLowerCase();

const entriesOf = (side: Side, key: string): string[] =>
  yamlStringEntries(side.yaml, key).map((entry) => entry.value);

interface ListEdit {
  readonly added: string[];
  readonly removed: string[];
}

// what the carrier added to a list and removed from it since base; with no base, all it lists
// counts as added
const listEdit = (carrier: Side, base: Side | null, key: string): ListEdit => {
  const held = entriesOf(carrier, key);
  if (base === null) {
    return { added: held, removed: [] };
  }
  const was = entriesOf(base, key);
  const wasKeys = new Set(was.map(entryKey));
  const heldKeys = new Set(held.map(entryKey));
  return {
    added: held.filter((entry) => !wasKeys.has(entryKey(entry))),
    removed: was.filter((entry) => !heldKeys.has(entryKey(entry))),
  };
};

// the start's aliases with the carrier's edits applied, rewritten as a block list only when they
// change
const withCarriedAliases = (
  lines: readonly string[],
  start: Side,
  carrier: Side,
  base: Side | null,
): string[] => {
  const { added, removed } = listEdit(carrier, base, ALIASES_KEY);
  const held = entriesOf(start, ALIASES_KEY);
  const gone = new Set(removed.map(entryKey));
  const kept = held.filter((alias) => !gone.has(entryKey(alias)));
  const keptKeys = new Set(kept.map(entryKey));
  const fresh = added.filter((alias) => !keptKeys.has(entryKey(alias)));
  if (fresh.length === 0 && kept.length === held.length) {
    return [...lines];
  }
  const aliases = [...kept, ...fresh];
  const spelled = aliases.map((alias) => `  - ${yamlScalarText(alias, "plain", "block")}`);
  return withKeyLines(
    lines,
    ALIASES_KEY,
    aliases.length === 0 ? null : [`${ALIASES_KEY}:`, ...spelled],
  );
};

// the start's tags with the carrier's edits since base applied, through the splice helpers
const withCarriedTags = (content: string, carrier: Side, base: Side | null): string | null => {
  const { added, removed } = listEdit(carrier, base, TAGS_KEY);
  const pruned = removeFrontmatterTags(content, removed).content;
  return pruned === null ? null : addFrontmatterTags(pruned, added);
};

// where `block` stands as whole lines in `text`, or -1
const blockAt = (text: string, block: string): number => {
  let from = 0;
  for (;;) {
    const at = text.indexOf(block, from);
    if (at === -1) {
      return -1;
    }
    const end = at + block.length;
    const startsLine = at === 0 || text[at - 1] === "\n";
    const endsLine = end === text.length || text[end] === "\n" || text[end] === "\r";
    if (startsLine && endsLine) {
      return at;
    }
    from = at + 1;
  }
};

const LEADING_LINES = /^(?:[ \t]*\r?\n)+/u;
const TRAILING_LINES = /(?:\r?\n[ \t]*)+$/u;

// the parts a paragraph apart, ending with one line break
const joinParts = (before: string, part: string, after: string): string => {
  const joined = [before.replace(TRAILING_LINES, ""), part, after.replace(LEADING_LINES, "")]
    .filter((piece) => piece !== "")
    .join("\n\n");
  if (joined === "") {
    return "";
  }
  return joined.endsWith("\n") ? joined : `${joined}\n`;
};

const EMBED_LINE = /^!\[[^\]\n]*\]\([^\n]*\)$/u;
const BLANK_LINE = /\r?\n[ \t]*\r?\n/u;

// The body a stub's text goes into: in place of the copy of the base's stub text the fill
// carried (found as whole lines), else right after the first block when that is the cover (or the
// file's embed), else first; after the whole of an unfetched body, which is a stub's own note.
// Never twice.
const placeBody = (
  into: string,
  baseBody: string | null,
  body: string,
  fetched: boolean,
): string => {
  const placed = body.trim();
  const held = baseBody?.trim() ?? "";
  if (held !== "") {
    const at = blockAt(into, held);
    if (at !== -1) {
      return joinParts(into.slice(0, at), placed, into.slice(at + held.length));
    }
  }
  if (placed === "" || blockAt(into, placed) !== -1) {
    return into;
  }
  if (!fetched) {
    return joinParts(into, placed, "");
  }
  const gap = BLANK_LINE.exec(into);
  const first = gap === null ? into : into.slice(0, gap.index);
  if (!EMBED_LINE.test(first.trim())) {
    return joinParts("", placed, into);
  }
  return joinParts(first, placed, gap === null ? "" : into.slice(gap.index));
};

const composed = (start: Side, lines: readonly string[]): string =>
  replaceItemYaml(start.text, lines.join("\n"));

// (A) both changed the fill, and differently: the winner, with the loser's edits since base
const bothFilled = (a: Side, b: Side, base: Side | null): string | null => {
  const [winner, loser] = beats(a, b) <= 0 ? [a, b] : [b, a];
  let lines = withEarlierSaved(winner.lines, winner, loser);
  lines = withAdoptedId(lines, winner, loser);
  lines = withCarriedKeys(lines, loser, base);
  lines = withCarriedAliases(lines, winner, loser, base);
  const tagged = withCarriedTags(composed(winner, lines), loser, base);
  if (tagged === null) {
    return null;
  }
  const loserWrote = base === null || loser.body !== base.body;
  if (loser.mark !== null || !loserWrote) {
    return withBody(tagged, winner.body);
  }
  if (base !== null) {
    const merged = diff3(base.body, loser.body, winner.body);
    if (!merged.conflicted) {
      return withBody(tagged, merged.merged);
    }
  }
  return withBody(
    tagged,
    placeBody(winner.body, base?.body ?? null, loser.body, winner.mark !== null),
  );
};

// (B) one side changed the fill: the filler's text, with the editor's edits since base
const oneFilled = (filler: Side, editor: Side, base: Side): string | null => {
  let lines = [...filler.lines];
  for (const key of FILL_OWNED_KEYS) {
    if (sameKey(filler, base, key) && !sameKey(editor, base, key)) {
      lines = withKeyLines(lines, key, keyLines(editor.lines, key));
    }
  }
  lines = withEarlierSaved(lines, filler, editor);
  lines = withAdoptedId(lines, filler, editor);
  lines = withCarriedKeys(lines, editor, base);
  lines = withCarriedAliases(lines, filler, editor, base);
  const tagged = withCarriedTags(composed(filler, lines), editor, base);
  if (tagged === null) {
    return null;
  }
  const merged = diff3(base.body, editor.body, filler.body);
  if (!merged.conflicted) {
    return withBody(tagged, merged.merged);
  }
  // a refresh that replaced the text, against a person's edit of it: the one genuine overlap
  if (base.mark !== null) {
    return null;
  }
  return withBody(tagged, placeBody(filler.body, base.body, editor.body, filler.mark !== null));
};

// the one text both versions of one saved link settle on; null for a note, for two different
// links, and where neither side changed the fill against the other (or both changed it to the
// same mark), so the caller's own rules (diff3) decide
export const urlItemVerdict = (texts: ItemTexts): string | null => {
  const mine = readSide(texts.mine);
  const theirs = readSide(texts.theirs);
  if (mine === null || theirs === null || !settles(mine) || !settles(theirs)) {
    return null;
  }
  if (mine.facts.urlKey !== theirs.facts.urlKey) {
    return null;
  }
  const base = texts.base === null ? null : readSide(texts.base);
  if (texts.base !== null && (base === null || base.facts.urlKey !== mine.facts.urlKey)) {
    return null;
  }
  const mineChanged = changedFill(mine, base);
  const theirsChanged = changedFill(theirs, base);
  if (mineChanged && theirsChanged) {
    const differ =
      mine.mark !== theirs.mark ||
      (mine.mark === null && mine.facts.savedMs !== theirs.facts.savedMs);
    return differ ? bothFilled(mine, theirs, base) : null;
  }
  if (base === null || !(mineChanged || theirsChanged)) {
    return null;
  }
  return mineChanged ? oneFilled(mine, theirs, base) : oneFilled(theirs, mine, base);
};

// the editor's text merge: the verdict where it applies, else diff3
export const mergeItemTexts = (base: string, mine: string, theirs: string): Diff3Result => {
  const settled = urlItemVerdict({ base, mine, theirs });
  return settled === null ? diff3(base, mine, theirs) : { conflicted: false, merged: settled };
};
