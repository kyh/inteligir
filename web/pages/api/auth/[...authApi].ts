import { createHandler, passport } from "@server/handler";
import {
  handleTokenRequest,
  handleTokenDestroy,
} from "@libs/auth/server/authService";
import { authRoutes } from "@libs/auth/server/authConfig";

const handler = createHandler({ attachParams: true });

handler
  .post(
    authRoutes.signup,
    passport.authenticate("signup", { session: false }),
    async (req, res) => {
      const accessToken = handleTokenRequest(req.user!, res);
      res.status(200).json({ user: req.user, accessToken });
    }
  )
  .post(
    authRoutes.login,
    passport.authenticate("login", { session: false }),
    async (req, res) => {
      const accessToken = handleTokenRequest(req.user!, res);
      res.status(200).json({ user: req.user, accessToken });
    }
  )
  .post(
    authRoutes.refresh,
    passport.authenticate("refreshToken", { session: false }),
    async (req, res) => {
      const accessToken = handleTokenRequest(req.user!, res);
      res.status(200).json({ user: req.user, accessToken });
    }
  )
  .post(
    authRoutes.logout,
    passport.authenticate("refreshToken", { session: false }),
    async (req, res) => {
      handleTokenDestroy(res);
      req.logout();
      res.status(200).json({ user: null, accessToken: null });
    }
  )
  .get(
    authRoutes.google,
    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false,
    })
  )
  .get(
    authRoutes.googleCallback,
    passport.authenticate("google", {
      failureRedirect: "/login",
      session: false,
    }),
    async (req, res) => {
      handleTokenRequest(req.user!, res);
      res.redirect("/");
    }
  );

export default handler;
