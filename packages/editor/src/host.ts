import { useStore } from "zustand";

import { getEditorHostIo } from "@repo/editor/host-io";
import type { VaultActions, WikiResolver } from "@repo/editor/host-io";

// React's door to the host singleton; anything outside a component reads getEditorHostIo() itself.

export const useVaultActions = (): VaultActions => getEditorHostIo().actions;

export const useWikiResolver = (): WikiResolver => useStore(getEditorHostIo().wikiResolver);
