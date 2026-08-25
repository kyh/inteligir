// Overlays: everything that opens over the page and takes focus with it.

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@repo/ui/components/command";
import { confirm } from "@repo/ui/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/dialog";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@repo/ui/components/sheet";
import { Tooltip } from "@repo/ui/components/tooltip";
import { FileTextIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import { Demo, GallerySection } from "./gallery-chrome";

export function OverlaysSection() {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);

  return (
    <GallerySection id="overlays" title="Overlays">
      <Demo name="Dialog" purpose="A focused task the reader opts into and can leave.">
        <Dialog>
          <DialogTrigger render={<Button variant="secondary">Open dialog</Button>} />
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Rename note</DialogTitle>
              <DialogDescription>
                The filename is the title — renaming rewrites the links that point here.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="tertiary">Cancel</Button>
              <Button>Rename</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Demo>

      <Demo
        name="AlertDialog"
        purpose="A dialog the reader cannot dismiss by accident, for a choice that costs something."
      >
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="destructive">Delete forever</Button>} />
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this note permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                It is already in the trash. Deleting it now skips the 30-day window.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Demo>

      <Demo
        name="confirm()"
        purpose="The imperative form of the same question, for code paths with no JSX to hang a trigger on."
        note={confirmed === null ? undefined : confirmed ? "You confirmed." : "You cancelled."}
      >
        <Button
          variant="secondary"
          onClick={() => {
            void confirm({
              title: "Discard unsaved changes?",
              body: "The buffer has edits that are not on disk yet.",
              confirmLabel: "Discard",
              destructive: true,
            }).then(setConfirmed);
          }}
        >
          Ask with confirm()
        </Button>
      </Demo>

      <Demo
        name="Sheet"
        purpose="A panel that slides in from an edge — a dialog with room for a list."
      >
        <Sheet>
          <SheetTrigger render={<Button variant="secondary">Open sheet</Button>} />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Page details</SheetTitle>
              <SheetDescription>Everything the index knows about this note.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
      </Demo>

      <Demo name="Popover" purpose="A small surface anchored to what opened it. Not modal.">
        <Popover>
          <PopoverTrigger render={<Button variant="secondary">Open popover</Button>} />
          <PopoverContent className="w-64">
            <PopoverHeader>
              <PopoverTitle>Auto-commit</PopoverTitle>
              <PopoverDescription>
                Writes are committed on a rolling window, not per keystroke.
              </PopoverDescription>
            </PopoverHeader>
          </PopoverContent>
        </Popover>
      </Demo>

      <Demo
        name="Tooltip"
        purpose="Names a control that shows only an icon. Never holds the only copy of anything."
      >
        <Tooltip content="New note">
          <Button size="icon" variant="ghost" aria-label="New note">
            <FileTextIcon />
          </Button>
        </Tooltip>
        <Tooltip content="Settings" side="right">
          <Button size="icon" variant="ghost" aria-label="Settings">
            <SettingsIcon />
          </Button>
        </Tooltip>
      </Demo>

      <Demo
        name="Command"
        purpose="Filterable rows over a query — the palette's engine, shown inline here."
        stack
      >
        <Command className="w-full max-w-md rounded-lg border border-line">
          <CommandInput placeholder="Search notes or commands…" />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Notes">
              <CommandItem>Release checklist</CommandItem>
              <CommandItem>Weekly review</CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Commands">
              <CommandItem>
                New note
                <CommandShortcut>⌘N</CommandShortcut>
              </CommandItem>
              <CommandItem>
                Open settings
                <CommandShortcut>⌘,</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </Demo>
    </GallerySection>
  );
}
