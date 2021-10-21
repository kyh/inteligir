export const ACCESS_TOKEN_COOKIE_NAME = "access_token";
export const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "a-secret";

export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";
export const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "r-secret";

export const COOKIE_SECRET = process.env.COOKIE_SECRET || "cookie-secret";

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as "lax",
  maxAge: 24 * 60 * 60 * 1000 * 30, // 30 days (last number is days)
  secure: process.env.NODE_ENV !== "development" && !process.env.INSECURE_AUTH,
  signed: process.env.NODE_ENV !== "development" && !process.env.INSECURE_AUTH,
};
