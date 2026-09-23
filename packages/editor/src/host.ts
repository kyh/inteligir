import { useStore } from "zustand";

import { getEditorHostIo } from "@repo/editor/host-io";
import type { LinkResolver, VaultActions } from "@repo/editor/host-io";
import { useOpenNotePath } from "@repo/editor/note/open-note-context";
import { mdLinkTarget } from "@repo/notes/knowledge/link-extract";

// React's door to the host singleton; anything outside a component reads getEditorHostIo() itself.

export const useVaultActions = (): VaultActions => getEditorHostIo().actions;

export const useLinkResolver = (): LinkResolver => useStore(getEditorHostIo().linkResolver);

export interface VaultLinkTarget {
  target: string;
  /** null while the listing holds no such file */
  path: string | null;
}

// An md url in the open note, read and resolved as the knowledge index does; null for a url
// no vault path answers (a scheme, `//host`, a same-note `#anchor`).
export const useVaultLinkTarget = (url: string): VaultLinkTarget | null => {
  const { resolveMdTarget } = useLinkResolver();
  const notePath = useOpenNotePath();
  const target = mdLinkTarget(url);
  if (target === null) {
    return null;
  }
  return { path: notePath === null ? null : resolveMdTarget(target, notePath), target };
};
