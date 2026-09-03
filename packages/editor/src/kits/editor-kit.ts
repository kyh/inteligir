import { DragKit } from "@repo/editor/block-draggable";
import { BasicBlocksKit } from "@repo/editor/kits/basic-blocks-kit";
import { BasicMarksKit } from "@repo/editor/kits/basic-marks-kit";
import { BlockMenuKit } from "@repo/editor/kits/block-menu-kit";
import { BlockPlaceholderKit } from "@repo/editor/kits/block-placeholder-kit";
import { CalloutKit } from "@repo/editor/kits/callout-kit";
import { CodeBlockKit } from "@repo/editor/kits/code-block-kit";
import { ColumnKit } from "@repo/editor/kits/column-kit";
import { DateKit } from "@repo/editor/kits/date-kit";
import { EmbedKit } from "@repo/editor/kits/embed-kit";
import { FloatingToolbarKit } from "@repo/editor/kits/floating-toolbar-kit";
import { FrontmatterKit } from "@repo/editor/kits/frontmatter-kit";
import { ImageKit } from "@repo/editor/kits/image-kit";
import { LinkKit } from "@repo/editor/kits/link-kit";
import { ListKit } from "@repo/editor/kits/list-kit";
import { MarkdownKit } from "@repo/editor/kits/markdown-kit";
import { MathKit } from "@repo/editor/kits/math-kit";
import { OpaqueKit } from "@repo/editor/kits/opaque-kit";
import { TableKit } from "@repo/editor/kits/table-kit";
import { TagChipKit } from "@repo/editor/kits/tag-chip-kit";
import { ToggleKit } from "@repo/editor/kits/toggle-kit";
import { CommentGutterKit } from "@repo/editor/comments/comment-gutter";
import { CommentKit } from "@repo/editor/comments/comment-kit";
import { EditorShortcutsKit } from "@repo/editor/editor-shortcuts";
import { FindBarKit } from "@repo/editor/find-bar";
import { RichBlocksKit } from "@repo/editor/kits/rich-blocks-kit";
import { InlineConstructsKit } from "@repo/editor/kits/inline-constructs-kit";
import { TabsKit } from "@repo/editor/kits/tabs-kit";
import { HeadingCollapseKit } from "@repo/editor/heading-collapse";
import { WikiLinkKit } from "@repo/editor/kits/wiki-link-kit";
import { SlashKit } from "@repo/editor/slash-menu";
import { FormulaAutocompleteKit } from "@repo/editor/formula-autocomplete";
import { WikiAutocompleteKit } from "@repo/editor/wiki-autocomplete";

export const EDITOR_KIT = [
  ...BasicMarksKit,
  ...BasicBlocksKit,
  ...CodeBlockKit,
  ...TableKit,
  ...ListKit,
  ...LinkKit,
  ...ToggleKit,
  ...ColumnKit,
  ...EmbedKit,
  ...ImageKit,
  ...DateKit,
  ...MathKit,
  ...CalloutKit,
  ...OpaqueKit,
  ...FrontmatterKit,
  ...WikiLinkKit,
  ...InlineConstructsKit,
  ...RichBlocksKit,
  ...CommentKit,
  ...CommentGutterKit,
  ...TabsKit,
  ...HeadingCollapseKit,
  ...WikiAutocompleteKit,
  ...FormulaAutocompleteKit,
  // no BASE_KIT twin: a leaf decoration never reaches the value, so there is nothing to serialize.
  ...TagChipKit,
  ...SlashKit,
  ...EditorShortcutsKit,
  ...FindBarKit,
  ...DragKit,
  ...BlockMenuKit,
  ...FloatingToolbarKit,
  ...BlockPlaceholderKit,
  ...MarkdownKit,
];
