// EDITOR_KIT — the live editor's composition. Mirrors BASE_KIT feature-for-
// feature (same kit files export both halves, so the serialization brain and
// node metadata stay shared by construction — the kit-parity test converts
// that premise into CI) and adds the live-only surfaces: slash menu, emoji,
// drag handle, the AI surface (menu / suggestions / ghost text), and WP3's
// chrome kits.

import { AiKit } from "@repo/app/editor/ai/ai-kit";
import { DragKit } from "@repo/app/editor/block-draggable";
import { BasicBlocksKit } from "@repo/app/editor/kits/basic-blocks-kit";
import { BasicMarksKit } from "@repo/app/editor/kits/basic-marks-kit";
import { BlockMenuKit } from "@repo/app/editor/kits/block-menu-kit";
import { BlockPlaceholderKit } from "@repo/app/editor/kits/block-placeholder-kit";
import { CalloutKit } from "@repo/app/editor/kits/callout-kit";
import { CodeBlockKit } from "@repo/app/editor/kits/code-block-kit";
import { ColumnKit } from "@repo/app/editor/kits/column-kit";
import { DateKit } from "@repo/app/editor/kits/date-kit";
import { EmbedKit } from "@repo/app/editor/kits/embed-kit";
import { EmojiKit } from "@repo/app/editor/kits/emoji-kit";
import { FloatingToolbarKit } from "@repo/app/editor/kits/floating-toolbar-kit";
import { FrontmatterKit } from "@repo/app/editor/kits/frontmatter-kit";
import { LinkKit } from "@repo/app/editor/kits/link-kit";
import { ListKit } from "@repo/app/editor/kits/list-kit";
import { MarkdownKit } from "@repo/app/editor/kits/markdown-kit";
import { MathKit } from "@repo/app/editor/kits/math-kit";
import { TableKit } from "@repo/app/editor/kits/table-kit";
import { ToggleKit } from "@repo/app/editor/kits/toggle-kit";
import { WikiLinkKit } from "@repo/app/editor/kits/wiki-link-kit";
import { SlashKit } from "@repo/app/editor/slash-menu";

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
  ...DateKit,
  ...MathKit,
  ...CalloutKit,
  ...FrontmatterKit,
  ...WikiLinkKit,
  ...EmojiKit,
  ...SlashKit,
  ...DragKit,
  ...AiKit,
  // WP3 fills these three (they're empty today).
  ...BlockMenuKit,
  ...FloatingToolbarKit,
  ...BlockPlaceholderKit,
  // The shared serialization brain (single MarkdownPlugin instance).
  ...MarkdownKit,
];
