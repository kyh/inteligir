// Actions: the things a reader clicks to make something happen.

import { Badge } from "@repo/ui/components/badge";
import { Button } from "@repo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/components/dropdown-menu";
import { ArchiveIcon, PlusIcon, TrashIcon } from "lucide-react";

import { Demo, DemoCase, GallerySection } from "./gallery-chrome";

const BADGE_COLORS = ["gray", "red", "amber", "green", "teal", "violet"] as const;

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
        note="Six of the shipped palette; every Tailwind hue family has a row."
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
    </GallerySection>
  );
}
