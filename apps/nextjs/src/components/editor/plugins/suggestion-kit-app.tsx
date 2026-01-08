'use client';

import type { BaseSuggestionConfig } from '@platejs/suggestion';
import type { ExtendConfig, Path } from 'platejs';
import { useEffect } from 'react';

import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { suggestionPlugin as SuggestionPlugin } from '@/registry/components/editor/plugins/suggestion-kit';
import {
  SuggestionLeaf,
  SuggestionLineBreak,
} from '@/registry/ui/suggestion-node';

export type SuggestionConfig = ExtendConfig<
  BaseSuggestionConfig,
  {
    activeId: string | null;
    hoverId: string | null;
    uniquePathMap: Map<string, Path>;
  }
>;

export const suggestionPlugin = SuggestionPlugin.configure({
  render: {
    belowNodes: SuggestionLineBreak as any,
    node: SuggestionLeaf,
  },
  useHooks: ({ setOption }) => {
    const user = useCurrentUser();

    useEffect(() => {
      if (!user?.id) return;

      setOption('currentUserId', user.id);
    }, [setOption, user]);
  },
});

export const SuggestionKit = [suggestionPlugin];
