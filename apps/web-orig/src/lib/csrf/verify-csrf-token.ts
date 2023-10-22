import csrf from "edge-csrf";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

const CSRF_SECRET_COOKIE = "csrfSecret";

export const verifyCsrfToken = async (token: string) => {
  const csrfMiddleware = csrf({
    cookie: {
      secure: process.env.NODE_ENV === "production",
      name: CSRF_SECRET_COOKIE,
    },
  });

  const origin = headers().get("referer") || "";
  const request = new NextRequest(origin);

  request.headers.set(CSRF_SECRET_COOKIE, token);

  const csrfError = await csrfMiddleware(request, new NextResponse());

  if (csrfError) {
    throw new Error("Invalid CSRF token");
  }
};
