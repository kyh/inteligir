'use client';

import { useEffect } from 'react';

import type { ErrorProps } from '@/lib/navigation/next-types';

// import * as Sentry from '@sentry/nextjs';
import Image from 'next/image';

import { routes } from '@/lib/navigation/routes';
import { LinkButton } from '@/registry/ui/button';

export const useCaptureException = (error: Error, enabled = true) => {
  useEffect(() => {
    // if (process.env.NEXT_PUBLIC_SENTRY_DSN && enabled) {
    //   Sentry.captureException(error);
    // }
  }, [enabled, error]);
};

export const ErrorScreen = ({ error }: ErrorProps) => {
  // use notFound() instead. message is hidden in production.
  // const notFound = error.message.includes('found');
  const notFound = false;

  useCaptureException(error, !notFound);

  return (
    <div className="flex h-full flex-col items-center justify-center space-y-4">
      <Image
        className="dark:hidden"
        alt="error"
        height={300}
        src="/assets/error.png"
        width={300}
      />
      <Image
        className="hidden dark:block"
        alt="error"
        height={300}
        src="/assets/error-dark.png"
        width={300}
      />
      <h2 className="text-xl font-medium">Something went wrong!</h2>
      <LinkButton href={routes.home()}>Go back</LinkButton>
    </div>
  );
};
