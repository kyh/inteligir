import { Toaster as ToasterPrimitive } from 'sonner';

import { Spinner } from '@/registry/ui/spinner';

export function Toaster() {
  return (
    <ToasterPrimitive
      icons={{
        loading: <Spinner />,
      }}
      position="bottom-center"
      toastOptions={{
        duration: 3000,
      }}
      visibleToasts={1}
    />
  );
}
