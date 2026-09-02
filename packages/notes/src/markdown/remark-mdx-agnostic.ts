// mdx without acorn: jsx and balanced-brace expressions parse, nothing is validated as js.
// not micromark-extension-mdx: it disables autolink/htmlText so jsx owns `<`, and the jsx
// tokenizer throws rather than declining, so `<https://x>`, `<a@b.com>` and `<!-- c -->` become
// whole-file parse errors; the tag constructs are wrapped in a crash-free lookahead instead.
// `htmlFlow` stays disabled: its type-6/7 branches swallow every line up to a blank one, so one
// `<div>x</div>` inside a `<callout>` would eat its closer. `codeIndented` stays disabled: a
// 4-space-indented `- [ ]` must read as a task, and the knowledge scan makes the same choice.

import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Code, Construct, ConstructRecord, Extension } from "micromark-util-types";
import type { Plugin, Processor } from "unified";
import { cont as idCont, start as idStart } from "estree-util-is-identifier-name";
import { mdxFromMarkdown, mdxToMarkdown } from "mdast-util-mdx";
import { mdxExpression } from "micromark-extension-mdx-expression";
import { mdxJsx } from "micromark-extension-mdx-jsx";

// `toMarkdownExtensions` is registered by remark-stringify, not a direct dependency; this
// mirrors its declaration (same Options type identity) so the two merge when both are present.
declare module "unified" {
  interface Data {
    toMarkdownExtensions?: ToMarkdownOptions[];
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    mdxJsxTagStartProbe: "mdxJsxTagStartProbe";
    formulaPillStartProbe: "formulaPillStartProbe";
  }
}

const LESS_THAN = 60; // <
const SLASH = 47; // /
const GREATER_THAN = 62; // >
const LEFT_BRACE = 123; // {
const DOT = 46; // .
const COLON = 58; // :

// micromark encodes line endings and virtual spaces as negative codes.
const WHITESPACE_RE = /\s/u;

function isWhitespace(code: Code): boolean {
  return code !== null && (code < 0 || WHITESPACE_RE.test(String.fromCodePoint(code)));
}

// the identifier predicates mdx-jsx itself uses, so the lookahead cannot drift from the grammar.
function isNameStart(code: Code): boolean {
  return code !== null && code >= 0 && idStart(code);
}

function isNameCont(code: Code): boolean {
  return code !== null && code >= 0 && idCont(code, { jsx: true });
}

// a superset of mdx-jsx's tag starts on purpose: accepting too much only lets mdx-jsx run and
// fail as it would anyway (the doc opens raw), while accepting too little would divert a real
// component to htmlText and silently stop rendering it.
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

// keeps the construct's `concrete` flag: flow jsx is concrete, so a lazy continuation line
// must not be absorbed into it.
function onlyWhereATagCanStart(construct: Construct): Construct {
  return {
    ...construct,
    tokenize(effects, ok, nok) {
      return effects.check(jsxTagStartProbe, effects.attempt(construct, ok, nok), nok);
    },
  };
}

// a package bump that turns either into a list must fail here rather than silently leave the
// guard off.
function soleConstruct(record: ConstructRecord | undefined, code: number, what: string): Construct {
  const construct = record?.[code];
  if (construct === undefined || Array.isArray(construct)) {
    throw new Error(`micromark-extension-mdx-${what} no longer ships one construct at ${code}`);
  }
  return construct;
}

// `{{` opens a formula pill, never an mdx expression; the probe answers by the second character
// alone so single-brace expressions keep their opaque preservation.
const doubleBraceProbe: Construct = {
  name: "formulaPillStartProbe",
  partial: true,
  tokenize(effects, ok, nok) {
    return start;

    function start(code: Code) {
      effects.enter("formulaPillStartProbe");
      effects.consume(code); // `{`
      return afterBrace;
    }

    function afterBrace(code: Code) {
      effects.exit("formulaPillStartProbe");
      return code === LEFT_BRACE ? ok(code) : nok(code);
    }
  },
};

function notFormulaPill(construct: Construct): Construct {
  return {
    ...construct,
    // both braces of `{{` must decline: the probe covers the first, this hook the second, or
    // the inner brace starts an expression one character later.
    previous(code) {
      if (code === LEFT_BRACE) return false;
      return construct.previous === undefined ? true : construct.previous.call(this, code);
    },
    tokenize(effects, ok, nok) {
      return effects.check(doubleBraceProbe, nok, effects.attempt(construct, ok, nok));
    },
  };
}

function guardedMdxExpression(): Extension {
  const expression = mdxExpression();
  return {
    flow: {
      [LEFT_BRACE]: notFormulaPill(soleConstruct(expression.flow, LEFT_BRACE, "expression")),
    },
    text: {
      [LEFT_BRACE]: notFormulaPill(soleConstruct(expression.text, LEFT_BRACE, "expression")),
    },
  };
}

function guardedMdxJsx(): Extension {
  const jsx = mdxJsx();
  return {
    flow: { [LESS_THAN]: onlyWhereATagCanStart(soleConstruct(jsx.flow, LESS_THAN, "jsx")) },
    text: { [LESS_THAN]: onlyWhereATagCanStart(soleConstruct(jsx.text, LESS_THAN, "jsx")) },
  };
}

// a function expression: remark plugins receive the processor as `this`.
export const remarkMdxAgnostic: Plugin = function (this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(guardedMdxExpression(), guardedMdxJsx(), {
    disable: { null: ["codeIndented", "htmlFlow"] },
  });
  (data.fromMarkdownExtensions ??= []).push(mdxFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(mdxToMarkdown());
};
