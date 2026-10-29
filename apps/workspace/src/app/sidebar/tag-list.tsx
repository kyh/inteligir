// The rail's "Tags" group: the index's tags, most used first, each a scope over the grid. Its fold
// is remembered; a tag's rename is its right-click.

import type { TagCountWire } from "@repo/contract/local/knowledge/knowledge-schema";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@repo/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar-menu";
import { HashIcon } from "lucide-react";
import { useState } from "react";

import { formatCount } from "../library/item-labels";

export interface TagListProps {
  tags: readonly TagCountWire[];
  activeTag: string | null;
  onTag: (tag: string) => void;
  onRenameTag: (tag: string) => void;
}

export const TagList = ({ tags, activeTag, onTag, onRenameTag }: TagListProps) => {
  const [menu, setMenu] = useState<{ tag: string; anchor: HTMLElement } | null>(null);
  if (tags.length === 0) {
    return <p className="px-2 py-1 text-body text-muted-foreground">No tags yet.</p>;
  }
  return (
    <SidebarMenu aria-label="Tags">
      {tags.map(({ tag, count }) => (
        <SidebarMenuItem key={tag}>
          <SidebarMenuButton
            icon={HashIcon}
            isActive={activeTag === tag}
            data-tag={tag}
            onClick={() => {
              onTag(tag);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ anchor: event.currentTarget, tag });
            }}
          >
            {tag}
            <span className="ml-auto shrink-0 text-caption text-muted-foreground tabular-nums">
              {formatCount(count)}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
      <DropdownMenu
        open={menu !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMenu(null);
          }
        }}
      >
        {menu === null ? null : (
          <DropdownMenuContent anchor={menu.anchor} align="start" side="bottom">
            <DropdownMenuItem
              onClick={() => {
                const { tag } = menu;
                setMenu(null);
                onRenameTag(tag);
              }}
            >
              Rename tag…
            </DropdownMenuItem>
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    </SidebarMenu>
  );
};
