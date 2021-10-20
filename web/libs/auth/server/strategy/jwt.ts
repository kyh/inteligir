import { Strategy, ExtractJwt } from "passport-jwt";

export const ACCESS_TOKEN_COOKIE_NAME = "access_token";
export const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || "a-secret";

export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";
export const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "r-secret";

export const jwtStrategy = new Strategy(
  {
    jwtFromRequest: ExtractJwt.fromExtractors([
      (req) => req.cookies[ACCESS_TOKEN_COOKIE_NAME],
      ExtractJwt.fromAuthHeaderAsBearerToken(),
    ]),
    secretOrKey: ACCESS_TOKEN_SECRET,
  },
  (payload, done) => {
    if (!payload) return done(null, false);

    if (Date.now() > payload.expires) {
      return done("Token Expired");
    }

    return done(null, payload);
  }
);
