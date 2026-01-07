import { Home } from "@/app/(dashboard)/home";
import { HydrateClient, prefetch, trpc } from "@/trpc/server";
import { getSession } from "@repo/api/auth/auth";

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    prefetch(trpc.document.documents.queryOptions({}));
  }

  return (
    <HydrateClient>
      <Home />
    </HydrateClient>
  );
}
