import { confirm } from "@repo/ui/components/confirm-dialog";

/** The one delete-confirm for vault files. User deletes go to the OS trash
 * (CLAUDE.md § Decisions), so the copy says recoverable, not permanent. */
export const confirmVaultDelete = (path: string): Promise<boolean> =>
  confirm({
    title: `Delete ${path}?`,
    body: "Moves the file to your system trash.",
    confirmLabel: "Delete",
    destructive: true,
  });
