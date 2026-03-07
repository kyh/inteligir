'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';
import { Button } from '@/registry/ui/button';

import { Icons } from '../ui/icons';

type SidebarSectionProps = {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  action?: React.ReactNode;
};

export function SidebarSection({
  title,
  children,
  defaultExpanded = true,
  action,
}: SidebarSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="space-y-0.5">
      <div
        className="group flex min-h-[28px] cursor-pointer items-center gap-1 px-2 py-1"
        onClick={() => setExpanded(!expanded)}
        role="button"
      >
        <Icons.chevronRight
          className={cn(
            'size-3 shrink-0 text-sidebar-text-muted transition-transform duration-200',
            expanded && 'rotate-90'
          )}
        />
        <span className="flex-1 select-none text-xs font-medium uppercase tracking-wide text-sidebar-text-muted">
          {title}
        </span>
        {action && (
          <div
            className="opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            onClick={(e) => e.stopPropagation()}
          >
            {action}
          </div>
        )}
      </div>

      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
