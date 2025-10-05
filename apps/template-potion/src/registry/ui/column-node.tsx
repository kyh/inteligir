'use client';

import * as React from 'react';

import type { TColumnElement } from 'platejs';

import { ResizableProvider } from '@platejs/resizable';
import {
  type PlateElementProps,
  PlateElement,
  useElement,
  useReadOnly,
  withHOC,
} from 'platejs/react';

import { cn } from '@/lib/utils';

export const ColumnElement = withHOC(
  ResizableProvider,
  function ColumnElement(props: PlateElementProps) {
    const readOnly = useReadOnly();
    const { width } = useElement<TColumnElement>();

    return (
      <PlateElement
        className={cn(!readOnly && 'rounded-lg border border-dashed p-1.5')}
        style={{ width: width ?? '100%' }}
        {...props}
      />
    );
  }
);

export function ColumnGroupElement(props: PlateElementProps) {
  return (
    <PlateElement className="mb-1" {...props}>
      <div className="flex size-full gap-4 rounded">{props.children}</div>
    </PlateElement>
  );
}
