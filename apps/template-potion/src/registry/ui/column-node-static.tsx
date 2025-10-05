import * as React from 'react';

import {
  type SlateElementProps,
  type TColumnElement,
  SlateElement,
} from 'platejs';

export function ColumnElementStatic(props: SlateElementProps<TColumnElement>) {
  const { width } = props.element;

  return (
    <SlateElement
      className="border border-transparent p-1.5"
      style={{ width: width ?? '100%' }}
      {...props}
    />
  );
}

export function ColumnGroupElementStatic(props: SlateElementProps) {
  return (
    <SlateElement className="my-2" {...props}>
      <div className="flex size-full gap-4 rounded">{props.children}</div>
    </SlateElement>
  );
}
