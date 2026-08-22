// Agnostic MDX (no acorn): JSX + balanced-brace expressions parse, but nothing
// is validated as JavaScript and no ESM construct exists — `import X from 'x'`
// stays a plain paragraph and `config { noServer: true }` parses as an
// expression instead of crashing the file. It stands in for Plate's `remarkMdx`
// re-export, whose acorn validation costs a whole parse-error class plus the
// acorn bundle weight.
//
// `<` is SHARED with CommonMark rather than owned by JSX. The obvious
// composition — micromark-extension-mdx, which bundles `mdx-md` and disables
// `autolink`/`htmlFlow`/`htmlText` so JSX has the character to itself — turns
// `<https://x>`, `<a@b.com>`, `<!-- c -->` and `<?xml?>` into whole-file parse
// errors, because the JSX tokenizer does not decline a byte it cannot read: it
// THROWS. So the tag constructs are wrapped in a crash-free lookahead. JSX runs
// only where a tag can actually start, and every other `<` falls through to
// autolink / htmlText / literal text. Precedence is preserved in the direction
// that matters — a real tag is always JSX, never HTML — which is what keeps the
// MDX components working.
//
// `htmlFlow` stays disabled. Its type-6/7 branches swallow every line up to a
// blank one, so one `<div>x</div>` line inside a `<callout>` would eat the
// `</callout>` that closes it. Block-level HTML reaches the tree as JSX
// instead, which nests properly; only the non-tag forms (comments, processing
// instructions, declarations, CDATA) need CommonMark, and `htmlText` parses
// those inside the paragraph they land in.
//
// `codeIndented` stays disabled too: a 4-space-indented `- [ ]` must read as a
// live task, and knowledge/link-extract.ts pins its scan to the same choice.

import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Code, Construct, ConstructRecord, Extension } from "micromark-util-types";
import type { Plugin, Processor } from "unified";
import { cont as idCont, start as idStart } from "estree-util-is-identifier-name";
import { mdxFromMarkdown, mdxToMarkdown } from "mdast-util-mdx";
import { mdxExpression } from "micromark-extension-mdx-expression";
import { mdxJsx } from "micromark-extension-mdx-jsx";

// remark-parse's types register `micromarkExtensions`/`fromMarkdownExtensions`
// on unified's Data; `toMarkdownExtensions` is registered by remark-stringify,
// which is not a direct dependency. This mirrors remark-stringify's declaration
// byte-for-byte (same Options type identity), so the two merge cleanly when
// both are in the program.
declare module "unified" {
  interface Data {
    toMarkdownExtensions?: ToMarkdownOptions[];
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    mdxJsxTagStartProbe: "mdxJsxTagStartProbe";
  }
}

const LESS_THAN = 60; // <
const SLASH = 47; // /
const GREATER_THAN = 62; // >
const LEFT_BRACE = 123; // {
const DOT = 46; // .
const COLON = 58; // :

// micromark encodes line endings and virtual spaces as negative codes; `\s`
// covers the rest of what mdx-jsx's `unicodeWhitespace` accepts inside a tag.
const WHITESPACE_RE = /\s/u;

function isWhitespace(code: Code): boolean {
  return code !== null && (code < 0 || WHITESPACE_RE.test(String.fromCodePoint(code)));
}

// The identifier predicates mdx-jsx itself uses, from the same package, so the
// lookahead cannot drift from the grammar it is guarding.
function isNameStart(code: Code): boolean {
  return code !== null && code >= 0 && idStart(code);
}

function isNameCont(code: Code): boolean {
  return code !== null && code >= 0 && idCont(code, { jsx: true });
}

// Crash-free lookahead: can a JSX tag start here? Matches `<`, an optional
// closing `/`, a fragment `>` or a `name` (with `.member` / `:local` parts),
// and stops at the first byte mdx-jsx would accept AFTER the name — whitespace,
// `/`, `>`, or an attribute's `{`.
//
// It is a deliberate SUPERSET of mdx-jsx's tag starts, and the asymmetry is the
// safety property: accepting too much only lets mdx-jsx run and fail the way it
// does today (a malformed tag stays a parse error, and the document stays Raw),
// while accepting too little would divert a real component to htmlText and
// silently stop rendering it. Attributes are not validated here at all for the
// same reason.
const jsxTagStartProbe: Construct = {
  name: "mdxJsxTagStartProbe",
  partial: true,
  tokenize(effects, ok, nok) {
    return start;

    function start(code: Code) {
      effects.enter("mdxJsxTagStartProbe");
      effects.consume(code); // `<`
      return afterMarker;
    }

    function afterMarker(code: Code) {
      if (code === SLASH) {
        effects.consume(code);
        return beforeName;
      }
      return beforeName(code);
    }

    function beforeName(code: Code) {
      if (isWhitespace(code)) {
        effects.consume(code);
        return beforeName;
      }
      if (code === GREATER_THAN) return done(code); // `<>` / `</>` fragment
      if (isNameStart(code)) {
        effects.consume(code);
        return name;
      }
      return nok(code);
    }

    function name(code: Code) {
      if (isNameCont(code)) {
        effects.consume(code);
        return name;
      }
      if (code === DOT || code === COLON) {
        effects.consume(code);
        return beforeSegment;
      }
      if (code === SLASH || code === GREATER_THAN || code === LEFT_BRACE || isWhitespace(code)) {
        return done(code);
      }
      return nok(code);
    }

    function beforeSegment(code: Code) {
      if (isWhitespace(code)) {
        effects.consume(code);
        return beforeSegment;
      }
      if (isNameStart(code)) {
        effects.consume(code);
        return name;
      }
      return nok(code);
    }

    function done(code: Code) {
      effects.exit("mdxJsxTagStartProbe");
      return ok(code);
    }
  },
};

// The wrapper keeps the construct's own `name` and `concrete` flag (flow JSX is
// concrete — a lazy continuation line must not be absorbed into it).
function onlyWhereATagCanStart(construct: Construct): Construct {
  return {
    ...construct,
    tokenize(effects, ok, nok) {
      return effects.check(jsxTagStartProbe, effects.attempt(construct, ok, nok), nok);
    },
  };
}

// mdxJsx()/mdxExpression() each register exactly one construct per code; a
// package bump that turns either into a list must fail here rather than
// silently leave the guard off.
function soleConstruct(record: ConstructRecord | undefined, code: number, what: string): Construct {
  const construct = record?.[code];
  if (construct === undefined || Array.isArray(construct)) {
    throw new Error(`micromark-extension-mdx-${what} no longer ships one construct at ${code}`);
  }
  return construct;
}

function guardedMdxJsx(): Extension {
  const jsx = mdxJsx();
  return {
    flow: { [LESS_THAN]: onlyWhereATagCanStart(soleConstruct(jsx.flow, LESS_THAN, "jsx")) },
    text: { [LESS_THAN]: onlyWhereATagCanStart(soleConstruct(jsx.text, LESS_THAN, "jsx")) },
  };
}

// Function expression (not an exported declaration): remark plugins receive
// the processor as `this` by contract — unified invokes them with .call().
export const remarkMdxAgnostic: Plugin = function (this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(mdxExpression(), guardedMdxJsx(), {
    disable: { null: ["codeIndented", "htmlFlow"] },
  });
  (data.fromMarkdownExtensions ??= []).push(mdxFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(mdxToMarkdown());
};
