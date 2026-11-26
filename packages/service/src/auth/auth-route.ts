import { getAuth, withoutAuthToken } from "./auth";

const CLIENT_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/auth/get-session",
  "GET /api/auth/oauth2/authorize",
  "POST /api/auth/oauth2/consent",
  "POST /api/auth/oauth2/register",
  "POST /api/auth/oauth2/revoke",
  "POST /api/auth/oauth2/token",
  "POST /api/auth/email-otp/send-verification-otp",
  "POST /api/auth/sign-in/email-otp",
  "POST /api/auth/sign-out",
]);

const isClientRoute = (method: string, pathname: string) =>
  CLIENT_ROUTES.has(`${method} ${pathname}`);

export const handleAuthRequest = async (request: Request) => {
  if (!isClientRoute(request.method, new URL(request.url).pathname)) {
    return new Response("not found", { status: 404 });
  }

  return withoutAuthToken(await getAuth().handler(request));
};
