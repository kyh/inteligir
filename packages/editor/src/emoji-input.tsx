// Emoji `:shortcode:` autocomplete riding the shared inline-combobox (the
// same Base UI surface the slash menu uses).
// Selecting inserts plain unicode text — zero
// serialization surface. @emoji-mart/data (~430KB json) loads via dynamic
// import on first trigger, never in the initial chunk.

import { useEffect, useMemo, useState } from "react";
import { EmojiInlineIndexSearch, insertEmoji } from "@platejs/emoji";
import type { EmojiMartData } from "@emoji-mart/data";
import { PlateElement, type PlateElementProps } from "platejs/react";
import { z } from "zod";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@repo/editor/inline-combobox";

// The package declares `EmojiMartData` but points its entry at a .json file, so
// the loaded value arrives carrying none of that typing. This is the boundary
// that gives it one: the two tables the search index reads are checked, and the
// package's own declaration names the rest — mirroring a 2,000-entry table here
// would only give it something to drift against.
const EMOJI_TABLES = z.object({
  categories: z.array(z.unknown()),
  emojis: z.record(z.string(), z.unknown()),
});
const EMOJI_MART_DATA = z.custom<EmojiMartData>(
  (value) => EMOJI_TABLES.safeParse(value).success,
  "@emoji-mart/data loaded without emoji tables",
);

let emojiDataPromise: Promise<EmojiMartData> | null = null;
function loadEmojiData(): Promise<EmojiMartData> {
  emojiDataPromise ??= import("@emoji-mart/data").then((mod) => EMOJI_MART_DATA.parse(mod.default));
  return emojiDataPromise;
}

export function EmojiInputElement(props: PlateElementProps) {
  const { children, editor, element } = props;
  const [value, setValue] = useState("");
  const [data, setData] = useState<EmojiMartData | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadEmojiData();
      if (!cancelled) setData(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const emojis = useMemo(() => {
    if (!data || value.trim().length === 0) return [];
    return EmojiInlineIndexSearch.getInstance(data).search(value.replace(/:$/, "")).get();
  }, [data, value]);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={element}
        trigger=":"
        value={value}
        setValue={setValue}
        filter={false}
        hideWhenNoValue
      >
        <InlineComboboxInput />
        <InlineComboboxContent>
          {data ? <InlineComboboxEmpty>No results</InlineComboboxEmpty> : null}
          <InlineComboboxGroup>
            {emojis.map((emoji) => (
              <InlineComboboxItem
                key={emoji.id}
                value={emoji.name}
                onClick={() => insertEmoji(editor, emoji)}
              >
                <span
                  className="mr-1.5"
                  style={{
                    fontFamily:
                      '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Segoe UI Symbol", EmojiSymbols',
                  }}
                >
                  {emoji.skins[0]?.native}
                </span>
                {emoji.name}
              </InlineComboboxItem>
            ))}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>
      {children}
    </PlateElement>
  );
}
