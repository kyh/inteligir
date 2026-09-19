// own micromark constructs rather than an npm package: the published wiki-link packages are
// years stale and lack embeds. `body` is the raw source between the brackets, verbatim;
// anchor/alias splitting is display-time only. a single `]` inside the body rejects the whole
// construct, which then falls through to standard link parsing.

// remark-stringify's augmentation declares `Data.toMarkdownExtensions` (types-only).
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
  body: string;
}
export interface WikiEmbed extends Node {
  type: "wikiEmbed";
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

// micromark's own codes for EOF and the three EOL forms.
const EOF = null;
const CR = -5;
const LF = -4;
const CRLF = -3;
const BANG = 33;
const LEFT_BRACKET = 91;
const RIGHT_BRACKET = 93;

const wikiTokenizer = (withBang: boolean) =>
  function tokenize(effects: Effects, ok: State, nok: State): State {
    let size = 0;

    const close2 = (code: Code): State | undefined => {
      // single `]` in body → reject whole construct
      if (code !== RIGHT_BRACKET) {
        return nok(code);
      }
      effects.consume(code);
      effects.exit("wikiLinkMarker");
      effects.exit(withBang ? "wikiEmbed" : "wikiLink");
      return ok;
    };

    const body = (code: Code): State | undefined => {
      if (code === EOF || code === CR || code === LF || code === CRLF || code === LEFT_BRACKET) {
        return nok(code);
      }
      if (code === RIGHT_BRACKET) {
        // empty body
        if (size === 0) {
          return nok(code);
        }
        effects.exit("wikiLinkBody");
        effects.enter("wikiLinkMarker");
        effects.consume(code);
        return close2;
      }
      effects.consume(code);
      size += 1;
      return body;
    };

    const open2 = (code: Code): State | undefined => {
      if (code !== LEFT_BRACKET) {
        return nok(code);
      }
      effects.consume(code);
      effects.exit("wikiLinkMarker");
      effects.enter("wikiLinkBody");
      return body;
    };

    const open1 = (code: Code): State | undefined => {
      if (code !== LEFT_BRACKET) {
        return nok(code);
      }
      if (!withBang) {
        effects.enter("wikiLink");
      }
      effects.enter("wikiLinkMarker");
      effects.consume(code);
      return open2;
    };

    const bang = (code: Code): State | undefined => {
      if (code !== BANG) {
        return nok(code);
      }
      effects.enter("wikiEmbed");
      effects.enter("wikiEmbedMarker");
      effects.consume(code);
      effects.exit("wikiEmbedMarker");
      return open1;
    };

    return withBang ? bang : open1;
  };

const wikiSyntax: MicromarkExtension = {
  text: {
    [LEFT_BRACKET]: { name: "wikiLink", tokenize: wikiTokenizer(false) },
    [BANG]: { name: "wikiEmbed", tokenize: wikiTokenizer(true) },
  },
};

const wikiFromMarkdown: FromMarkdownExtension = {
  enter: {
    wikiEmbed(this: CompileContext, token: Token) {
      this.enter({ body: "", type: "wikiEmbed" }, token);
    },
    wikiLink(this: CompileContext, token: Token) {
      this.enter({ body: "", type: "wikiLink" }, token);
    },
  },
  exit: {
    wikiEmbed(this: CompileContext, token: Token) {
      this.exit(token);
    },
    wikiLink(this: CompileContext, token: Token) {
      this.exit(token);
    },
    wikiLinkBody(this: CompileContext, token: Token) {
      const node = this.stack.at(-1);
      if (node && (node.type === "wikiLink" || node.type === "wikiEmbed")) {
        node.body = this.sliceSerialize(token);
      }
    },
  },
};

const wikiToMarkdown: ToMarkdownExtension = {
  handlers: {
    wikiEmbed: Object.assign((node: WikiEmbed) => `![[${node.body}]]`, {
      peek: () => "!",
    }),
    wikiLink: Object.assign((node: WikiLink) => `[[${node.body}]]`, {
      peek: () => "[",
    }),
  },
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkWikiLink: Plugin = function remarkWikiLink(this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(wikiSyntax);
  (data.fromMarkdownExtensions ??= []).push(wikiFromMarkdown);
  (data.toMarkdownExtensions ??= []).push(wikiToMarkdown);
};

export interface WikiBody {
  target: string;
  anchor?: string;
  alias?: string;
}

// `targetRange` is the raw slice a rename rewrites; when the title carries `\#`/`\\` escapes it
// maps the escaped bytes while `target` is unescaped, so span verification fails closed.
export type WikiBodyRange = WikiBody & { targetRange?: { start: number; end: number } };

// the resolved-link form puts the target note's uuid after the pipe.
const UUID_ALIAS_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu;

export const isUuidWikiAlias = (alias: string): boolean => UUID_ALIAS_RE.test(alias);

const isEscapedAt = (text: string, index: number): boolean => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

// only the dialect's two escapes unescape; any other backslash is title text.
const unescapeWikiText = (text: string): string =>
  text.replaceAll(/\\(?<escaped>[\\#])/gu, "$<escaped>");

const WHITESPACE_RE = /\s/u;

// tight only: `[[C# Notes]]` and `[[A # B]]` stay titles while `[[Note#Heading]]` splits.
const anchorIndex = (head: string): number => {
  for (let i = 0; i < head.length; i += 1) {
    if (head[i] !== "#" || isEscapedAt(head, i)) {
      continue;
    }
    if (i === 0) {
      return 0;
    }
    const before = head[i - 1];
    const after = head[i + 1];
    const tight =
      before !== undefined &&
      !WHITESPACE_RE.test(before) &&
      after !== undefined &&
      !WHITESPACE_RE.test(after);
    if (tight) {
      return i;
    }
  }
  return -1;
};

export const parseWikiBodyRange = (body: string): WikiBodyRange => {
  // the last pipe starts the alias: a title containing `|` is legal when paired with a
  // resolved-uuid suffix.
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
    result.targetRange = { end: start + rawTarget.length, start };
  }
  if (anchor !== undefined && anchor !== "") {
    result.anchor = anchor;
  }
  if (alias !== undefined && alias !== "") {
    result.alias = alias;
  }
  return result;
};

export const parseWikiBody = (body: string): WikiBody => {
  const { targetRange: _range, ...display } = parseWikiBodyRange(body);
  return display;
};
