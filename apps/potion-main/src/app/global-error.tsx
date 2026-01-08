'use client';

import { ErrorScreen } from '@/components/screens/error-screen';
import { StaticLayout } from '@/components/screens/static-layout';

type ErrorProps = {
  error: { digest?: string } & Error;
  reset: () => void;
};

export default function GlobalError(props: ErrorProps) {
  return (
    <html lang="en">
      <body>
        <StaticLayout>
          <ErrorScreen {...props} />
        </StaticLayout>
      </body>
    </html>
  );
}
