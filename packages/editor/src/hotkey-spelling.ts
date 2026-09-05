// One spelling for a chord on screen: the editor's toolbar, the palette's shortcuts page and
// the rail's hints all read the same is-hotkey string and spell it for the keyboard in use.

export type ShortcutModifier = "meta" | "ctrl";

// never "either": on mac the editor's Ctrl-K is an emacs line kill, and both modifiers would double-fire.
export function platformShortcutModifier(): ShortcutModifier {
  return /mac|iphone|ipad|ipod/iu.test(navigator.userAgent) ? "meta" : "ctrl";
}

// Apple's menu order (⌃⌥⇧⌘) on a mac keyboard; words joined with + elsewhere
export function spellHotkey(hotkey: string, modifier: ShortcutModifier): string {
  const parts = hotkey.split("+");
  const key = parts.at(-1) ?? "";
  const mods = new Set(parts.slice(0, -1));
  const keyLabel = key.charAt(0).toUpperCase() + key.slice(1);
  if (modifier === "meta") {
    return `${mods.has("ctrl") ? "⌃" : ""}${mods.has("alt") ? "⌥" : ""}${mods.has("shift") ? "⇧" : ""}${mods.has("mod") ? "⌘" : ""}${keyLabel}`;
  }
  return [
    mods.has("ctrl") || mods.has("mod") ? "Ctrl" : null,
    mods.has("alt") ? "Alt" : null,
    mods.has("shift") ? "Shift" : null,
    keyLabel,
  ]
    .filter((part) => part !== null)
    .join("+");
}
