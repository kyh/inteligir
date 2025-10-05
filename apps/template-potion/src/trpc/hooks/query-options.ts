'use client';

import { useSession } from '@/components/auth/useSession';
import { useDocumentId } from '@/lib/navigation/routes';
import { useTRPC } from '@/trpc/react';

export function useDocumentQueryOptions() {
  const documentId = useDocumentId();
  const session = useSession();

  return {
    ...useTRPC().document.document.queryOptions({
      id: documentId,
    }),
    enabled: !!session && !!documentId,
  };
}

export function useDiscussionsQueryOptions() {
  const documentId = useDocumentId();

  return useTRPC().comment.discussions.queryOptions({
    documentId,
  });
}

export function useDocumentVersionsQueryOptions() {
  const documentId = useDocumentId();

  return useTRPC().version.documentVersions.queryOptions({
    documentId,
  });
}
