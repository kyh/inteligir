import { hc } from 'hono/client';

import { env } from '@/env';

import type { AppType } from './types';

export const honoApi = hc<AppType>(env.NEXT_PUBLIC_SITE_URL).api;
