'use client';

import { PlateElement, type PlateElementProps } from 'platejs/react';
import * as React from 'react';

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement as="blockquote" className="my-1 px-0.5 py-[3px]" {...props}>
      <div className="border-primary border-l-[3px] px-4">{props.children}</div>
    </PlateElement>
  );
}
