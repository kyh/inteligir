import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { foldNodeProp, type LanguageSupport } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { MarkdownConfig } from "@lezer/markdown";
import { escapeMarkdownSyntaxExtension } from "./vendor/prosemark/lib/hide/index";
import { dashMarkdownSyntaxExtension } from "./vendor/prosemark/lib/fold/dashes";
import { frontmatterMarkdownSyntaxExtension } from "./vendor/prosemark/lib/markdown/frontmatter";
import { nestedLinkAsPlainText } from "./vendor/prosemark/lib/markdown/nestedLinkAsPlainText";
import { additionalMarkdownSyntaxTags } from "./vendor/prosemark/lib/syntaxHighlighting";

// The whole Frontmatter block folds down to its opening `---` line, through
// the stock fold UI (gutter, fold keymap) rather than a bespoke widget.
const frontmatterFold: MarkdownConfig = {
  props: [
    foldNodeProp.add({
      Frontmatter: (node, state) => {
        const openingLine = state.doc.lineAt(node.from);
        if (node.to <= openingLine.to) return null;
        return { from: openingLine.to, to: node.to };
      },
    }),
  ],
};

/**
 * The markdown language for the live-preview surface: GFM (tasks,
 * strikethrough, tables-as-text for now) plus the vendored ProseMark syntax
 * extensions, with fenced-code highlighting resolved through
 * `@codemirror/language-data` (per-grammar dynamic import, incremental).
 *
 * Deliberately NOT wired yet: ProseMark's math syntax — parsing `$…$` without
 * a renderer would only restyle delimiters; it lands with the math pass.
 */
export const markdownLanguageExtension = (): LanguageSupport =>
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
    extensions: [
      additionalMarkdownSyntaxTags,
      frontmatterMarkdownSyntaxExtension,
      frontmatterFold,
      nestedLinkAsPlainText,
      escapeMarkdownSyntaxExtension,
      dashMarkdownSyntaxExtension,
    ],
  });
