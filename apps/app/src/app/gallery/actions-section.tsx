// Actions: the things a reader clicks to make something happen.

import { Badge, badgeColors, type BadgeColor } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  Dropdown,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { MenuItem } from "@repo/ui/components/menu-item";
import { ArchiveIcon, EyeIcon, PlusIcon, TrashIcon } from "lucide-react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

const BADGE_COLORS: readonly BadgeColor[] = ["gray", "red", "amber", "green", "teal", "violet"];

export function ActionsSection() {
  return (
    <GallerySection id="actions" title="Actions">
      <Demo name="Button" purpose="Commits an action. Variant carries how loud the action is.">
        <DemoCase label="primary">
          <Button>Save note</Button>
        </DemoCase>
        <DemoCase label="secondary">
          <Button variant="secondary">Rename</Button>
        </DemoCase>
        <DemoCase label="tertiary">
          <Button variant="tertiary">Cancel</Button>
        </DemoCase>
        <DemoCase label="ghost">
          <Button variant="ghost">Dismiss</Button>
        </DemoCase>
        <DemoCase label="destructive">
          <Button variant="destructive">Delete forever</Button>
        </DemoCase>
      </Demo>

      <Demo
        name="Button — sizes and states"
        purpose="Density follows the surrounding SizeProvider unless a size is named."
      >
        <DemoCase label="default">
          <Button>Publish</Button>
        </DemoCase>
        <DemoCase label="compact">
          <Button size="compact">Publish</Button>
        </DemoCase>
        <DemoCase label="icon">
          <Button size="icon" aria-label="New note">
            <PlusIcon />
          </Button>
        </DemoCase>
        <DemoCase label="icon-compact">
          <Button size="icon-compact" aria-label="New note">
            <PlusIcon />
          </Button>
        </DemoCase>
        <DemoCase label="leadingIcon">
          <Button leadingIcon={PlusIcon}>New note</Button>
        </DemoCase>
        <DemoCase label="loading">
          <Button loading>Syncing</Button>
        </DemoCase>
        <DemoCase label="disabled">
          <Button disabled>Unavailable</Button>
        </DemoCase>
        <DemoCase label="active">
          <Button variant="ghost" active>
            Menu open
          </Button>
        </DemoCase>
      </Demo>

      <Demo name="Badge" purpose="Labels a row with a status or a tag. Never interactive.">
        <DemoCase label="solid">
          <Badge>running</Badge>
        </DemoCase>
        <DemoCase label="dot">
          <Badge variant="dot">queued</Badge>
        </DemoCase>
        <DemoCase label="outline">
          <Badge variant="outline">reference</Badge>
        </DemoCase>
        <DemoCase label="compact">
          <Badge size="compact">done</Badge>
        </DemoCase>
      </Demo>

      <Demo
        name="Badge — colors"
        purpose="The dot's hue is the caller's; the chrome stays monochrome."
        note={`${String(Object.keys(badgeColors).length)} colors ship; the first six are shown.`}
      >
        {BADGE_COLORS.map((color) => (
          <DemoCase key={color} label={color}>
            <Badge variant="dot" color={color}>
              {color}
            </Badge>
          </DemoCase>
        ))}
      </Demo>

      <Demo
        name="DropdownMenu"
        purpose="A menu hung off a trigger — the row's own actions, not navigation."
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Note actions"
            className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-[13px] outline-none hover:bg-hover"
          >
            Note actions
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>This note</DropdownMenuLabel>
            <DropdownMenuItem>
              <ArchiveIcon />
              Move to trash
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <TrashIcon />
              Delete forever
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Demo>

      <Demo
        name="Dropdown · MenuItem"
        purpose="The menu's panel and row, used inline — the same rows a popup menu renders."
        note="MenuItem takes its own `index`: the panel owns roving focus, so a row has to say where it sits."
        stack
      >
        <Dropdown checkedIndex={1} className="w-56">
          <MenuItem index={0} icon={EyeIcon} label="Show all notes" checked={false} />
          <MenuItem index={1} icon={ArchiveIcon} label="Show archived" checked />
          <MenuItem index={2} icon={TrashIcon} label="Show trashed" disabled />
        </Dropdown>
      </Demo>
    </GallerySection>
  );
}
