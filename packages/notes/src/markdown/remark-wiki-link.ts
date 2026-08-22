// Wiki-link syntax for the pipeline: `[[body]]`, `[[target|alias]]`,
// `![[embed]]`. Own micromark text constructs + mdast handlers rather than an
// npm package: the published wiki-link packages are years stale, two majors
// behind mdast-util-to-markdown, and lack embeds.
//
// Round-trip contract: `body` is the raw source between the brackets,
// VERBATIM — `[[ padded ]]` and `[[a#b|c]]` re-emit byte-exact. Anchor/alias
// splitting is display-time only (parseWikiBody, for the chip renderer and
// target resolution) and never round-trip-relevant.
//
// Grammar: nok on EOF/EOL (no multi-line targets), nested `[`, and empty body.
// A single `]` inside the body rejects the whole construct, which then falls
// through to standard link/image parsing (micromark prepends our constructs, so
// `[x](y)` is untouched). Text constructs never run inside code — fence-safety
// is free.

// remark-stringify's module augmentation declares `Data.toMarkdownExtensions`,
// which the plugin below pushes into (types-only — no runtime import).
/// <reference types="remark-stringify" />

import type { Node } from "mdast";
import type {
  CompileContext,
  Extension as FromMarkdownExtension,
  Token,
} from "mdast-util-from-markdown";
import type { Options as ToMarkdownExtension } from "mdast-util-to-markdown";
import type { Code, Effects, Extension as MicromarkExtension, State } from "micromark-util-types";
import type { Plugin, Processor } from "unified";

export interface WikiLink extends Node {
  type: "wikiLink";
  /** Raw source between the brackets, verbatim. */
  body: string;
}
export interface WikiEmbed extends Node {
  type: "wikiEmbed";
  /** Raw source between the brackets, verbatim. */
  body: string;
}

declare module "mdast" {
  interface PhrasingContentMap {
    wikiLink: WikiLink;
    wikiEmbed: WikiEmbed;
  }
  interface RootContentMap {
    wikiLink: WikiLink;
    wikiEmbed: WikiEmbed;
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    wikiLink: "wikiLink";
    wikiEmbed: "wikiEmbed";
    wikiLinkMarker: "wikiLinkMarker";
    wikiLinkBody: "wikiLinkBody";
    wikiEmbedMarker: "wikiEmbedMarker";
  }
}

// micromark character codes: EOF, then the three EOL codes.
const EOF = null;
const CR = -5;
const LF = -4;
const CRLF = -3;
const BANG = 33; // !
const LEFT_BRACKET = 91; // [
const RIGHT_BRACKET = 93; // ]

function wikiTokenizer(withBang: boolean) {
  return function tokenize(effects: Effects, ok: State, nok: State): State {
    let size = 0;

    function bang(code: Code): State | undefined {
      if (code !== BANG) return nok(code);
      effects.enter("wikiEmbed");
      effects.enter("wikiEmbedMarker");
      effects.consume(code);
      effects.exit("wikiEmbedMarker");
      return open1;
    }

    function open1(code: Code): State | undefined {
      if (code !== LEFT_BRACKET) return nok(code);
      if (!withBang) effects.enter("wikiLink");
      effects.enter("wikiLinkMarker");
      effects.consume(code);
      return open2;
    }

    function open2(code: Code): State | undefined {
      if (code !== LEFT_BRACKET) return nok(code);
      effects.consume(code);
      effects.exit("wikiLinkMarker");
      effects.enter("wikiLinkBody");
      return body;
    }

    function body(code: Code): State | undefined {
      if (code === EOF || code === CR || code === LF || code === CRLF || code === LEFT_BRACKET) {
        return nok(code);
      }
      if (code === RIGHT_BRACKET) {
        if (size === 0) return nok(code); // empty body
        effects.exit("wikiLinkBody");
        effects.enter("wikiLinkMarker");
        effects.consume(code);
        return close2;
      }
      effects.consume(code);
      size++;
      return body;
    }

    function close2(code: Code): State | undefined {
      if (code !== RIGHT_BRACKET) return nok(code); // single `]` in body → reject whole construct
      effects.consume(code);
      effects.exit("wikiLinkMarker");
      effects.exit(withBang ? "wikiEmbed" : "wikiLink");
      return ok;
    }

    return withBang ? bang : open1;
  };
}

const wikiSyntax: MicromarkExtension = {
  text: {
    [LEFT_BRACKET]: { name: "wikiLink", tokenize: wikiTokenizer(false) },
    [BANG]: { name: "wikiEmbed", tokenize: wikiTokenizer(true) },
  },
};

