'use client';

import * as React from 'react';

import { type PlateElementProps, PlateElement } from 'platejs/react';

export function ParagraphElement(props: PlateElementProps) {
  return (
    <PlateElement
      {...props}
      className="px-0.5 py-[3px]"
      style={{
        backgroundColor: props.element.backgroundColor as any,
      }}
    >
      {props.children}
    </PlateElement>
  );
}
