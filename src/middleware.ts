import { NextRequest, NextResponse } from "next/server";
import csrf from "edge-csrf";
import configuration from "~/configuration";
import HttpStatusCode from "~/core/generic/http-status-code.enum";

const CSRF_TOKEN_HEADER = "X-CSRF-Token";
const CSRF_SECRET_COOKIE = "csrfSecret";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|locales|assets|api/stripe/webhook).*)",
  ],
};

const csrfMiddleware = csrf({
  cookie: {
    secure: configuration.production,
    name: CSRF_SECRET_COOKIE,
  },
});

export async function middleware(request: NextRequest) {
  return await withCsrfMiddleware(request);
}

async function withCsrfMiddleware(request: NextRequest) {
  const csrfResponse = NextResponse.next();
  const csrfError = await csrfMiddleware(request, csrfResponse);

  if (csrfError) {
    return NextResponse.json("Invalid CSRF token", {
      status: HttpStatusCode.Forbidden,
    });
  }

  const token = csrfResponse.headers.get(CSRF_TOKEN_HEADER);

  if (token) {
    const headers = new Headers(request.headers);

    headers.set(CSRF_TOKEN_HEADER, token ?? "");

    const response = NextResponse.next({ request: { headers } });

    const nextCsrfSecret =
      csrfResponse.cookies.get(CSRF_SECRET_COOKIE)?.value ?? "";

    if (nextCsrfSecret) {
      response.cookies.set(CSRF_SECRET_COOKIE, nextCsrfSecret);
    }

    return response;
  }

  return csrfResponse;
}
