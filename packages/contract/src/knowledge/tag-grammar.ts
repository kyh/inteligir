interface InlineTagSpan {
  start: number;
  end: number;
  tag: string;
}

const TAG_NAME_SOURCE = String.raw`\p{L}[\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_-]+)*`;
const INLINE_TAG_RE = new RegExp(String.raw`(?<![\p{L}\p{N}_/#])#(${TAG_NAME_SOURCE})`, "gu");
const TAG_NAME_RE = new RegExp(`^(?:${TAG_NAME_SOURCE})$`, "u");

export const isTagName = (value: string) => TAG_NAME_RE.test(value) && !value.endsWith("-");

export const inlineTagSpans = (text: string) => {
  const spans: InlineTagSpan[] = [];

  for (const match of text.matchAll(INLINE_TAG_RE)) {
    const start = match.index;
    const [, raw] = match;

    if (start === undefined || raw === undefined) {
      continue;
    }

    const tag = raw.replace(/-+$/u, "");

    if (tag === "") {
      continue;
    }

    spans.push({ end: start + 1 + tag.length, start, tag });
  }

  return spans;
};
