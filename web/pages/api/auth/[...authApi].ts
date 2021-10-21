import { createHandler, passport } from "@server/handler";
import { handleTokenRequest } from "@libs/auth/server/authService";

const handler = createHandler({ attachParams: true });

handler
  .post(
    "/api/auth/login",
    passport.authenticate("login", { session: false }),
    async (req, res) => {
      await handleTokenRequest(req.user!, res);
      res.status(200).json(req.user);
    }
  )
  .post(
    "/api/auth/signup",
    passport.authenticate("signup", { session: false }),
    async (req, res) => {
      await handleTokenRequest(req.user!, res);
      res.status(200).json(req.user);
    }
  )
  .post(
    "/api/auth/logout",
    passport.authenticate("jwt", { session: false }),
    async (req, res) => {
      req.logout();
      res.redirect("/");
    }
  )
  .get(
    "/api/auth/current_user",
    passport.authenticate("jwt", { session: false }),
    async (req, res) => {
      res.status(200).json(req.user);
    }
  )
  .get(
    "/api/auth/google",
    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false,
    })
  )
  .get(
    "/api/auth/google/callback",
    passport.authenticate("google", {
      failureRedirect: "/login",
      session: false,
    }),
    async (req, res) => {
      await handleTokenRequest(req.user!, res);
      res.redirect("/");
    }
  );

export default handler;
