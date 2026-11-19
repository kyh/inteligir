export type ShortcutModifier = "meta" | "ctrl";

export const platformShortcutModifier = () =>
  (/mac|iphone|ipad|ipod/iu.test(navigator.userAgent) ? "meta" : "ctrl") satisfies ShortcutModifier;

const MODIFIER_CAPS: Record<
  ShortcutModifier,
  readonly { cap: string; spells: readonly string[] }[]
> = {
  ctrl: [
    { cap: "Ctrl", spells: ["ctrl", "mod"] },
    { cap: "Alt", spells: ["alt"] },
    { cap: "Shift", spells: ["shift"] },
  ],
  meta: [
    { cap: "⌃", spells: ["ctrl"] },
    { cap: "⌥", spells: ["alt"] },
    { cap: "⇧", spells: ["shift"] },
    { cap: "⌘", spells: ["mod"] },
  ],
};

const KEY_CAPS = new Map([
  ["Backspace", "⌫"],
  ["Down", "↓"],
  ["Enter", "↩"],
  ["Esc", "Esc"],
  ["Escape", "Esc"],
  ["Left", "←"],
  ["Right", "→"],
  ["Space", "Space"],
  ["Up", "↑"],
]);

const keyCap = (key: string) => {
  const named = key.charAt(0).toUpperCase() + key.slice(1);

  return KEY_CAPS.get(named) ?? named;
};

export const hotkeyCaps = (hotkey: string, modifier: ShortcutModifier) => {
  const parts = hotkey.split("+");
  const key = parts.at(-1) ?? "";
  const mods = new Set(parts.slice(0, -1));

  const modifierCaps = MODIFIER_CAPS[modifier]
    .filter((row) => row.spells.some((mod) => mods.has(mod)))
    .map((row) => row.cap);

  return [...modifierCaps, keyCap(key)] satisfies string[];
};

export const spellHotkey = (hotkey: string, modifier: ShortcutModifier) =>
  hotkeyCaps(hotkey, modifier).join(modifier === "meta" ? "" : "+");
