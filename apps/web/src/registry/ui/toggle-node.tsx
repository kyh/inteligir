import { useToggleButton, useToggleButtonState } from '@platejs/toggle/react';
import { ChevronRightIcon } from 'lucide-react';
import {
  PlateElement,
  type PlateElementProps,
  useElement,
} from 'platejs/react';
import * as React from 'react';

import { cn } from '@/lib/utils';

export function ToggleElement(props: PlateElementProps) {
  const element = useElement();
  const state = useToggleButtonState(element.id as string);
  const { buttonProps, open } = useToggleButton(state);

  return (
    <PlateElement {...props} className="mb-1 pl-6">
      <div>
        <span
          className="absolute top-0.5 left-0 flex cursor-pointer select-none items-center justify-center rounded-sm p-px transition-bg-ease hover:bg-slate-200"
          contentEditable={false}
          {...buttonProps}
        >
          <ChevronRightIcon
            className={cn(
              'transition-transform duration-75',
              open ? 'rotate-90' : 'rotate-0'
            )}
          />
        </span>
        {props.children}
      </div>
    </PlateElement>
  );
}
