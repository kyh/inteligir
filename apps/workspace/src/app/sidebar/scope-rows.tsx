// The rail's "Library" group: every item, and Unsorted, each with its count from the index. A row
// is a scope; the one the library shows is lit while no item is open over it.

import type { LibraryScope } from "@repo/domain/library-scope";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@repo/ui/components/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@repo/ui/components/sidebar-menu";
import { ArchiveRestoreIcon, InboxIcon, LibraryIcon } from "lucide-react";
import { useState } from "react";

import { formatCount } from "../library/item-labels";

export interface ScopeRowsProps {
  active: LibraryScope["kind"] | null;
  total: number | null;
  unsorted: number | null;
  onScope: (scope: LibraryScope) => void;
  // Unsorted's right-click, where the run that files it is offered
  onTidy?: (() => void) | undefined;
}

const Count = ({ count }: { count: number | null }) =>
  count === null ? null : (
    <span className="ml-auto shrink-0 text-caption text-muted-foreground tabular-nums">
      {formatCount(count)}
    </span>
  );

export const ScopeRows = ({ active, total, unsorted, onScope, onTidy }: ScopeRowsProps) => {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <SidebarMenu aria-label="Library">
      <SidebarMenuItem>
        <SidebarMenuButton
          icon={LibraryIcon}
          isActive={active === "all"}
          onClick={() => {
            onScope({ kind: "all" });
          }}
        >
          All items
          <Count count={total} />
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton
          icon={InboxIcon}
          isActive={active === "unsorted"}
          onClick={() => {
            onScope({ kind: "unsorted" });
          }}
          onContextMenu={(event) => {
            if (onTidy !== undefined) {
              event.preventDefault();
              setMenu(event.currentTarget);
            }
          }}
        >
          Unsorted
          <Count count={unsorted} />
        </SidebarMenuButton>
      </SidebarMenuItem>
      {onTidy === undefined ? null : (
        <DropdownMenu
          open={menu !== null}
          onOpenChange={(open) => {
            if (!open) {
              setMenu(null);
            }
          }}
        >
          {menu === null ? null : (
            <DropdownMenuContent anchor={menu} align="start" side="bottom">
              <DropdownMenuItem
                onClick={() => {
                  setMenu(null);
                  onTidy();
                }}
              >
                Tidy my library
              </DropdownMenuItem>
            </DropdownMenuContent>
          )}
        </DropdownMenu>
      )}
    </SidebarMenu>
  );
};

// the rail's last row: what the library's history still holds
export const DeletedRow = ({
  active,
  onScope,
}: {
  active: boolean;
  onScope: (scope: LibraryScope) => void;
}) => (
  <SidebarMenu aria-label="Deleted">
    <SidebarMenuItem>
      <SidebarMenuButton
        icon={ArchiveRestoreIcon}
        isActive={active}
        onClick={() => {
          onScope({ kind: "deleted" });
        }}
      >
        Deleted
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
);
