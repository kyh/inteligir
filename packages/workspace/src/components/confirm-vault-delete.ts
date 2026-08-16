import { confirm } from "@repo/ui/components/confirm-dialog";

/** The one delete-confirm for vault files. There is no trash view and no
 * restore channel, so the copy may not offer one — `docs/privacy.md` is what
 * this has to agree with. */
export const confirmVaultDelete = (path: string): Promise<boolean> =>
  confirm({
    title: `Delete ${path}?`,
    body: "This removes it from your vault. It can't be undone.",
    confirmLabel: "Delete",
    destructive: true,
  });
