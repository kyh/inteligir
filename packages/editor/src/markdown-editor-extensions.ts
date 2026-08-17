import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { dropCursor, EditorView, keymap, type KeyBinding } from "@codemirror/view";
import { calloutsExtension } from "./callouts";
import { dragFreezeExtension } from "./drag-freeze";
import { editorThemeExtension } from "./editor-theme";
import { forceParseHealerExtension } from "./force-parse-healer";
import { headingMarginMarksExtension } from "./heading-margin-marks";
import { hideMarksExtension } from "./hide-marks";
import { assetResolver, imageEmbedExtension, type AssetResolver } from "./image-embed";
import { markdownLanguageExtension } from "./markdown-language";
import { mathExtension } from "./math";
import { mermaidExtension } from "./mermaid-diagram";
import { tablesExtension } from "./tables";
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
 * Every binding the editor installs, in precedence order — CodeMirror runs a
 * key's bindings in array order and stops at the first that returns true, so
 * the house formatting keymap outranks the CodeMirror defaults it shadows.
 *
 * Exported because a host app's window-level shortcuts are the other half of
 * a fact neither table can state alone: a CodeMirror binding calls
 * preventDefault but never stopPropagation, so a key bound here AND on the
 * window fires both. The app checks its own shortcut table against this one.
 */
export const markdownEditorKeymap: readonly KeyBinding[] = [
  ...prosemarkMarkdownFormattingKeymap,
  ...defaultKeymap,
  // Mod-d (selectNextOccurrence) is dropped: the host app opens the daily
  // note on it, and the window listener runs whatever this keymap does.
  // Mod-Shift-l (selectSelectionMatches) keeps a multi-selection path.
  ...searchKeymap.filter((binding) => binding.key !== "Mod-d"),
  ...historyKeymap,
  ...foldKeymap,
  indentWithTab,
];

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
  mermaidExtension,
  tablesExtension,
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
  keymap.of([...markdownEditorKeymap]),
];
