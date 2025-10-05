'use client';

import { AIChatPlugin } from '@platejs/ai/react';
import {
  composeRefs,
  useEditorScrollRef,
  usePluginOption,
} from 'platejs/react';

import { SearchCommand } from '@/components/search/search-command';

export function Main({ children }: { children: React.ReactNode }) {
  const ref = useEditorScrollRef();
  const scrollRef = usePluginOption(AIChatPlugin, 'scrollRef') as any;

  return (
    <main
      id="scroll_container"
      ref={composeRefs(ref, scrollRef)}
      className="relative h-[calc(100vh-44px-2px)] overflow-y-auto"
    >
      <SearchCommand />
      {children}
    </main>
  );
}
