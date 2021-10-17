import passport from "passport";
import { createApiHandler } from "@server/handler";
import { localStrategy } from "@libs/auth/server/strategy/local";
import { setLoginSession } from "@libs/auth/server/authService";

const handler = createApiHandler();

const authenticate = (method, req, res) =>
  new Promise((resolve, reject) => {
    passport.authenticate(method, { session: false }, (error, token) => {
      if (error) {
        reject(error);
      } else {
        resolve(token);
      }
    })(req, res);
  });

passport.use(localStrategy);

handler.use(passport.initialize()).post(async (req, res) => {
  try {
    const user = await authenticate("local", req, res);
    // session is the payload to save in the token, it may contain basic info about the user
    const session = { ...user };

    await setLoginSession(res, session);

    res.status(200).send({ done: true });
  } catch (error) {
    console.error(error);
    res.status(401).send(error.message);
  }
});

export default handler;
