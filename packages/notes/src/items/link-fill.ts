// what a fill writes into a saved link's file, as pure functions of the bytes it read, on whichever
// device saved it (the Mac's fill-item.ts, the phone's link fill), so the fill's compare-and-swap recomputes them against whatever the file holds when it writes and a
// person's edit made meanwhile survives. A fill sets only the keys it owns (FILL_OWNED_KEYS), never
// `url` or `saved`, and only adds to the body: the cover first, then the person's note (the stub's
// own body), the article, and the page copy's link. Every fill writes a new `fetched`, which is how
// two versions of one link tell the filler from the editor (@repo/notes/sync/url-item-verdict).

import { bodyOf, composeLinkBody, embedMarkdown, linkMarkdown, withBody } from "./item-body";
import { itemFactsOf, withItemFields } from "./item-frontmatter";
import type { ItemFieldPatch } from "./item-frontmatter";

type FilledKind = "link" | "video" | "audio";

export interface LinkFill {
  // a fill may tell a link from a video or a song; undefined keeps the item's
  kind?: FilledKind | undefined;
  site: string | null;
  author: string | null;
  published: string | null;
  description: string | null;
  // formatItemTime of the moment the page was read
  fetched: string;
  // vault paths
  cover: string | null;
  copy: string | null;
  // canonical markdown, "" for none
  article: string;
}

const MiB = 1024 * 1024;

// what every device that fills a link reads of it: a page's answer up to 10 MiB (a file at the link
// past it keeps only its link), its first 5 MiB read as the page, a cover candidate up to 10 MiB,
// kept at most 640 px on its long edge, and one under 200 px is a pixel or an icon, never a cover
export const FILL_LIMITS = {
  coverBytes: 10 * MiB,
  coverEdge: 640,
  coverMinEdge: 200,
  htmlBytes: 5 * MiB,
  pageBytes: 10 * MiB,
} as const;

// whether an answer is a page the reader reads, by the type it declared (none reads as one)
export const isPageType = (mediaType: string | null): boolean =>
  mediaType === null || mediaType === "text/html" || mediaType === "application/xhtml+xml";

// a link that answered with a video or a sound is kept as its link, read as that kind
export const playableKindOf = (mediaType: string | null): "video" | "audio" | null => {
  if (mediaType?.startsWith("video/") === true) {
    return "video";
  }
  return mediaType?.startsWith("audio/") === true ? "audio" : null;
};

// "replace": a refresh that rewrites the body from the page (refused while it holds highlights)
export type FillText = "keep" | "replace";

const COPY_LINK_TEXT = "Copy of the page";

// an image embed of any spelling: `![alt](x)`, `![](<a b>)`, `![[x.png]]`
const IMAGE_EMBED = /!\[[^\]\n]*\]\(|!\[\[/u;
const COVER_EMBED = /!\[[^\]\n]*\]\((?:<assets\/covers\/[^>\n]*>|assets\/covers\/[^)\s]*)\)/u;
const COPY_LINK = /\[Copy of the page\]\((?:<assets\/pages\/[^>\n]*>|assets\/pages\/[^)\s]*)\)/u;

// the body's first block, the paragraph a cover would be
const firstBlock = (body: string): string =>
  body.replace(/^\s+/u, "").split(/\r?\n[ \t]*\r?\n/u)[0] ?? "";

export const startsWithImage = (body: string): boolean => IMAGE_EMBED.test(firstBlock(body));

const withTrailingNewline = (body: string): string => (body === "" ? "" : `${body.trimEnd()}\n`);

// a filled item's cover pointed at the new one, or put first when its first block shows none
const retargetCover = (body: string, cover: string | null): string => {
  if (cover === null) {
    return body;
  }
  if (COVER_EMBED.test(body)) {
    return body.replace(COVER_EMBED, embedMarkdown(cover));
  }
  return startsWithImage(body)
    ? body
    : composeLinkBody({ article: "", copy: null, cover, note: body });
};

const withCopy = (body: string, copy: string | null): string => {
  if (copy === null) {
    return body;
  }
  const link = linkMarkdown(COPY_LINK_TEXT, copy);
  if (COPY_LINK.test(body)) {
    return body.replace(COPY_LINK, link);
  }
  return body.trim() === "" ? `${link}\n` : `${body.trimEnd()}\n\n${link}\n`;
};

// the keys a fill writes: a value the page gave, never a removal of one it did not give (an
// imported excerpt stays until the page says something of its own)
const fillPatches = (fill: LinkFill): ItemFieldPatch[] => {
  const patches: ItemFieldPatch[] = [{ "fetch-error": null, fetched: fill.fetched }];
  if (fill.kind !== undefined) {
    patches.push({ kind: fill.kind });
  }
  if (fill.site !== null) {
    patches.push({ site: fill.site });
  }
  if (fill.author !== null) {
    patches.push({ author: fill.author });
  }
  if (fill.published !== null) {
    patches.push({ published: fill.published });
  }
  if (fill.description !== null) {
    patches.push({ description: fill.description });
  }
  return patches;
};

// each patch a line cut over the last one's result; null when the block does not parse or a value
// is refused
const patched = (current: string, patches: readonly ItemFieldPatch[]): string | null => {
  let content = current;
  for (const patch of patches) {
    const verdict = withItemFields(content, patch);
    if (verdict.kind === "invalid" || verdict.kind === "refused") {
      return null;
    }
    if (verdict.kind === "written") {
      ({ content } = verdict);
    }
  }
  return content;
};

// null when the file's block does not parse, so nothing may rewrite it
export const applyLinkFill = (
  current: string,
  fill: LinkFill,
  text: FillText = "keep",
): string | null => {
  const facts = itemFactsOf(current);
  const body = bodyOf(current);
  // a stub, a failed fill, or a link note never read: the page's text goes around the note
  const firstFill = facts.fetchedMs === null || facts.fetchError !== null;
  let next: string;
  if (text === "replace") {
    next = composeLinkBody({ article: fill.article, copy: fill.copy, cover: fill.cover, note: "" });
  } else if (firstFill) {
    next = composeLinkBody({
      article: fill.article,
      copy: fill.copy,
      cover: startsWithImage(body) ? null : fill.cover,
      note: body,
    });
  } else {
    next = withTrailingNewline(withCopy(retargetCover(body, fill.cover), fill.copy));
  }
  const keyed = patched(current, fillPatches(fill));
  return keyed === null ? null : withBody(keyed, next);
};

// a fill that read no page: `fetched` and the sentence saying why, and a cover a hint found put
// first, so a dead link keeps the picture it had
export const applyFillFailure = (
  current: string,
  failure: { fetched: string; message: string; cover: string | null },
): string | null => {
  const keyed = patched(current, [{ "fetch-error": failure.message, fetched: failure.fetched }]);
  if (keyed === null) {
    return null;
  }
  const body = bodyOf(current);
  if (failure.cover === null || startsWithImage(body)) {
    return keyed;
  }
  return withBody(
    keyed,
    composeLinkBody({ article: "", copy: null, cover: failure.cover, note: body }),
  );
};

// a link that answered with a picture or a PDF becomes that file's item, its original embedded
// under the person's note
export const applyMediaFill = (
  current: string,
  media: { kind: "image" | "pdf"; fetched: string; original: string },
): string | null => {
  const keyed = patched(current, [
    { "fetch-error": null, fetched: media.fetched, kind: media.kind },
  ]);
  if (keyed === null) {
    return null;
  }
  return withBody(
    keyed,
    composeLinkBody({
      article: embedMarkdown(media.original),
      copy: null,
      cover: null,
      note: bodyOf(current),
    }),
  );
};
