import type { FC } from 'react';

import { GoogleAnalytics } from '@next/third-parties/google';

import { env } from '@/env';

export const GA: FC = () => {
  if (!env.NEXT_PUBLIC_GA_MEASUREMENT_ID) {
    return null;
  }

  return <GoogleAnalytics gaId={env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />;
};
