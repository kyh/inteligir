import { Strategy, ExtractJwt } from "passport-jwt";
import { ACCESS_TOKEN_COOKIE_NAME, ACCESS_TOKEN_SECRET } from "../config";

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
