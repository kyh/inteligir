import * as React from 'react';

import TailwindIndicator from '@/components/dev/tailwind-indicator';
import { env } from '@/env';

export function DevToolsServer({ children }: { children: React.ReactNode }) {
  if (env.NODE_ENV === 'production') return <>{children}</>;

  return <TailwindIndicator>{children}</TailwindIndicator>;
}
