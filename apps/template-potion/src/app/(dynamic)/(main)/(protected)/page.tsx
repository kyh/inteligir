import { Home } from '@/app/(dynamic)/(main)/(protected)/home';
import { isAuth } from '@/components/auth/rsc/auth';
import { HydrateClient, trpc } from '@/trpc/server';

export default async function HomePage() {
  const session = await isAuth();

  if (session) {
    void trpc.document.documents.prefetch({});
  }

  return (
    <HydrateClient>
      <Home />
    </HydrateClient>
  );
}
