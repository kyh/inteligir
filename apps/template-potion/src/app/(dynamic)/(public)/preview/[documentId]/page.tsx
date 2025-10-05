import type { PageProps } from '@/lib/navigation/next-types';

import { HydrateClient, trpc } from '@/trpc/server';

import { DocumentPreviewClient } from './document-preview-client';

export default async function DocumentPreviewPage(
  props: PageProps<{ documentId: string }>
) {
  const { documentId } = await props.params;
  void trpc.document.document.prefetch({ id: documentId });

  return (
    <HydrateClient>
      <DocumentPreviewClient />
    </HydrateClient>
  );
}
