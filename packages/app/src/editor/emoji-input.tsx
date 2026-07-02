// Emoji `:shortcode:` autocomplete riding the existing inline-combobox (the
// same surface the slash menu uses — WP3's Base UI rebuild swaps underneath
// without edits here). Selecting inserts plain unicode text — zero
// serialization surface. @emoji-mart/data (~430KB json) loads via dynamic
// import on first trigger, never in the initial chunk.

import { useEffect, useMemo, useState } from "react";
import { EmojiInlineIndexSearch, insertEmoji } from "@platejs/emoji";
import type { EmojiMartData } from "@emoji-mart/data";
import { PlateElement, type PlateElementProps } from "platejs/react";

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from "@repo/app/editor/inline-combobox";

function isEmojiData(value: unknown): value is EmojiMartData {
  return typeof value === "object" && value !== null && "emojis" in value && "categories" in value;
}

let emojiDataPromise: Promise<EmojiMartData> | null = null;
function loadEmojiData(): Promise<EmojiMartData> {
  if (!emojiDataPromise) {
    emojiDataPromise = import("@emoji-mart/data").then((mod) => {
      // The json module's synthesized-default typing is a union; narrow it.
      const data: unknown = mod.default;
      if (isEmojiData(data)) return data;
      throw new Error("@emoji-mart/data loaded without emoji tables");
    });
  }
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
