import type { cookies } from "next/headers";

export type AnyCookies =
  | ReturnType<typeof cookies>
  | Partial<{
      key: string;
    }>;

const readServerCookie = (cookies: AnyCookies, key: string) => {
  if ("get" in cookies && typeof cookies.get === "function") {
    return cookies.get(key)?.value;
  }

  return (cookies as StringObject)[key];
};

export default readServerCookie;
