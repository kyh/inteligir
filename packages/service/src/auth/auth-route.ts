import { getAuth, withoutAuthToken } from "./auth";

// The whole of Better Auth that `/api/auth/*` hands a request to: every device signs in, reads its
// session and signs out, and the site asks for a reset, follows its mailed link and sets the
// password. Named rather than subtracted from Better Auth's own table, so a route a release adds is
// never open; auth.api and the invite gate's forwarded sign-up call past it. Deletion's one door is
// `account.delete`, which asks the password again where Better Auth's own route settles for a fresh
// session; listing and ending sessions are `account.devices.*`, which never hand a token out.
const CLIENT_ROUTES: ReadonlySet<string> = new Set([
  "GET /api/auth/get-session",
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
