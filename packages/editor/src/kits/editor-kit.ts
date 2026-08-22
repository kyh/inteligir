// EDITOR_KIT — the live editor's composition. Mirrors BASE_KIT feature-for-
// feature (same kit files export both halves, so the serialization brain and
// node metadata stay shared by construction — the kit-parity test converts
// that premise into CI) and adds the live-only surfaces: slash menu, emoji,
// drag handle, and the
// chrome kits.

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
import { EmojiKit } from "@repo/editor/kits/emoji-kit";
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
import { WikiLinkKit } from "@repo/editor/kits/wiki-link-kit";
import { SlashKit } from "@repo/editor/slash-menu";
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
  ...WikiAutocompleteKit,
  // Render-only inline `#tag` chips. No BASE_KIT twin on purpose — a leaf
  // decoration never reaches the value, so there is nothing to serialize.
  ...TagChipKit,
  ...EmojiKit,
  ...SlashKit,
  ...DragKit,
  ...BlockMenuKit,
  ...FloatingToolbarKit,
  ...BlockPlaceholderKit,
  // The shared serialization brain (single MarkdownPlugin instance).
  ...MarkdownKit,
];
