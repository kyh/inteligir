'use client';

import { PencilLineIcon } from 'lucide-react';
import { useEditorPlugin, usePluginOption } from 'platejs/react';
import React from 'react';

import { useAuthGuard } from '@/components/auth/useAuthGuard';
import { suggestionPlugin } from '@/components/editor/plugins/suggestion-kit-app';
import { cn } from '@/lib/utils';
import { ToolbarButton } from '@/registry/ui/toolbar';

export function SuggestionToolbarButton() {
  const { setOption } = useEditorPlugin(suggestionPlugin);
  const isSuggesting = usePluginOption(suggestionPlugin, 'isSuggesting');
  const authGuard = useAuthGuard();

  return (
    <ToolbarButton
      className={cn(isSuggesting && 'text-brand/80 hover:text-brand/80')}
      onClick={() => authGuard(() => setOption('isSuggesting', !isSuggesting))}
      onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
      tooltip={isSuggesting ? 'Turn off suggesting' : 'Suggestion edits'}
    >
      <PencilLineIcon />
    </ToolbarButton>
  );
}
