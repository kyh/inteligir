import { SlateElement, type SlateElementProps } from 'platejs/static';
import * as React from 'react';

export function BlockquoteElementStatic(props: SlateElementProps) {
  return (
    <SlateElement as="blockquote" className="my-1 px-0.5 py-[3px]" {...props}>
      <div className="border-primary border-l-[3px] px-4">{props.children}</div>
    </SlateElement>
  );
}
