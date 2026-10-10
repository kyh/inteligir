// mdx without acorn and without expressions: jsx tags parse, nothing is validated as js, and `{`
// is prose. not micromark-extension-mdx: it disables autolink/htmlText so jsx owns `<`.
// TOTAL: no input throws, so no note opens raw for its bytes and the knowledge scan can read this
// grammar. mdx-jsx throws where a tag goes wrong; here a tag the tokenizer cannot finish declines,
// so `<https://x>`, `<a@b.com>` and `<!-- c -->` reach autolink and htmlText, and a tag that cannot
// pair (a closer with no opener, a mismatched closer, an opener never closed) becomes an `html`
// literal that remark-opaque carries verbatim, an unclosed opener's children staying in place.
// `htmlFlow` stays disabled: its type-6/7 branches swallow every line up to a blank one, so one
// `<div>x</div>` inside a `<toggle>` would eat its closer. `codeIndented` stays disabled: a
// 4-space-indented `- [ ]` must read as a task.

import type { Html, Nodes, Paragraph } from "mdast";
import type {
  CompileContext,
  CompileData,
  Extension as FromMarkdownExtension,
  Handle,
  Handles,
  OnEnterError,
  Token,
} from "mdast-util-from-markdown";
import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type {
  Code,
  Construct,
  ConstructRecord,
  Effects,
  Extension,
  State,
  TokenType,
} from "micromark-util-types";
import type { Plugin, Processor } from "unified";
import { mdxJsxFromMarkdown, mdxJsxToMarkdown } from "mdast-util-mdx-jsx";
import { mdxJsx } from "micromark-extension-mdx-jsx";
import { z } from "zod";

// `toMarkdownExtensions` is registered by remark-stringify, not a direct dependency; this
// mirrors its declaration (same Options type identity) so the two merge when both are present.
declare module "unified" {
  interface Data {
    toMarkdownExtensions?: ToMarkdownOptions[];
  }
}

const LESS_THAN = 60;

// a package bump that turns this into a list must fail here rather than silently leave the
// guard off.
const soleConstruct = (record: ConstructRecord | undefined): Construct => {
  const construct = record?.[LESS_THAN];
  if (construct === undefined || Array.isArray(construct)) {
    throw new Error("micromark-extension-mdx-jsx no longer ships one construct at `<`");
  }
  return construct;
};

// mdx-jsx and the attribute-expression factory it calls report a malformed tag by throwing a
// message whose `source` names the package.
const TAG_CRASH = z.object({
  source: z.enum(["micromark-extension-mdx-jsx", "micromark-extension-mdx-expression"]),
});

// mdx-jsx leaves this check to mdast-util-mdx-jsx, which throws; a closer is malformed syntax
// before it is a pairing question.
class AttributeOnCloserError extends Error {
  constructor() {
    super("a closing tag holds an attribute");
    this.name = "AttributeOnCloserError";
  }
}

interface TagTokens {
  tag: TokenType;
  closingMarker: TokenType;
  // what a closing tag may not hold
  attributes: ReadonlySet<TokenType>;
}

const FLOW_TOKENS: TagTokens = {
  attributes: new Set([
    "mdxJsxFlowTagAttribute",
    "mdxJsxFlowTagExpressionAttribute",
    "mdxJsxFlowTagSelfClosingMarker",
  ]),
  closingMarker: "mdxJsxFlowTagClosingMarker",
  tag: "mdxJsxFlowTag",
};

const TEXT_TOKENS: TagTokens = {
  attributes: new Set([
    "mdxJsxTextTagAttribute",
    "mdxJsxTextTagExpressionAttribute",
    "mdxJsxTextTagSelfClosingMarker",
  ]),
  closingMarker: "mdxJsxTextTagClosingMarker",
  tag: "mdxJsxTextTag",
};

