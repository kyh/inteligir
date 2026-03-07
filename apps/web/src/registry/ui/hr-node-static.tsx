import { SlateElement, type SlateElementProps } from 'platejs/static';
import * as React from 'react';

import { cn } from '@/lib/utils';

export function HrElementStatic(props: SlateElementProps) {
  return (
    <SlateElement className="mb-1 py-2" {...props}>
      <div contentEditable={false}>
        <hr
          className={cn(
            'h-0.5 cursor-pointer rounded-sm border-none bg-muted bg-clip-content'
          )}
        />
      </div>
      {props.children}
    </SlateElement>
  );
}
