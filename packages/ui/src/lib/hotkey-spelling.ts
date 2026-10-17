// One spelling for a chord on screen: the editor's toolbar, the palette's shortcuts page and
// the rail's hints all read the same is-hotkey string and spell it for the keyboard in use.

export type ShortcutModifier = "meta" | "ctrl";

// never "either": on mac the editor's Ctrl-K is an emacs line kill, and both modifiers would double-fire.
export const platformShortcutModifier = (): ShortcutModifier =>
  /mac|iphone|ipad|ipod/iu.test(navigator.userAgent) ? "meta" : "ctrl";

// Apple's menu order (⌃⌥⇧⌘) on a mac keyboard, words elsewhere; off a mac `mod` is Ctrl, so the
// two collapse into one cap
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

// the glyph a named key is drawn with, on every keyboard, by the key's capitalized name; any other
// key is that name
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

const keyCap = (key: string): string => {
  const named = key.charAt(0).toUpperCase() + key.slice(1);
  return KEY_CAPS.get(named) ?? named;
};

// one entry per key, for a surface that draws a box per key
export const hotkeyCaps = (hotkey: string, modifier: ShortcutModifier): string[] => {
  const parts = hotkey.split("+");
  const key = parts.at(-1) ?? "";
  const mods = new Set(parts.slice(0, -1));
  const modifierCaps = MODIFIER_CAPS[modifier]
    .filter((row) => row.spells.some((mod) => mods.has(mod)))
    .map((row) => row.cap);
  return [...modifierCaps, keyCap(key)];
};

// a mac keyboard runs its glyphs together; words are joined with +
export const spellHotkey = (hotkey: string, modifier: ShortcutModifier): string =>
  hotkeyCaps(hotkey, modifier).join(modifier === "meta" ? "" : "+");
