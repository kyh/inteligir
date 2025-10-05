'use client';

import * as React from 'react';

import * as LabelPrimitive from '@radix-ui/react-label';
import { type VariantProps, cva } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const labelVariants = cva(
  'text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

export function Label({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & {
  disabled?: boolean;
} & VariantProps<typeof labelVariants>) {
  return (
    <LabelPrimitive.Root
      className={cn(
        labelVariants(),
        disabled && 'cursor-not-allowed text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}
