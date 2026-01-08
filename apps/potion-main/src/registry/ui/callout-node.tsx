'use client';

import { useCalloutEmojiPicker } from '@platejs/callout/react';
import { useEmojiDropdownMenuState } from '@platejs/emoji/react';
import { PlateElement, type PlateElementProps } from 'platejs/react';
import * as React from 'react';

import { Button } from './button';
import { EmojiPicker, EmojiPopover } from './emoji-toolbar-button';

export function CalloutElement(props: PlateElementProps) {
  const { emojiPickerState, isOpen, setIsOpen } = useEmojiDropdownMenuState({
    closeOnSelect: true,
  });

  const { emojiToolbarDropdownProps, props: calloutProps } =
    useCalloutEmojiPicker({
      isOpen,
      setIsOpen,
    });

  return (
    <PlateElement
      className="my-1 flex rounded-sm bg-muted p-4 pl-3"
      style={{
        backgroundColor: props.element.backgroundColor as any,
      }}
      {...props}
      attributes={{
        ...props.attributes,
        'data-plate-open-context-menu': 'true',
      }}
    >
      <div className="flex w-full gap-2 rounded-md">
        <EmojiPopover
          {...emojiToolbarDropdownProps}
          control={
            <Button
              className="size-6 select-none p-1 text-[18px] hover:bg-muted-foreground/15"
              contentEditable={false}
              style={{
                fontFamily:
                  '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
              }}
              variant="ghost"
            >
              {(props.element.icon as any) || '💡'}
            </Button>
          }
        >
          <EmojiPicker {...emojiPickerState} {...calloutProps} />
        </EmojiPopover>
        <div className="w-full">{props.children}</div>
      </div>
    </PlateElement>
  );
}
