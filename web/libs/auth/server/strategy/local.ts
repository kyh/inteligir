import { Strategy } from "passport-local";
import { getUserPasswordHash } from "@libs/users/server/userService";
import { validatePassword } from "@libs/auth/server/authService";

export const localStrategy = new Strategy(
  { usernameField: "email" },
  async (email, password, done) => {
    try {
      const { user, passwordHash } = await getUserPasswordHash({ email });
      if (
        !user ||
        !passwordHash ||
        (passwordHash && !validatePassword(passwordHash, password))
      ) {
        return done(null, false);
      }
      return done(null, user);
    } catch (error) {
      done(error, null);
    }
  }
);
