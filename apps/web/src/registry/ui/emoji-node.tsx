'use client';

import { EmojiInlineIndexSearch, insertEmoji } from '@platejs/emoji';
import { EmojiPlugin } from '@platejs/emoji/react';
import type { PlateElementProps } from 'platejs/react';
import { PlateElement, usePluginOption } from 'platejs/react';
import * as React from 'react';

import { useDebounce } from '@/registry/hooks/use-debounce';

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxInput,
  InlineComboboxItem,
} from './inline-combobox';

const EMOJI_REGEX = /:$/;

export function EmojiInputElement(props: PlateElementProps) {
  const data = usePluginOption(EmojiPlugin, 'data')!;
  const { children, editor, element } = props;
  const [value, setValue] = React.useState('');

  const debouncedValue = useDebounce(value, 100);
  const isPending = value !== debouncedValue;

  const filteredEmojis = React.useMemo(() => {
    if (debouncedValue.trim().length === 0) return [];

    return EmojiInlineIndexSearch.getInstance(data)
      .search(debouncedValue.replace(EMOJI_REGEX, ''))
      .get();
  }, [data, debouncedValue]);

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox
        element={element}
        filter={false}
        hideWhenNoValue
        setValue={setValue}
        trigger=":"
        value={value}
      >
        <InlineComboboxInput />

        <InlineComboboxContent variant="emoji">
          {!isPending && <InlineComboboxEmpty>No results</InlineComboboxEmpty>}

          <InlineComboboxGroup>
            {filteredEmojis.map((emoji) => (
              <InlineComboboxItem
                key={emoji.id}
                onClick={() => insertEmoji(editor, emoji)}
                value={emoji.name}
              >
                <div
                  style={{
                    fontFamily:
                      '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
                  }}
                >
                  {emoji.skins[0].native}
                </div>
                <div className="ml-1.5">{emoji.name}</div>
              </InlineComboboxItem>
            ))}
          </InlineComboboxGroup>
        </InlineComboboxContent>
      </InlineCombobox>

      {children}
    </PlateElement>
  );
}
