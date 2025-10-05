'use client';

import { useEffect } from 'react';

import type { BaseSuggestionConfig } from '@platejs/suggestion';
import type { ExtendConfig, Path } from 'platejs';

import { useCurrentUser } from '@/components/auth/useCurrentUser';
import { BlockSuggestion } from '@/components/editor/ui/block-suggestion-app';
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
    belowNodes: SuggestionLineBreak,
    node: SuggestionLeaf,
    belowRootNodes: ({ api, element }) => {
      if (!api.suggestion!.isBlockSuggestion(element)) {
        return null;
      }

      return <BlockSuggestion element={element} />;
    },
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
