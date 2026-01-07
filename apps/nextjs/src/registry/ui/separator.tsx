'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Separator as SeparatorPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

const separatorVariants = cva('shrink-0 bg-border', {
  defaultVariants: {
    orientation: 'horizontal',
  },
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      vertical: 'h-full w-px',
    },
  },
});

export function Separator({
  className,
  decorative = true,
  orientation = 'horizontal',
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root> &
  VariantProps<typeof separatorVariants>) {
  return (
    <SeparatorPrimitive.Root
      className={cn(
        separatorVariants({
          orientation,
        }),
        className
      )}
      decorative={decorative}
      orientation={orientation}
      {...props}
    />
  );
}
