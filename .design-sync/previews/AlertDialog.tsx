import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  Button,
} from "@repo/ui";

export function DeleteNote() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this note permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            "Q3 Research Notes" and its markdown file will be removed from your vault on disk. This
            can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary">Cancel</Button>
          <Button variant="destructive">Delete note</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DiscardChanges() {
  return (
    <AlertDialog defaultOpen>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Discard agent edit?</AlertDialogTitle>
          <AlertDialogDescription>
            Restoring the original reverts the background agent's changes byte-for-byte.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="secondary">Keep</Button>
          <Button variant="destructive">Restore</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
