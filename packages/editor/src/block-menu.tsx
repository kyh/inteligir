// Flat, not a nested Turn-into submenu: Base UI's SubmenuRoot inside this
// controlled virtual-anchor menu closes the root with reason "sibling-open".

import { useMemo } from "react";
import { BlockMenuPlugin, BlockSelectionPlugin } from "@platejs/selection/react";
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, FileOutputIcon, Trash2Icon } from "lucide-react";
import type { Path } from "platejs";
import { useEditorPlugin, usePluginOption } from "platejs/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@repo/ui/components/dropdown-menu";

import { TURN_INTO, moveBlocks, turnIntoBlocks } from "@repo/editor/block-transforms";
import { extractBlocksToNote } from "@repo/editor/extract-note";

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
  const blockApi = editor.getApi(BlockSelectionPlugin).blockSelection;

  // the selected ids name blocks that are gone once the extract lands
  const extract = (): void => {
    void extractBlocksToNote(editor, selectedPaths()).then((created) => {
      if (created !== null) blockApi.clear();
      return undefined;
    });
  };

  return (
    <DropdownMenu
      open={openId !== null}
      onOpenChange={(open) => {
        if (!open) api.blockMenu.hide();
      }}
    >
      <DropdownMenuContent anchor={anchor} side="bottom" align="start" className="max-h-[70vh]">
        <DropdownMenuItem onClick={() => blockTf.duplicate()}>
          <CopyIcon />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => moveBlocks(editor, selectedPaths(), "up")}>
          <ArrowUpIcon />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => moveBlocks(editor, selectedPaths(), "down")}>
          <ArrowDownIcon />
          Move down
        </DropdownMenuItem>
        <DropdownMenuItem onClick={extract}>
          <FileOutputIcon />
          Extract to new note…
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => blockTf.removeNodes()}>
          <Trash2Icon />
          Delete
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>Turn into</DropdownMenuLabel>
          {TURN_INTO.map((opt) => (
            <DropdownMenuItem
              key={opt.id}
              onClick={() => turnIntoBlocks(editor, selectedPaths(), opt)}
            >
              {opt.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
