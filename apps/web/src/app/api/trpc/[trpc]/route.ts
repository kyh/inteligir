import type { NextRequest } from "next/server";
import { appRouter } from "@repo/api/root-router";
import { createTRPCContext } from "@repo/api/trpc";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () => createTRPCContext({ headers: req.headers }),
    onError: ({ error, path }) => {
      console.error(`>>> tRPC Error on '${path}'`, error);
    },
  });

export { handler as GET, handler as POST };
