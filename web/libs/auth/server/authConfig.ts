export const ACCESS_TOKEN_COOKIE_NAME = "access_token";
export const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "a-secret";

export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";
export const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "r-secret";

export const COOKIE_SECRET = process.env.COOKIE_SECRET || "c-secret";

export const cookieOptions = {
  path: "/",
  httpOnly: true,
  sameSite: "lax" as "lax",
  maxAge: 24 * 60 * 60 * 1000 * 30, // 30 days (last number is in days)
  secure: process.env.NODE_ENV !== "development" && !process.env.INSECURE_AUTH,
  signed: process.env.NODE_ENV !== "development" && !process.env.INSECURE_AUTH,
};

export const authRoutes = {
  signup: "/api/auth/signup",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  current: "/api/auth/current_user",
  google: "/api/auth/google",
  googleCallback: "/api/auth/google/callback",
  facebook: "/api/auth/facebook",
  facebookCallback: "/api/auth/facebook/callback",
  refresh: "/api/auth/refresh_token",
};
