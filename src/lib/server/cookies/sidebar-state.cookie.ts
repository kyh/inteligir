import { cookies } from "next/headers";
import { serialize } from "cookie";

const SIDEBAR_STATE_COOKIE_NAME = "sidebarState";

export function parseSidebarStateCookie() {
  return cookies().get(SIDEBAR_STATE_COOKIE_NAME)?.value;
}

export async function serializeSidebarCookie(value: string) {
  const secure = process.env.ENVIRONMENT === "production";

  return serialize(SIDEBAR_STATE_COOKIE_NAME, value, {
    path: "/",
    httpOnly: false,
    secure,
    sameSite: "strict" as const,
  });
}
