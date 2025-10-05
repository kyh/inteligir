'use client';

import React from 'react';

import { useQuery } from '@tanstack/react-query';

import { useOrigin } from '@/hooks/useOrigin';
import { useDocumentId } from '@/lib/navigation/routes';
import { LinkButton } from '@/registry/ui/button';
import { useDocumentQueryOptions } from '@/trpc/hooks/query-options';

import { Icons } from '../ui/icons';

export const PublishedBanner = () => {
  const { data: isPublished } = useQuery({
    ...useDocumentQueryOptions(),
    select: (data) => data.document?.isPublished,
  });

  const documentId = useDocumentId();
  const origin = useOrigin();

  if (!isPublished) {
    return null;
  }

  const url = `${origin}/preview/${documentId!}`;

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-4 bg-blue-50 px-3 py-2 text-center text-sm text-brand">
      <p className="font-medium">This page is live</p>

      <div className="flex flex-wrap items-center gap-2">
        <LinkButton
          variant="outline"
          className="border-brand bg-inherit font-medium text-brand hover:bg-black/5 hover:text-brand"
          href={url}
          target="_blank"
        >
          <Icons.globe className="text-brand" />
          View site
        </LinkButton>
      </div>
    </div>
  );
};
