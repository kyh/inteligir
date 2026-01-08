'use client';

import { AIChatPlugin } from '@platejs/ai/react';
import { useQuery } from '@tanstack/react-query';
import { usePluginOption } from 'platejs/react';
import { useMemo } from 'react';

import { yjsPlugin } from '@/components/editor/plate-provider';
import { env } from '@/env';
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
  const { data: documentId } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.id,
  });
  const { data: isPublished } = useQuery({
    ...queryOptions,
    select: (data) => data.document?.isPublished,
  });

  const fontFamily = useMemo(
    () => ({
      fontFamily: TEXT_STYLE_ITEMS.find((item) => item.key === textStyle)
        ?.fontFamily,
    }),
    [textStyle]
  );

  const isYjsReady = usePluginOption(yjsPlugin, 'isReady');
  const isYjsEnabled = Boolean(
    documentId && isPublished && env.NEXT_PUBLIC_YJS_URL
  );

  // Show loading state if Yjs is enabled but not ready yet
  if (isYjsEnabled && !isYjsReady) {
    return (
      <div>
        <div className="mx-auto mt-10 md:max-w-3xl lg:max-w-4xl">
          <div className="space-y-4 pt-4 pl-8">
            <Skeleton className="h-6 w-2/5" />
            <Skeleton className="h-8 w-3/5" />
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <div className="mt-4 text-center text-muted-foreground text-sm">
            Connecting to collaboration server...
          </div>
        </div>
      </div>
    );
  }
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
    <div className="mt-2 flex-1" ref={contentRef}>
      {toc && mode !== 'print' && (
        <TocSidebar className="top-[130px]" topOffset={30} />
      )}

      <EditorContainer>
        <Editor
          className={cn(smallText && 'text-sm')}
          style={fontFamily}
          variant={fullWidth ? 'fullWidth' : 'default'}
        />
      </EditorContainer>
    </div>
  );
};
