import passport from "passport";
import { parse, serialize, CookieSerializeOptions } from "cookie";
import { AppRequest, AppResponse } from "@server/config";
import {
  createLoginSession,
  getLoginSession,
} from "@libs/auth/server/authService";
import { localStrategy } from "@libs/auth/server/strategy/local";
import { googleStrategy } from "@libs/auth/server/strategy/google";

export const TOKEN_NAME = "token";
export const TOKEN_SECRET = process.env.TOKEN_SECRET || "secret";
export const MAX_AGE = 60 * 60 * 24 * 30; // 30 days
export const cookieOptions = {
  maxAge: MAX_AGE,
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  sameSite: "lax",
} as CookieSerializeOptions;

const parseCookies = (req: AppRequest) => {
  // For API Routes we don't need to parse the cookies.
  if (req.cookies) return req.cookies;

  // For pages we do need to parse the cookies.
  const cookie = req.headers?.cookie;
  return parse(cookie || "");
};

export const sessionMiddleware = () => {
  return async (req: AppRequest, res: AppResponse, next: any) => {
    const cookies = parseCookies(req);
    const token = cookies[TOKEN_NAME];
    let unsealed = {};

    if (token) {
      try {
        // the cookie needs to be unsealed using the password `secret`
        unsealed = await getLoginSession(token, TOKEN_SECRET);
      } catch (e) {
        // The cookie is invalid
      }
    }

    req.session = unsealed;

    // We are proxying res.end to commit the session cookie
    const oldEnd = res.end;
    res.end = async function resEndProxy(...args) {
      if (res.finished || res.writableEnded || res.headersSent) return;
      if (cookieOptions.maxAge) {
        req.session.maxAge = cookieOptions.maxAge;
      }

      const token = await createLoginSession(req.session, TOKEN_SECRET);

      res.setHeader("Set-Cookie", serialize(TOKEN_NAME, token, cookieOptions));
      oldEnd.apply(this, args);
    };

    next();
  };
};

export const configurePassport = (
  serializeUserCb: (user: any, done: (err: any, id?: unknown) => void) => void,
  deserializeUserCb: (
    id: string,
    done: (err: any, user?: false | any | null | undefined) => void
  ) => void
) => {
  passport.serializeUser(serializeUserCb);
  passport.deserializeUser(deserializeUserCb);

  passport.use(localStrategy);
  passport.use(googleStrategy);

  return passport;
};
