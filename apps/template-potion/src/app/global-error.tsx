'use client';

import type { ErrorProps } from '@/lib/navigation/next-types';

import { ErrorScreen } from '@/components/screens/error-screen';
import { StaticLayout } from '@/components/screens/static-layout';

export default function GlobalError(props: ErrorProps) {
  return (
    <html>
      <body>
        <StaticLayout>
          <ErrorScreen {...props} />
        </StaticLayout>
      </body>
    </html>
  );
}
