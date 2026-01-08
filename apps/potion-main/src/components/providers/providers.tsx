'use client';

import { NuqsAdapter } from 'nuqs/adapters/next/app';
import * as React from 'react';

import { VersionProvider } from '@/components/editor/version-history/version-history-panel';
import { StaticModalProvider } from '@/components/modals';
import { AppProvider } from '@/components/providers/app-provider';
import { TailwindProvider } from '@/components/providers/tailwind-provider';
import { ThemeProvider } from '@/components/providers/theme-provider';

export function Providers({ children }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableColorScheme
      enableSystem
    >
      <TailwindProvider>
        <NuqsAdapter>
          <AppProvider>
            <VersionProvider>
              {children}
              <StaticModalProvider />
            </VersionProvider>
          </AppProvider>
        </NuqsAdapter>
      </TailwindProvider>
    </ThemeProvider>
  );
}
