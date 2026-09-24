import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/components/alert-dialog";

// no action and no dismissal: it leaves when the server next answers this page, and the workspace
// underneath stays mounted so an unsaved edit is still there when it does.
export const SignedOutNotice = () => (
  <AlertDialog open>
    <AlertDialogContent size="sm">
      {window.desktopBridge === undefined ? (
        <AlertDialogHeader>
          <AlertDialogTitle>This tab is signed out</AlertDialogTitle>
          <AlertDialogDescription>
            The server restarted, or this tab&apos;s sign-in expired. Run{" "}
            <code>inteligir open</code> in a terminal, or choose Help → Open in Browser in the
            desktop app, and this tab picks the new sign-in up by itself.
          </AlertDialogDescription>
        </AlertDialogHeader>
      ) : (
        <AlertDialogHeader>
          <AlertDialogTitle>This window lost the local server</AlertDialogTitle>
          <AlertDialogDescription>
            The server restarted and no longer accepts this window. Quit and reopen inteligir to
            reconnect.
          </AlertDialogDescription>
        </AlertDialogHeader>
      )}
    </AlertDialogContent>
  </AlertDialog>
);
