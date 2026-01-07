'use client';

import { useSession } from '@/components/auth/useSession';
import { useTParams } from '@/hooks/use-navigation';
import { useTRPC } from '@/trpc/react';

export function useDocumentQueryOptions() {
  const { documentId } = useTParams<'/[documentId]'>();
  const session = useSession();

  return {
    ...useTRPC().document.document.queryOptions({
      id: documentId,
    }),
    enabled: !!session && !!documentId,
    // Prevent automatic refetch that might override optimistic updates
    staleTime: 2000, // Consider data fresh for 2 seconds
  };
}

export function useDiscussionsQueryOptions() {
  const { documentId } = useTParams<'/[documentId]'>();

  return useTRPC().comment.discussions.queryOptions({
    documentId,
  });
}

export function useDocumentVersionsQueryOptions() {
  const { documentId } = useTParams<'/[documentId]'>();

  return useTRPC().version.documentVersions.queryOptions({
    documentId,
  });
}
