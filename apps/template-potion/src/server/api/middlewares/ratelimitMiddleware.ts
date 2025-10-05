import { TRPCError } from '@trpc/server';

import { env } from '@/env';
import { type RatelimitKey, getUserRatelimit } from '@/server/ratelimit';

import { type TRPCContext, t } from '../trpc';

export const ratelimitGuard = async (ctx: TRPCContext, key?: RatelimitKey) => {
  if (!env.UPSTASH_REDIS_REST_TOKEN) return;

  const { message, success } = await getUserRatelimit({
    key,
    ip: ctx.headers['x-forwarded-for'],
    user: ctx.user,
  });

  if (!success) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message,
    });
  }
};

export const ratelimitMiddleware = (key?: RatelimitKey) =>
  t.middleware(async ({ ctx, next }) => {
    await ratelimitGuard(ctx, key);

    return next({ ctx });
  });
