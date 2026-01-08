import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import type { NextRequest } from 'next/server';

import { env } from '@/env';
import { appRouter } from '@/server/api/root';
import { createTRPCContext } from '@/server/api/trpc';
import { getSession } from '@/server/auth/auth';

/** Configure basic CORS headers You should extend this to match your needs */
const setCorsHeaders = (res: Response) => {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Request-Method', '*');
  res.headers.set('Access-Control-Allow-Methods', 'OPTIONS, GET, POST');
  res.headers.set('Access-Control-Allow-Headers', '*');
};

export const OPTIONS = () => {
  const response = new Response(null, {
    status: 204,
  });
  setCorsHeaders(response);

  return response;
};

async function trpcHandler(req: NextRequest) {
  const sessionData = await getSession(req.headers);

  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () =>
      createTRPCContext({
        cookies:
          process.env.NODE_ENV === 'production'
            ? undefined
            : req.cookies.getAll(),
        headers: req.headers,
        session: sessionData?.session ?? null,
        user: sessionData?.user ?? null,
      }),
    onError: ({ error, path }) => {
      if (error.code === 'NOT_FOUND') {
        // silently ignore
        return;
      }
      if (error.code === 'UNAUTHORIZED') {
        // silently ignore, cookies are not supported in ssr
        return;
      }
      if (env.NODE_ENV === 'development') {
        console.error(
          `❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`
        );
      } else if (error.code === 'INTERNAL_SERVER_ERROR') {
        // send to bug reporting
        console.error('Something went wrong', error);
      }
    },
  });

  setCorsHeaders(response);

  return response;
}

export { trpcHandler as GET, trpcHandler as POST };
