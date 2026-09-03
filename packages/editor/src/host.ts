import { useStore } from "zustand";

import { getEditorHostIo, type VaultActions, type VaultListing } from "@repo/editor/host-io";

// React's door to the host singleton; anything outside a component reads getEditorHostIo() itself.

export function useVaultActions(): VaultActions {
  return getEditorHostIo().actions;
}

export function useVaultListing(): VaultListing {
  return useStore(getEditorHostIo().listing);
}