// every state mdx-jsx returns is run under a guard until the construct settles, so a throw from any
// of its crash sites becomes `nok`. a crash is raised before the state consumes its code, and nok
// rewinds whatever the tag had entered. keeps the construct's `concrete` flag: flow jsx is
// concrete, so a lazy continuation line must not be absorbed into it.
const declineInsteadOfThrowing = (construct: Construct, tokens: TagTokens): Construct => ({
  ...construct,
  tokenize(effects, ok, nok) {
    let settled = false;
    const settle =
      (next: State): State =>
      (code: Code) => {
        settled = true;
        return next(code);
      };
    let closing = false;
    const strict: Effects = {
      ...effects,
      enter(type, fields) {
        if (type === tokens.tag) {
          closing = false;
        } else if (type === tokens.closingMarker) {
          closing = true;
        } else if (closing && tokens.attributes.has(type)) {
          throw new AttributeOnCloserError();
        }
        return effects.enter(type, fields);
      },
    };
    const guard =
      (state: State): State =>
      (code: Code) => {
        if (settled) {
          return state(code);
        }
        let next: State | undefined;
        try {
          next = state(code);
        } catch (error) {
          if (!(error instanceof AttributeOnCloserError) && !TAG_CRASH.safeParse(error).success) {
            throw error;
          }
          settled = true;
          return nok(code);
        }
        return next === undefined || settled ? next : guard(next);
      };
    return guard(construct.tokenize.call(this, strict, settle(ok), settle(nok)));
  },
});

const totalMdxJsx = (): Extension => {
  const jsx = mdxJsx();
  return {
    flow: { [LESS_THAN]: declineInsteadOfThrowing(soleConstruct(jsx.flow), FLOW_TOKENS) },
    text: { [LESS_THAN]: declineInsteadOfThrowing(soleConstruct(jsx.text), TEXT_TOKENS) },
  };
};

declare module "mdast-util-from-markdown" {
  interface CompileData {
    // the bytes of each opener, for the literal it becomes if nothing closes it
    mdxJsxOpenerSource?: WeakMap<Token, string>;
    // the phrasing runs open now whose end pops no element (see `PHRASING_RUNS`)
    mdxJsxPhrasingRuns?: Token[];
  }
}

type Point = Token["start"];

type Tag = NonNullable<CompileData["mdxJsxTag"]>;

type Context = Omit<CompileContext, "sliceSerialize">;

const point = ({ column, line, offset }: Point) => ({ column, line, offset });

// a tag that cannot pair is kept as the bytes it was written with; at flow level it is a paragraph
// of its own, since `html` sits in phrasing position here (htmlFlow is disabled).
const literalTag = (value: string, start: Point, end: Point, flow: boolean): Html | Paragraph => {
  const position = { end: point(end), start: point(start) };
  const html: Html = { position, type: "html", value };
  return flow ? { children: [html], position, type: "paragraph" } : html;
};

const enterLiteralTag = (context: CompileContext, token: Token): void => {
  const html: Html = { type: "html", value: context.sliceSerialize(token) };
  if (token.type === "mdxJsxFlowTag") {
    context.enter({ children: [], type: "paragraph" }, token);
    context.enter(html, token);
    context.exit(token);
    context.exit(token);
    return;
  }
  context.enter(html, token);
  context.exit(token);
};

// the element `open` started, already off the stack, is the last child of the stack's top:
// everything after the opener went inside it. it is replaced by the opener's literal and its own
// children.
const unwrapUnclosed = (context: Context, open: Token): void => {
  context.data.mdxJsxTagStack?.pop();
  const parent = context.stack.at(-1);
  if (parent === undefined || !("children" in parent)) {
    return;
  }
  const siblings: Nodes[] = parent.children;
  const element = siblings.at(-1);
  if (element?.type !== "mdxJsxFlowElement" && element?.type !== "mdxJsxTextElement") {
    return;
  }
  const source = context.data.mdxJsxOpenerSource?.get(open) ?? "";
  const flow = element.type === "mdxJsxFlowElement";
  siblings.splice(-1, 1, literalTag(source, open.start, open.end, flow), ...element.children);
};

const isOpener = (token: Token | undefined): token is Token =>
  token?.type === "mdxJsxFlowTag" || token?.type === "mdxJsxTextTag";

const isElement = (node: Context["stack"][number] | undefined): boolean =>
  node?.type === "mdxJsxFlowElement" || node?.type === "mdxJsxTextElement";

// takes the innermost element off both stacks and unwraps it, while `still` holds of its opener.
// inside a tag the top of the stack is the tag's own buffer, and nothing is open to unwrap.
const unwrapWhile = (context: Context, still: (open: Token) => boolean): void => {
  for (
    let top = context.tokenStack.at(-1)?.[0];
    isOpener(top) && isElement(context.stack.at(-1)) && still(top);
    top = context.tokenStack.at(-1)?.[0]
  ) {
    context.stack.pop();
    context.tokenStack.pop();
    unwrapUnclosed(context, top);
  }
};

