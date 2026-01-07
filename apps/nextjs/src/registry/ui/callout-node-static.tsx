import { SlateElement, type SlateElementProps } from 'platejs/static';
import * as React from 'react';

export function CalloutElementStatic(props: SlateElementProps) {
  return (
    <SlateElement
      className="my-1 flex rounded-sm bg-muted p-4 pl-3"
      style={{
        backgroundColor: props.element.backgroundColor as any,
      }}
      {...props}
    >
      <div className="flex w-full gap-2 rounded-md">
        <div
          className="size-6 select-none text-[18px]"
          style={{
            fontFamily:
              '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols',
          }}
        >
          <span data-plate-prevent-deserialization>
            {(props.element.icon as any) || '💡'}
          </span>
        </div>
        <div className="w-full">{props.children}</div>
      </div>
    </SlateElement>
  );
}
