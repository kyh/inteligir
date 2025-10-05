import * as React from 'react';

import type { Viewport } from 'next';

import { GA } from '@/components/analytics/ga';
import { Providers } from '@/components/providers/providers';
import { ProvidersServer } from '@/components/providers/providers-server';
import { Toaster } from '@/components/toaster';
import { META_THEME_COLORS } from '@/config';
import { fontHeading, fontMono, fontSans } from '@/lib/fonts';
import { createMetadata } from '@/lib/navigation/createMetadata';
import { cn } from '@/lib/utils';

import './globals.css';

export const metadata = createMetadata({
  title: 'Potion',
  titlePrefix: '',
});

export const viewport: Viewport = {
  themeColor: META_THEME_COLORS.light,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.theme === 'dark' || ((!('theme' in localStorage) || localStorage.theme === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.querySelector('meta[name="theme-color"]').setAttribute('content', '${META_THEME_COLORS.dark}')
                }
              } catch (_) {}
            `,
          }}
        />
        <meta name="darkreader-lock" />
      </head>
      <body
        className={cn(
          'relative min-h-dvh overflow-x-hidden scroll-smooth bg-background font-sans text-clip text-foreground',
          '[&_.slate-selection-area]:bg-brand/[.13]',
          'antialiased',
          fontSans.variable,
          fontHeading.variable,
          fontMono.variable
        )}
        vaul-drawer-wrapper=""
        suppressHydrationWarning
      >
        <ProvidersServer>
          <Providers>{children}</Providers>
        </ProvidersServer>

        <GA />
        <Toaster />
      </body>
    </html>
  );
}
