// Overlays: everything that opens over the page and takes focus with it.

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";
import { Button } from "@repo/ui/components/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@repo/ui/components/command";
import { confirm } from "@repo/ui/components/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/components/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/components/popover";
import { Tooltip } from "@repo/ui/components/tooltip";
import { FileTextIcon, SettingsIcon } from "lucide-react";
import { useState } from "react";

import { Demo, GallerySection } from "./gallery-chrome";

export function OverlaysSection() {
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <GallerySection id="overlays" title="Overlays">
      <Demo name="Dialog" purpose="A focused task the reader opts into and can leave.">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Rename note</DialogTitle>
              <DialogDescription>
                The filename is the title — renaming rewrites the links that point here.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="tertiary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => setDialogOpen(false)}>Rename</Button>
            </div>
          </DialogContent>
        </Dialog>
      </Demo>

      <Demo
        name="AlertDialog"
        purpose="A dialog the reader cannot dismiss by accident, for a choice that costs something."
      >
        <Button variant="destructive" onClick={() => setAlertOpen(true)}>
          Delete forever
        </Button>
        <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this note permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                It is already in the trash. Deleting it now skips the 30-day window.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button variant="secondary" onClick={() => setAlertOpen(false)}>
                Keep it
              </Button>
              <Button variant="destructive" onClick={() => setAlertOpen(false)}>
                Delete
              </Button>
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

      <Demo name="Popover" purpose="A small surface anchored to what opened it. Not modal.">
        <Popover>
          <PopoverTrigger render={<Button variant="secondary">Open popover</Button>} />
          <PopoverContent className="w-64">
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-base font-medium">Auto-commit</p>
              <p className="text-muted-foreground">
                Writes are committed on a rolling window, not per keystroke.
              </p>
            </div>
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
        name="CommandDialog"
        purpose="Filterable rows over a query — the palette, exactly as the product opens it."
      >
        <Button variant="secondary" onClick={() => setPaletteOpen(true)}>
          Open palette
        </Button>
        <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
          <CommandInput placeholder="Search notes or commands…" />
          <CommandList>
            <CommandEmpty>Nothing matches.</CommandEmpty>
            <CommandGroup heading="Notes">
              <CommandItem>Release checklist</CommandItem>
              <CommandItem>Weekly review</CommandItem>
            </CommandGroup>
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
        </CommandDialog>
      </Demo>
    </GallerySection>
  );
}
