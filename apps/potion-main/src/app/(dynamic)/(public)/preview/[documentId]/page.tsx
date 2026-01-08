import { auth } from '@/components/auth/rsc/auth';
import { HydrateClient, trpc } from '@/trpc/server';

import { DocumentPreviewClient } from './document-preview-client';

export default async function DocumentPreviewPage(
  props: PageProps<'/preview/[documentId]'>
) {
  const { documentId } = await props.params;
  const { user } = await auth();

  if (user) {
    void trpc.document.document.prefetch({ id: documentId });
  }

  return (
    <HydrateClient>
      <DocumentPreviewClient />
    </HydrateClient>
  );
}
