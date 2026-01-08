import { isAuth } from '@/components/auth/rsc/auth';
import { AuthProvider } from '@/components/auth/rsc/auth-provider';
import { DynamicModalProvider } from '@/components/modals';
import { DynamicModalEffect } from '@/components/modals/dynamic-modal-effect';
import { HydrateClient, trpc } from '@/trpc/server';

export default async function DynamicLayout({ children }) {
  if (await isAuth()) {
    void trpc.layout.app.prefetch();
  }

  return (
    <HydrateClient>
      <AuthProvider>
        {children}

        <DynamicModalProvider />
        <DynamicModalEffect />
      </AuthProvider>
    </HydrateClient>
  );
}
