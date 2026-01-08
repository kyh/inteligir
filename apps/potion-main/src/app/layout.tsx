import type { Viewport } from 'next';
import * as React from 'react';

import { GA } from '@/components/analytics/ga';
import { Providers } from '@/components/providers/providers';
import { ProvidersServer } from '@/components/providers/providers-server';
import { Toaster } from '@/components/toaster';
import { META_THEME_COLORS } from '@/config';
import { createMetadata } from '@/lib/createMetadata';
import { fontHeading, fontMono, fontSans } from '@/lib/fonts';
import { cn } from '@/lib/utils';

import './globals.css';
import Script from 'next/script';

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

        {/* React Grab - Development only */}
        {process.env.NODE_ENV === 'development' && (
          <Script
            crossOrigin="anonymous"
            data-enabled="true"
            src="//unpkg.com/react-grab/dist/index.global.js"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body
        className={cn(
          'relative min-h-dvh overflow-x-hidden scroll-smooth text-clip bg-background font-sans text-foreground',
          '[&_.slate-selection-area]:bg-brand/13',
          'antialiased',
          fontSans.variable,
          fontHeading.variable,
          fontMono.variable
        )}
        suppressHydrationWarning
        vaul-drawer-wrapper=""
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
