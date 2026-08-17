import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { dropCursor, EditorView, keymap } from "@codemirror/view";
import { calloutsExtension } from "./callouts";
import { dragFreezeExtension } from "./drag-freeze";
import { editorThemeExtension } from "./editor-theme";
import { forceParseHealerExtension } from "./force-parse-healer";
import { headingMarginMarksExtension } from "./heading-margin-marks";
import { hideMarksExtension } from "./hide-marks";
import { assetResolver, imageEmbedExtension, type AssetResolver } from "./image-embed";
import { markdownLanguageExtension } from "./markdown-language";
import { mathExtension } from "./math";
import { tagChipsExtension, tagClickHandler } from "./tag-chips";
import { taskCheckboxExtension } from "./task-checkbox";
import { blockQuoteExtension } from "./vendor/prosemark/lib/blockQuote";
import {
  clickLinkExtension,
  clickLinkHandler,
  defaultClickLinkHandler,
} from "./vendor/prosemark/lib/clickLink";
import {
  codeBlockDecorationsExtension,
  codeFenceTheme,
} from "./vendor/prosemark/lib/codeFenceExtension";
import { bulletListExtension } from "./vendor/prosemark/lib/fold/bulletList";
import { dashExtension } from "./vendor/prosemark/lib/fold/dashes";
import { horizonalRuleExtension } from "./vendor/prosemark/lib/fold/horizontalRule";
import { prosemarkMarkdownFormattingKeymap } from "./vendor/prosemark/lib/markdownFormattingKeymap";
import { revealBlockOnArrowExtension } from "./vendor/prosemark/lib/revealBlockOnArrow";
import { softIndentExtension } from "./vendor/prosemark/lib/softIndentExtension";
import {
  baseSyntaxHighlights,
  generalSyntaxHighlights,
} from "./vendor/prosemark/lib/syntaxHighlighting";
import { fixedTabWidthExtension } from "./vendor/prosemark/lib/tabWidthExtension";

export interface MarkdownEditorOptions {
  /** Receives the URL of a clicked rendered link; defaults to a new tab. */
  onOpenLink?: (url: string) => void;
  /** Receives the NAME (no `#`) of a clicked inline tag chip. Absent means a
   * chip is styling only — the editor never invents a search surface. */
  onOpenTag?: (tag: string) => void;
  /** Turns an image `src` with no scheme (a vault-relative path) into a URL
   * the browser can fetch. Absent means such an embed states that nothing
   * here can resolve it, rather than pointing an `<img>` somewhere hopeful. */
  resolveAsset?: AssetResolver;
}

/**
 * The whole live-preview stack. Deliberately absent, for later passes:
 * wiki-links — and ProseMark's image/task folds, which the house image pass
 * and task-checkbox.ts supersede. The delegation surface (thread-chip.ts,
 * delegation-affordance.ts) is app-appended rather than listed here: both
 * take app callbacks, and the house stack stays app-agnostic.
 */
export const markdownEditorExtensions = (options: MarkdownEditorOptions = {}): Extension => [
  markdownLanguageExtension(),

  // Live-preview surface
  hideMarksExtension,
  headingMarginMarksExtension,
  blockQuoteExtension,
  calloutsExtension,
  bulletListExtension,
  horizonalRuleExtension,
  dashExtension,
  taskCheckboxExtension,
  mathExtension,
  imageEmbedExtension,
  options.resolveAsset === undefined ? [] : assetResolver.of(options.resolveAsset),
  tagChipsExtension,
  options.onOpenTag === undefined ? [] : tagClickHandler.of(options.onOpenTag),
  codeBlockDecorationsExtension,
  codeFenceTheme,
  baseSyntaxHighlights,
  generalSyntaxHighlights,
  softIndentExtension,
  fixedTabWidthExtension,
  revealBlockOnArrowExtension,
  clickLinkExtension,
  options.onOpenLink === undefined
    ? defaultClickLinkHandler
    : clickLinkHandler.of(options.onOpenLink),

  // Interaction patterns
  dragFreezeExtension,
  forceParseHealerExtension,

  // Look
  editorThemeExtension,

  // Editing basics
  history(),
  dropCursor(),
  foldGutter(),
  EditorView.lineWrapping,
  keymap.of([
    ...prosemarkMarkdownFormattingKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    indentWithTab,
  ]),
];
