import { cookies } from "next/headers";
import { serialize } from "cookie";

const THEME_COOKIE_NAME = "theme";

export function parseThemeCookie() {
  return cookies().get(THEME_COOKIE_NAME)?.value;
}

export function serializeThemeCookie(value: string) {
  const secure = process.env.ENVIRONMENT === "production";

  return serialize(THEME_COOKIE_NAME, value, {
    path: "/",
    httpOnly: false,
    secure,
    sameSite: "lax" as const,
  });
}
