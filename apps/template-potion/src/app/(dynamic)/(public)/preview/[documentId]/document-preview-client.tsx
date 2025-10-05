'use client';

import { useQuery } from '@tanstack/react-query';

import { Cover, CoverSkeleton } from '@/components/cover/cover';
import { DocumentToolbar } from '@/components/cover/document-toolbar';
import { PlateEditor } from '@/components/editor/plate-editor';
import { DocumentPlate } from '@/components/editor/plate-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

export function DocumentPreviewClient() {
  const queryOptions = useDocumentQueryOptions();
  const coverImage = useQuery({
    ...queryOptions,
    select: (data) => data.document?.coverImage,
  });
  const found = useQuery({
    ...queryOptions,
    select: (data) => !!data.document,
  });

  if (coverImage.isLoading) {
    return (
      <div>
        <CoverSkeleton />
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
  if (!found.data) {
    return <div>Not Found</div>;
  }

  return (
    <DocumentPlate>
      <div className="pb-40">
        <Cover preview />
        <div className="mt-10">
          <DocumentToolbar preview />
          <PlateEditor />
        </div>
      </div>
    </DocumentPlate>
  );
}
