"use client";

import { TrailingBlockPlugin, type Value } from "platejs";
import { type TPlateEditor, useEditorRef } from "platejs/react";

import { AutoformatKit } from "@/registry/components/editor/plugins/autoformat-kit";
import { BasicBlocksKit } from "@/registry/components/editor/plugins/basic-blocks-kit";
import { BasicMarksKit } from "@/registry/components/editor/plugins/basic-marks-kit";
import { BlockMenuKit } from "@/registry/components/editor/plugins/block-menu-kit";
import { BlockPlaceholderKit } from "@/registry/components/editor/plugins/block-placeholder-kit";
import { CalloutKit } from "@/registry/components/editor/plugins/callout-kit";
import { CodeBlockKit } from "@/registry/components/editor/plugins/code-block-kit";
import { ColumnKit } from "@/registry/components/editor/plugins/column-kit";
import { CopilotKit } from "@/registry/components/editor/plugins/copilot-kit";
import { CursorOverlayKit } from "@/registry/components/editor/plugins/cursor-overlay-kit";
import { DateKit } from "@/registry/components/editor/plugins/date-kit";
import { DndKit } from "@/registry/components/editor/plugins/dnd-kit";
import { DocxKit } from "@/registry/components/editor/plugins/docx-kit";
import { EmojiKit } from "@/registry/components/editor/plugins/emoji-kit";
import { ExitBreakKit } from "@/registry/components/editor/plugins/exit-break-kit";
import { FontKit } from "@/registry/components/editor/plugins/font-kit";
import { ListKit } from "@/registry/components/editor/plugins/list-kit";
import { MarkdownKit } from "@/registry/components/editor/plugins/markdown-kit";
import { MathKit } from "@/registry/components/editor/plugins/math-kit";
import { SlashKit } from "@/registry/components/editor/plugins/slash-kit";
import { TableKit } from "@/registry/components/editor/plugins/table-kit";
import { TocKit } from "@/registry/components/editor/plugins/toc-kit";
import { ToggleKit } from "@/registry/components/editor/plugins/toggle-kit";

import { AIKit } from "./plugins/ai-kit-app";
import { BlockSelectionKit } from "./plugins/block-selection-kit-app";
import { CommentKit } from "./plugins/comment-kit-app";
import { FloatingToolbarKit } from "./plugins/floating-toolbar-kit-app";
import { LinkKit } from "./plugins/link-kit-app";
import { MediaKit } from "./plugins/media-kit-app";
import { MentionKit } from "./plugins/mention-kit-app";
import { SuggestionKit } from "./plugins/suggestion-kit-app";

export const EditorKit = [
  ...CopilotKit,
  ...AIKit,
  ...BlockMenuKit,
  ...BlockSelectionKit,

  // Elements
  ...BasicBlocksKit,
  ...CodeBlockKit,
  ...TableKit,
  ...ToggleKit,
  ...TocKit,
  ...MediaKit,
  ...CalloutKit,
  ...ColumnKit,
  ...MathKit,
  ...DateKit,
  ...LinkKit,
  ...MentionKit,

  // Marks
  ...BasicMarksKit,
  ...FontKit,

  // Block Style
  ...ListKit,

  // Collaboration
  ...CommentKit,
  ...SuggestionKit,

  // Editing
  ...SlashKit,
  ...AutoformatKit,
  ...CursorOverlayKit,
  ...DndKit,
  ...EmojiKit,
  ...ExitBreakKit,
  TrailingBlockPlugin,

  // Parsers
  ...DocxKit,
  ...MarkdownKit,

  // UI
  ...BlockPlaceholderKit,
  ...FloatingToolbarKit,
];

export type MyEditor = TPlateEditor<Value, (typeof EditorKit)[number]>;

export const useEditor = () => useEditorRef<MyEditor>();
