import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { getSession } from "@repo/api/auth/auth";

import { DocumentClient } from "./document-client";
import { PublicDocumentClient } from "./public-document-client";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ slug: string; documentId: string }>;
}) {
  const { documentId } = await params;
  const session = await getSession();

  if (session) {
    prefetch(trpc.document.document.queryOptions({ id: documentId }));
  }

  return (
    <HydrateClient>
      {session ? <DocumentClient /> : <PublicDocumentClient />}
    </HydrateClient>
  );
}
