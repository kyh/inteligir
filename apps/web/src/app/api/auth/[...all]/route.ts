import { auth } from "@repo/api/auth/auth";

// Wrap the handler so module-load doesn't trigger the proxy's lazy init
// (which would require BETTER_AUTH_SECRET at `next build` page-data collection).
const handler = (request: Request): Response | Promise<Response> => auth.handler(request);

export { handler as GET, handler as POST };
