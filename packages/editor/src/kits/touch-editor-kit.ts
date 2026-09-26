import { EditorShortcutsKit } from "@repo/editor/editor-shortcuts";
import { HeadingCollapseKit } from "@repo/editor/heading-collapse";
import { BlockPlaceholderKit } from "@repo/editor/kits/block-placeholder-kit";
import { CONTENT_KIT } from "@repo/editor/kits/editor-kit";
import { RichBlockLockKit } from "@repo/editor/kits/rich-block-lock-kit";
import { SlashKit } from "@repo/editor/slash-menu";
import { TouchToolbarKit } from "@repo/editor/touch-toolbar";

// Composed, never subtracted from the desktop's: the pointer chrome (the drag handle, the block
// menu, the selection toolbar, the find bar, the comment gutter) is simply not named, so a pointer
// surface added to the desktop stays off the phone until someone decides it belongs here.
export const TOUCH_EDITOR_KIT = [
  ...CONTENT_KIT,
  ...RichBlockLockKit,
  ...HeadingCollapseKit,
  ...SlashKit,
  ...EditorShortcutsKit,
  ...BlockPlaceholderKit,
  ...TouchToolbarKit,
];
