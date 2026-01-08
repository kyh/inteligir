import { GoogleAnalytics } from '@next/third-parties/google';
import type { FC } from 'react';

import { env } from '@/env';

export const GA: FC = () => {
  if (!env.NEXT_PUBLIC_GA_MEASUREMENT_ID) {
    return null;
  }

  return <GoogleAnalytics gaId={env.NEXT_PUBLIC_GA_MEASUREMENT_ID} />;
};
