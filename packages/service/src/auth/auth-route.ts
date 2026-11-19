import { getAuth, withoutAuthToken } from "./auth";

const CLIENT_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/auth/get-session",
  "GET /api/auth/oauth2/authorize",
  "POST /api/auth/oauth2/consent",
  "POST /api/auth/oauth2/register",
  "POST /api/auth/oauth2/revoke",
  "POST /api/auth/oauth2/token",
  "POST /api/auth/request-password-reset",
  "POST /api/auth/reset-password",
  "POST /api/auth/sign-in/email",
  "POST /api/auth/sign-out",
]);

const RESET_LINK = /^GET \/api\/auth\/reset-password\/[^/]+$/u;

const isClientRoute = (method: string, pathname: string) => {
  const route = `${method} ${pathname}`;

  return CLIENT_ROUTES.has(route) || RESET_LINK.test(route);
};

export const handleAuthRequest = async (request: Request) => {
  if (!isClientRoute(request.method, new URL(request.url).pathname)) {
    return new Response("not found", { status: 404 });
  }

  return withoutAuthToken(await getAuth().handler(request));
};
