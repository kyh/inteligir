// No imports, on purpose: the contract validates a tag name against this, and every client that
// loads the contract would otherwise load the markdown parser behind the scan.

export interface InlineTagSpan {
  start: number;
  end: number;
  tag: string;
}

// the name is letter-first (so `#123` and hex colors miss); one source string, so the inline
// grammar and the name a rename accepts cannot drift.
const TAG_NAME_SOURCE = String.raw`\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*`;
// `#` must not follow a word char, `#` or `/` (so `C#`, `##h` and url fragments miss).
// stateful `g` flag: use matchAll.
const INLINE_TAG_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_/#])#(${TAG_NAME_SOURCE})`, "gu");
const TAG_NAME_RE = new RegExp(`^(?:${TAG_NAME_SOURCE})$`, "u");

export const isTagName = (value: string): boolean => TAG_NAME_RE.test(value);

// shared with the editor's tag chip decoration; the token grammar must not drift between them
export const inlineTagSpans = (text: string): InlineTagSpan[] => {
  const spans: InlineTagSpan[] = [];
  for (const match of text.matchAll(INLINE_TAG_RE)) {
    const start = match.index;
    const [, raw] = match;
    if (start === undefined || raw === undefined) {
      continue;
    }
    // a trailing dash reads as punctuation (`#bar-` → `bar`)
    const tag = raw.replace(/-+$/u, "");
    if (tag === "") {
      continue;
    }
    spans.push({ end: start + 1 + tag.length, start, tag });
  }
  return spans;
};
