import { isAuth } from '@/components/auth/rsc/auth';
import { HydrateClient, trpc } from '@/trpc/server';

import { DocumentClient } from './document-client';
import { PublicDocumentClient } from './public-document-client';

export default async function DocumentPage(props: PageProps<'/[documentId]'>) {
  const { documentId } = await props.params;
  const session = await isAuth();

  if (session) {
    void trpc.document.document.prefetch({ id: documentId });
  }

  return (
    <HydrateClient>
      {session ? <DocumentClient /> : <PublicDocumentClient />}
    </HydrateClient>
  );
}
