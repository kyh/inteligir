'use client';

// import * as Sentry from '@sentry/nextjs';
import Image from 'next/image';
import { useEffect } from 'react';

import { LinkButton } from '@/registry/ui/button';

type ErrorProps = {
  error: { digest?: string } & Error;
  reset: () => void;
};

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
        alt="error"
        className="dark:hidden"
        height={300}
        src="/assets/error.png"
        width={300}
      />
      <Image
        alt="error"
        className="hidden dark:block"
        height={300}
        src="/assets/error-dark.png"
        width={300}
      />
      <h2 className="font-medium text-xl">Something went wrong!</h2>
      <LinkButton href="/">Go back</LinkButton>
    </div>
  );
};
