import { getAuth, withoutAuthToken } from "./auth";

// The whole of Better Auth that `/api/auth/*` hands a request to: every device signs in, reads its
// session and signs out, the site asks for a reset, follows its mailed link and sets the password,
// and an assistant registers, is authorized on the consent page and trades its code or refresh
// token. Named rather than subtracted from Better Auth's own table, so a route a release adds is
// never open; auth.api and the invite gate's forwarded sign-up call past it. Deletion's one door is
// `account.delete`, which asks the password again where Better Auth's own route settles for a fresh
// session; listing and ending sessions are `account.devices.*`, and listing and disconnecting
// assistants `account.assistants.*`, which never hand a token out. The authorization server's
// metadata is the discovery route's (`./oauth-discovery`), at the path RFC 8414 names.
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

// the mailed link, its token the path's last part
const RESET_LINK = /^GET \/api\/auth\/reset-password\/[^/]+$/u;

const isClientRoute = (method: string, pathname: string): boolean => {
  const route = `${method} ${pathname}`;
  return CLIENT_ROUTES.has(route) || RESET_LINK.test(route);
};

export const handleAuthRequest = async (request: Request): Promise<Response> => {
  if (!isClientRoute(request.method, new URL(request.url).pathname)) {
    return new Response("not found", { status: 404 });
  }
  return withoutAuthToken(await getAuth().handler(request));
};
