import passport from "passport";
import {
  signupStrategy,
  loginStrategy,
} from "@libs/auth/server/strategy/local";
import { googleStrategy } from "@libs/auth/server/strategy/google";
import { jwtStrategy } from "@libs/auth/server/strategy/jwt";

export const configurePassport = () => {
  passport.use("signup", signupStrategy);
  passport.use("login", loginStrategy);
  passport.use(googleStrategy);
  passport.use(jwtStrategy);

  return passport;
};
