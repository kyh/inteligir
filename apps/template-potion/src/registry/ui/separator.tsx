'use client';

import * as React from 'react';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { type VariantProps, cva } from 'class-variance-authority';

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
      orientation={orientation}
      className={cn(
        separatorVariants({
          orientation,
        }),
        className
      )}
      decorative={decorative}
      {...props}
    />
  );
}
