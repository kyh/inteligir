'use client';

import type { ReactNode } from 'react';
import * as React from 'react';

import { useMounted } from '@/registry/hooks/use-mounted';

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  suspense?: boolean;
};

export const ClientOnly = ({ children, fallback = null }: Props) => {
  const mounted = useMounted();

  if (!mounted) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
};
