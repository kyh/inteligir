import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { siteConfig } from "~/config/site";
import csrf from "edge-csrf";

const CSRF_SECRET_COOKIE = "csrfSecret";

async function verifyCsrfToken(token: string) {
  const csrfMiddleware = csrf({
    cookie: {
      secure: siteConfig.production,
      name: CSRF_SECRET_COOKIE,
    },
  });

  const origin = headers().get("referer") as string;
  const request = new NextRequest(origin);

  request.headers.set(CSRF_SECRET_COOKIE, token);

  const csrfError = await csrfMiddleware(request, new NextResponse());

  if (csrfError) {
    throw new Error("Invalid CSRF token");
  }
}

export default verifyCsrfToken;
