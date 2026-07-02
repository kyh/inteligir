// Agnostic MDX (no acorn): JSX + balanced-brace expressions parse, but nothing
// is validated as JavaScript and no ESM construct exists — `import X from 'x'`
// stays a plain paragraph and `config { noServer: true }` parses as an
// expression instead of crashing the file. This replaces Plate's `remarkMdx`
// re-export (acorn-validated), removing a whole parse-error class plus the
// acorn bundle weight. Expressions still parse — the vocabulary scan
// (vocabulary.ts) routes them to Raw.

import type { Options as ToMarkdownOptions } from "mdast-util-to-markdown";
import type { Plugin, Processor } from "unified";
import { mdxFromMarkdown, mdxToMarkdown } from "mdast-util-mdx";
import { mdx } from "micromark-extension-mdx";

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

// Function expression (not an exported declaration): remark plugins receive
// the processor as `this` by contract — unified invokes them with .call().
export const remarkMdxAgnostic: Plugin = function (this: Processor): undefined {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(mdx());
  (data.fromMarkdownExtensions ??= []).push(mdxFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(mdxToMarkdown());
};
