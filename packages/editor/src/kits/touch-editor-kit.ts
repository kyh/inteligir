import { EditorShortcutsKit } from "@repo/editor/editor-shortcuts";
import { HeadingCollapseKit } from "@repo/editor/heading-collapse";
import { BlockPlaceholderKit } from "@repo/editor/kits/block-placeholder-kit";
import { CONTENT_KIT } from "@repo/editor/kits/editor-kit";
import { RichBlockLockKit } from "@repo/editor/kits/rich-block-lock-kit";
import { SlashKit } from "@repo/editor/slash-menu";
import { TouchToolbarKit } from "@repo/editor/touch-toolbar";

export const TOUCH_EDITOR_KIT = [
  ...CONTENT_KIT,
  ...RichBlockLockKit,
  ...HeadingCollapseKit,
  ...SlashKit,
  ...EditorShortcutsKit,
  ...BlockPlaceholderKit,
  ...TouchToolbarKit,
];
