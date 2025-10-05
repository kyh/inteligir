import { DevToolsServer } from '@/components/dev/dev-tools-server';
import { TRPCReactProvider } from '@/trpc/react';

export function ProvidersServer({ children }) {
  return (
    <TRPCReactProvider>
      <DevToolsServer>{children}</DevToolsServer>
    </TRPCReactProvider>
  );
}