const wikiFromMarkdown: FromMarkdownExtension = {
  enter: {
    wikiLink(this: CompileContext, token: Token) {
      this.enter({ type: "wikiLink", body: "" }, token);
    },
    wikiEmbed(this: CompileContext, token: Token) {
      this.enter({ type: "wikiEmbed", body: "" }, token);
    },
  },
  exit: {
    wikiLinkBody(this: CompileContext, token: Token) {
      const node = this.stack.at(-1);
      if (node && (node.type === "wikiLink" || node.type === "wikiEmbed")) {
        node.body = this.sliceSerialize(token);
      }
    },
    wikiLink(this: CompileContext, token: Token) {
      this.exit(token);
    },
    wikiEmbed(this: CompileContext, token: Token) {
      this.exit(token);
    },
  },
};

const wikiToMarkdown: ToMarkdownExtension = {
  handlers: {
    wikiLink: Object.assign((node: WikiLink) => `[[${node.body}]]`, {
      peek: () => "[",
    }),
    wikiEmbed: Object.assign((node: WikiEmbed) => `![[${node.body}]]`, {
      peek: () => "!",
    }),
  },
};

// Function expression (not an exported declaration): remark plugins receive
// the processor as `this` by contract — unified invokes them with .call().
export const remarkWikiLink: Plugin = function (this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(wikiSyntax);
  (data.fromMarkdownExtensions ??= []).push(wikiFromMarkdown);
  (data.toMarkdownExtensions ??= []).push(wikiToMarkdown);
};

// ---------------------------------------------------------------------------
// Display-time body parsing (WP2 chip renderer + Phase F resolution). Never
// used for round-trip: the node keeps `body` verbatim.
// ---------------------------------------------------------------------------

export type WikiBody = {
  /** Link target (trimmed), e.g. `Note` in `[[ Note #sec | nice ]]`. */
  target: string;
  /** Heading anchor after `#` (trimmed), if any. */
  anchor?: string;
  /** Display alias after the first `|` (trimmed), if any. */
  alias?: string;
};

/** `WikiBody` plus the exact code-unit range of the target's RAW slice inside
 * `body` — what a rename-rewrite replaces. Absent when the body has no target
 * text (pure-anchor links like `[[#sec]]`). When the title carries `\#`/`\\`
 * escapes the range maps the escaped bytes while `target` is the unescaped
 * text, so span verification fails closed and such a link is never rewritten. */
export type WikiBodyRange = WikiBody & { targetRange?: { start: number; end: number } };

/** Moss's resolved-link form puts the target note's uuid after the pipe; a
 * uuid-shaped alias is identity plumbing, never display text. */
const UUID_ALIAS_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function isUuidWikiAlias(alias: string): boolean {
  return UUID_ALIAS_RE.test(alias);
}

function isEscapedAt(text: string, index: number): boolean {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
}

// Only Moss's two escapes unescape; any other backslash is title text.
function unescapeWikiText(text: string): string {
  return text.replace(/\\([\\#])/g, "$1");
}

/** The first `#` that starts an anchor: unescaped, and TIGHT — at position 0
 * or with non-whitespace on both sides (Moss's rule, so `[[C# Notes]]` and
 * `[[A # B]]` stay titles while `[[Note#Heading]]` splits). */
function anchorIndex(head: string): number {
  for (let i = 0; i < head.length; i++) {
    if (head[i] !== "#" || isEscapedAt(head, i)) continue;
    if (i === 0) return 0;
    const before = head[i - 1];
    const after = head[i + 1];
    const tight =
      before !== undefined && !/\s/.test(before) && after !== undefined && !/\s/.test(after);
    if (tight) return i;
  }
  return -1;
}

/** Split a raw wiki body into target / #anchor / |alias, tracking where the
 * target sits inside the body (for byte-surgical rewrites). */
export function parseWikiBodyRange(body: string): WikiBodyRange {
  // The LAST pipe starts the alias (Moss dialect): a title containing `|` is
  // legal when paired with a resolved-UUID suffix, so the split must keep the
  // whole title intact rather than truncating at its first pipe.
  const pipe = body.lastIndexOf("|");
  const head = pipe === -1 ? body : body.slice(0, pipe);
  const alias = pipe === -1 ? undefined : body.slice(pipe + 1).trim();
  const hash = anchorIndex(head);
  const segment = hash === -1 ? head : head.slice(0, hash);
  const rawTarget = segment.trim();
  const target = unescapeWikiText(rawTarget);
  const anchor = hash === -1 ? undefined : unescapeWikiText(head.slice(hash + 1).trim());
  const result: WikiBodyRange = { target };
  if (target !== "") {
    const start = segment.length - segment.trimStart().length;
    result.targetRange = { start, end: start + rawTarget.length };
  }
  if (anchor !== undefined && anchor !== "") result.anchor = anchor;
  if (alias !== undefined && alias !== "") result.alias = alias;
  return result;
}

/** Split a raw wiki body into target / #anchor / |alias for display.
 *
 * The rename path wants the range and calls `parseWikiBodyRange` directly; this
 * drops it for a renderer that only shows the parts. No such renderer is built
 * yet, so knip is told the export is deliberate.
 * @public */
export function parseWikiBody(body: string): WikiBody {
  const { targetRange: _range, ...display } = parseWikiBodyRange(body);
  return display;
}