// mdast-util-from-markdown calls this when a container closes over the element, having popped the
// element and while it is closing `closing`, and when the document ends with the element open,
// having popped nothing (`closing` is undefined). either way it reports only the innermost one
// left open, so every other is unwrapped here too, in a loop: nesting is the author's to choose.
const onUnclosed: OnEnterError = function onUnclosed(closing, open) {
  if (closing === undefined) {
    unwrapWhile(this, () => true);
    return;
  }
  unwrapUnclosed(this, open);
  unwrapWhile(this, () => true);
  const node = this.stack.pop();
  const [token, onError] = this.tokenStack.pop() ?? [];
  if (token?.type === closing.type) {
    if (node?.position !== undefined) {
      node.position.end = point(closing.end);
    }
  } else if (token !== undefined && onError !== undefined) {
    onError.call(this, closing, token);
  }
};

// a closer pairs only with the element at the top of both stacks: its tag on mdx-jsx's, its
// token on the compiler's, of the closer's own kind (a text closer cannot end a flow element).
const closesOpenElement = (context: CompileContext, tag: Tag, closer: Token): boolean => {
  const open = context.data.mdxJsxTagStack?.at(-1);
  const top = context.tokenStack.at(-1)?.[0];
  return (
    open !== undefined &&
    open.name === tag.name &&
    top !== undefined &&
    top.type === closer.type &&
    top.start.offset === open.start.offset
  );
};

const exitTag = (original: Handle): Handle =>
  function exitMdxJsxTag(token) {
    const tag = this.data.mdxJsxTag;
    if (tag?.close === true && !closesOpenElement(this, tag, token)) {
      // the buffer mdast-util-mdx-jsx opened for the tag
      this.resume();
      enterLiteralTag(this, token);
      return;
    }
    original.call(this, token);
    if (tag !== undefined && !tag.close && !tag.selfClosing) {
      const opened = this.tokenStack.at(-1);
      if (opened !== undefined) {
        opened[1] = onUnclosed;
        (this.data.mdxJsxOpenerSource ??= new WeakMap()).set(token, this.sliceSerialize(token));
      }
    }
  };

// phrasing runs whose end exits no element: a heading's text ends with the heading still open, and
// a label's text is read by a handler that expects the label's own buffer on top. a text element
// still open as one ends is unwrapped at the last token inside it, before anything reads the stack.
const PHRASING_RUNS: ReadonlySet<string> = new Set([
  "atxHeadingText",
  "labelText",
  "setextHeadingText",
]);

const enterPhrasingRun: Handle = function enterPhrasingRun(token) {
  if (PHRASING_RUNS.has(token.type)) {
    (this.data.mdxJsxPhrasingRuns ??= []).push(token);
  }
};

const endPhrasingRun: Handle = function endPhrasingRun(token) {
  const runs = this.data.mdxJsxPhrasingRuns;
  const run = runs?.at(-1);
  if (run === undefined || token.end.offset !== run.end.offset) {
    return;
  }
  unwrapWhile(
    this,
    (open) => open.type === "mdxJsxTextTag" && open.start.offset >= run.start.offset,
  );
  if (token === run) {
    runs?.pop();
  }
};

const requireHandle = (handles: Handles | null | undefined, type: string): Handle => {
  const handle = handles?.[type];
  if (handle === undefined) {
    throw new Error(`mdast-util-mdx-jsx no longer handles \`${type}\``);
  }
  return handle;
};

// the closing-marker enter handlers only throw on a closer with no opener, which `exitTag` decides
const PAIRING_CHECKS: ReadonlySet<string> = new Set([
  "mdxJsxFlowTagClosingMarker",
  "mdxJsxTextTagClosingMarker",
]);

const totalMdxJsxFromMarkdown = (): FromMarkdownExtension => {
  const jsx = mdxJsxFromMarkdown();
  return {
    ...jsx,
    afterExit: endPhrasingRun,
    beforeEnter: enterPhrasingRun,
    enter: Object.fromEntries(
      Object.entries(jsx.enter ?? {}).filter(([type]) => !PAIRING_CHECKS.has(type)),
    ),
    exit: {
      ...jsx.exit,
      mdxJsxFlowTag: exitTag(requireHandle(jsx.exit, "mdxJsxFlowTag")),
      mdxJsxTextTag: exitTag(requireHandle(jsx.exit, "mdxJsxTextTag")),
    },
  };
};

// a function expression: remark plugins receive the processor as `this`.
export const remarkMdxAgnostic: Plugin = function remarkMdxAgnostic(this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(totalMdxJsx(), {
    disable: { null: ["codeIndented", "htmlFlow"] },
  });
  (data.fromMarkdownExtensions ??= []).push(totalMdxJsxFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(mdxJsxToMarkdown());
};
