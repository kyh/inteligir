'use client';

import { useMemo } from 'react';

import { AIChatPlugin } from '@platejs/ai/react';
import { useQuery } from '@tanstack/react-query';
import { usePluginOption } from 'platejs/react';

import { cn } from '@/lib/utils';
import { Editor, EditorContainer } from '@/registry/ui/editor';
import { TocSidebar } from '@/registry/ui/toc-sidebar';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

import { TEXT_STYLE_ITEMS } from '../navbar/document-menu';
import { Skeleton } from '../ui/skeleton';

export const PlateEditor = ({ mode }: { mode?: 'print' }) => {
  const queryOptions = useDocumentQueryOptions();

  const contentRef = usePluginOption(AIChatPlugin, 'contentRef') as any;

  const { data: toc = true, isLoading } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.toc,
  });
  const { data: fullWidth } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.fullWidth,
  });
  const { data: smallText } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.smallText,
  });
  const { data: textStyle } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.textStyle,
  });

  const fontFamily = useMemo(
    () => ({
      fontFamily: TEXT_STYLE_ITEMS.find((item) => item.key === textStyle)
        ?.fontFamily,
    }),
    [textStyle]
  );

  if (isLoading) {
    return (
      <div>
        <div className="mx-auto mt-10 md:max-w-3xl lg:max-w-4xl">
          <div className="space-y-4 pt-4 pl-8">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={contentRef} className="mt-2 flex-1">
      {toc && mode !== 'print' && (
        <TocSidebar className="top-[130px]" topOffset={30} />
      )}

      <EditorContainer>
        <Editor
          variant={fullWidth ? 'fullWidth' : 'default'}
          className={cn(smallText && 'text-sm')}
          style={fontFamily}
        />
      </EditorContainer>
    </div>
  );
};
