'use client';

import React from 'react';

import { useToggleLeftPanel } from '@/hooks/useResizablePanel';
import { cn } from '@/lib/utils';
import { Button } from '@/registry/ui/button';

export const CloseButton = ({ children }: React.PropsWithChildren) => {
  const toggle = useToggleLeftPanel();

  return (
    <Button
      size="iconSm"
      variant="nav"
      className={cn('opacity-0 group-hover/sidebar:opacity-100')}
      onClick={() => toggle()}
      tooltip="Close sidebar"
      tooltipContentProps={{
        side: 'right',
      }}
    >
      {children}
    </Button>
  );
};
