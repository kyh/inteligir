// Reveal and Open reach the OS through main, which resolves the entry against the vault and
// refuses anything outside it; the page only ever names a vault-relative path. Outside the
// shell there is no bridge and no such row.

import { toast } from "@repo/ui/components/sonner";
import type { DesktopPathsBridge } from "../../types";

export const desktopPaths = (): DesktopPathsBridge | undefined => window.desktopBridge?.paths;

// a refusal is main's, in main's words; a broken bridge is one sentence, never a stack
const settlePathAction = async (
  action: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  fallback: string,
): Promise<void> => {
  let result;
  try {
    result = await action();
  } catch {
    toast.error(fallback);
    return;
  }
  if (!result.ok) {
    toast.error(result.reason);
  }
};

export const runPathAction = (
  action: () => Promise<{ ok: true } | { ok: false; reason: string }>,
  fallback: string,
): void => {
  void settlePathAction(action, fallback);
};
