// Wiki-link syntax for the pipeline: `[[body]]`, `[[target|alias]]`,
// `![[embed]]`. Own micromark text constructs + mdast handlers (probe4-proven
// derivation; the npm wiki-link packages are years stale, two majors behind
// mdast-util-to-markdown, and lack embeds — see design-serialization.md §3).
//
// Round-trip contract: `body` is the raw source between the brackets,
// VERBATIM — `[[ padded ]]` and `[[a#b|c]]` re-emit byte-exact. Anchor/alias
// splitting is display-time only (parseWikiBody, for the WP2 chip renderer +
// Phase F resolution) and never round-trip-relevant.
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

/** `WikiBody` plus the exact code-unit range of `target` inside `body` — the
 * slice a rename-rewrite replaces. Absent when the body has no target text
 * (pure-anchor links like `[[#sec]]`). */
export type WikiBodyRange = WikiBody & { targetRange?: { start: number; end: number } };

/** Split a raw wiki body into target / #anchor / |alias, tracking where the
 * target sits inside the body (for byte-surgical rewrites). */
export function parseWikiBodyRange(body: string): WikiBodyRange {
  const pipe = body.indexOf("|");
  const head = pipe === -1 ? body : body.slice(0, pipe);
  const alias = pipe === -1 ? undefined : body.slice(pipe + 1).trim();
  const hash = head.indexOf("#");
  const segment = hash === -1 ? head : head.slice(0, hash);
  const target = segment.trim();
  const anchor = hash === -1 ? undefined : head.slice(hash + 1).trim();
  const result: WikiBodyRange = { target };
  if (target !== "") {
    const start = segment.length - segment.trimStart().length;
    result.targetRange = { start, end: start + target.length };
  }
  if (anchor !== undefined && anchor !== "") result.anchor = anchor;
  if (alias !== undefined && alias !== "") result.alias = alias;
  return result;
}

/** Split a raw wiki body into target / #anchor / |alias for display. */
export function parseWikiBody(body: string): WikiBody {
  const { targetRange: _range, ...display } = parseWikiBodyRange(body);
  return display;
}
