'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { Label as LabelPrimitive } from 'radix-ui';
import * as React from 'react';

import { cn } from '@/lib/utils';

const labelVariants = cva(
  'font-medium text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
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
