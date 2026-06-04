import { getAuth } from "@repo/api/auth/auth";

const handler = (request: Request): Response | Promise<Response> => getAuth().handler(request);

export { handler as GET, handler as POST };
