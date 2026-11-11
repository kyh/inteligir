// The kit each hand mounts: the desktop's, or the phone's touch kit.

import type { EditorProfile } from "@repo/editor/editor-profile";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";

// typed by the union of both kits' plugins, since usePlateEditor infers its plugin type from one
// array and refuses a union of two
export const PROFILE_KITS: Record<
  EditorProfile,
  ((typeof EDITOR_KIT)[number] | (typeof TOUCH_EDITOR_KIT)[number])[]
> = { desktop: EDITOR_KIT, touch: TOUCH_EDITOR_KIT };
