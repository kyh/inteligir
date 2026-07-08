// EDITOR_KIT — the live editor's composition. Mirrors BASE_KIT feature-for-
// feature (same kit files export both halves, so the serialization brain and
// node metadata stay shared by construction — the kit-parity test converts
// that premise into CI) and adds the live-only surfaces: slash menu, emoji,
// drag handle, the AI surface (menu / suggestions / ghost text), and WP3's
// chrome kits.

import { AiKit } from "@renderer/editor/ai/ai-kit";
import { DragKit } from "@renderer/editor/block-draggable";
import { BasicBlocksKit } from "@renderer/editor/kits/basic-blocks-kit";
import { BasicMarksKit } from "@renderer/editor/kits/basic-marks-kit";
import { BlockMenuKit } from "@renderer/editor/kits/block-menu-kit";
import { BlockPlaceholderKit } from "@renderer/editor/kits/block-placeholder-kit";
import { CalloutKit } from "@renderer/editor/kits/callout-kit";
import { CodeBlockKit } from "@renderer/editor/kits/code-block-kit";
import { ColumnKit } from "@renderer/editor/kits/column-kit";
import { DateKit } from "@renderer/editor/kits/date-kit";
import { EmbedKit } from "@renderer/editor/kits/embed-kit";
import { EmojiKit } from "@renderer/editor/kits/emoji-kit";
import { FloatingToolbarKit } from "@renderer/editor/kits/floating-toolbar-kit";
import { FrontmatterKit } from "@renderer/editor/kits/frontmatter-kit";
import { ImageKit } from "@renderer/editor/kits/image-kit";
import { LinkKit } from "@renderer/editor/kits/link-kit";
import { ListKit } from "@renderer/editor/kits/list-kit";
import { MarkdownKit } from "@renderer/editor/kits/markdown-kit";
import { MathKit } from "@renderer/editor/kits/math-kit";
import { TableKit } from "@renderer/editor/kits/table-kit";
import { ToggleKit } from "@renderer/editor/kits/toggle-kit";
import { WikiLinkKit } from "@renderer/editor/kits/wiki-link-kit";
import { SlashKit } from "@renderer/editor/slash-menu";
import { WikiAutocompleteKit } from "@renderer/editor/wiki-autocomplete";

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
  ...FrontmatterKit,
  ...WikiLinkKit,
  ...WikiAutocompleteKit,
  ...EmojiKit,
  ...SlashKit,
  ...DragKit,
  ...AiKit,
  ...BlockMenuKit,
  ...FloatingToolbarKit,
  ...BlockPlaceholderKit,
  // The shared serialization brain (single MarkdownPlugin instance).
  ...MarkdownKit,
];
