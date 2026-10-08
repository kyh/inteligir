import { platformShortcutModifier } from "@repo/ui/lib/hotkey-spelling";

export const chord = (key: string): KeyboardEventInit =>
  platformShortcutModifier() === "meta" ? { key, metaKey: true } : { ctrlKey: true, key };

export const sidebarState = (side: "left" | "right"): string | null =>
  document.querySelector<HTMLElement>(`[data-slot="sidebar"][data-side="${side}"]`)?.dataset
    .state ?? null;
