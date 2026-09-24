import { useStore } from "zustand";

import { getEditorHostIo } from "@repo/editor/host-io";
import type { LinkResolver, VaultActions } from "@repo/editor/host-io";
import { mdLinkTarget } from "@repo/notes/knowledge/link-extract";
import type { WikiTarget } from "@repo/notes/knowledge/link-graph-index";

// React's door to the host singleton; anything outside a component reads getEditorHostIo() itself.

export const useVaultActions = (): VaultActions => getEditorHostIo().actions;

export const useLinkResolver = (): LinkResolver => useStore(getEditorHostIo().linkResolver);

export const useWikiTargets = (): readonly WikiTarget[] =>
  useStore(getEditorHostIo().linkResolver, (resolver) => resolver.targets);

export interface VaultLinkTarget {
  target: string;
  /** null while the listing holds no such file */
  path: string | null;
}

// An md url written in the note at `notePath` (the open note, or the note an embed shows), read
// and resolved as the knowledge index does; null for a url no vault path answers (a scheme,
// `//host`, a same-note `#anchor`).
export const useVaultLinkTarget = (
  url: string,
  notePath: string | null,
): VaultLinkTarget | null => {
  const { resolveMdTarget } = useLinkResolver();
  const target = mdLinkTarget(url);
  if (target === null) {
    return null;
  }
  return { path: notePath === null ? null : resolveMdTarget(target, notePath), target };
};
