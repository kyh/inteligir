'use client';

import React from 'react';

import { Icons } from '@/components/ui/icons';

export const Empty = ({ title }: { title?: string }) => (
  <div className="flex size-full items-center justify-center">
    <div className="flex flex-col items-center">
      <Icons.messages className="size-14" variant="muted" />
      <span className="mt-3 font-semibold text-muted-foreground text-sm">
        {' '}
        {title ?? 'No relevant data found.'}
      </span>
    </div>
  </div>
);
