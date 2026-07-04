// THE block menu — one implementation for both the right-click context menu
// and the drag-grip click (block-draggable), driven by BlockMenuPlugin's
// openId/position and anchored to a virtual element at that position (Base UI
// Positioner takes a rect-returning function; no 0×0 anchor div needed).
// Actions operate on the block-selection set.
//
// Flat by design: a Turn-into group instead of a nested submenu — Base UI's
// SubmenuRoot inside this controlled virtual-anchor menu closes the root with
// reason "sibling-open" (parent/child floating-tree linkage doesn't form);
// revisit if upstream fixes the nesting. Omitted: copy-link-to-block
// (markdown files have no block-anchor concept).

import { useMemo } from "react";
import { BlockMenuPlugin, BlockSelectionPlugin } from "@platejs/selection/react";
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import type { Path } from "platejs";
import { useEditorPlugin, usePluginOption } from "platejs/react";

import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
} from "@repo/ui/components/menu";

import { openAiMenu } from "@renderer/editor/ai/ai-session";
import { TURN_INTO, moveBlocks, turnIntoBlocks } from "@renderer/editor/block-transforms";

export function BlockMenu() {
  const { api, editor } = useEditorPlugin(BlockMenuPlugin);
  const openId = usePluginOption(BlockMenuPlugin, "openId");
  const position = usePluginOption(BlockMenuPlugin, "position");

  const anchor = useMemo(() => {
    const { x, y } = position;
    return () => ({
      getBoundingClientRect: () => DOMRect.fromRect({ height: 0, width: 0, x, y }),
    });
  }, [position]);

  const selectedPaths = (): Path[] =>
    editor
      .getApi(BlockSelectionPlugin)
      .blockSelection.getNodes({ sort: true })
      .map(([, path]) => path);

  const blockTf = editor.getTransforms(BlockSelectionPlugin).blockSelection;

  // Ask AI targets the block-selection span: select it as a real editor
  // range (openAiMenu anchors under the range's end and the edit flow reads
  // editTargetPaths from it), clear the block selection so the selection
  // toolbar's isSelectingSome gate doesn't fight the menu, and defer past
  // Base UI's close/focus-return (same timing workaround as potion).
  const askAi = () => {
    const paths = selectedPaths();
    api.blockMenu.hide();
    setTimeout(() => {
      const first = paths[0];
      const last = paths.at(-1);
      if (!first || !last) return;
      const anchorPoint = editor.api.start(first);
      const focusPoint = editor.api.end(last);
      if (!anchorPoint || !focusPoint) return;
      editor.tf.focus();
      editor.tf.select({ anchor: anchorPoint, focus: focusPoint });
      editor.getApi(BlockSelectionPlugin).blockSelection.clear();
      openAiMenu(editor);
    }, 0);
  };

  return (
    <Menu
      open={openId !== null}
      onOpenChange={(open) => {
        if (!open) api.blockMenu.hide();
      }}
    >
      <MenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        className="max-h-[70vh] min-w-[200px]"
      >
        <MenuItem onClick={askAi}>
          <SparklesIcon />
          Ask AI
          <span className="ml-auto text-xs text-muted-foreground">⌘J</span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => blockTf.duplicate()}>
          <CopyIcon />
          Duplicate
        </MenuItem>
        <MenuItem onClick={() => moveBlocks(editor, selectedPaths(), "up")}>
          <ArrowUpIcon />
          Move up
        </MenuItem>
        <MenuItem onClick={() => moveBlocks(editor, selectedPaths(), "down")}>
          <ArrowDownIcon />
          Move down
        </MenuItem>
        <MenuItem
          onClick={() => blockTf.removeNodes()}
          className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
        >
          <Trash2Icon />
          Delete
        </MenuItem>
        <MenuSeparator />
        <MenuGroup>
          <MenuGroupLabel>Turn into</MenuGroupLabel>
          {TURN_INTO.map((opt) => (
            <MenuItem key={opt.label} onClick={() => turnIntoBlocks(editor, selectedPaths(), opt)}>
              {opt.label}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuContent>
    </Menu>
  );
}
