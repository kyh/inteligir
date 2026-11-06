import { useStore } from "zustand";

import { getEditorHostIo } from "@repo/editor/host-io";
import type { LinkResolver, PickerTarget } from "@repo/editor/host-io";

// React's door to the host singleton; anything outside a component reads getEditorHostIo() itself.

export const useLinkResolver = (): LinkResolver => useStore(getEditorHostIo().linkResolver);

export const useLinkTargets = (): readonly PickerTarget[] =>
  useStore(getEditorHostIo().linkResolver, (resolver) => resolver.targets);
