import passport from "passport";
import { localStrategy } from "@libs/auth/server/strategy/local";
import { googleStrategy } from "@libs/auth/server/strategy/google";

export const configurePassport = (
  serializeUserCb: any,
  deserializeUserCb: any
) => {
  passport.serializeUser(serializeUserCb);
  passport.deserializeUser(deserializeUserCb);

  passport.use(localStrategy);
  passport.use(googleStrategy);

  return passport;
};
