import type { EditorProfile } from "@repo/editor/editor-profile";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { TOUCH_EDITOR_KIT } from "@repo/editor/kits/touch-editor-kit";

export const PROFILE_KITS: Record<
  EditorProfile,
  ((typeof EDITOR_KIT)[number] | (typeof TOUCH_EDITOR_KIT)[number])[]
> = { desktop: EDITOR_KIT, touch: TOUCH_EDITOR_KIT };
