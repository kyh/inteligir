import { createHandler, passport } from "@server/handler";
import { handleTokenRequest } from "@libs/auth/server/authService";

const handler = createHandler();

handler.get(
  passport.authenticate("google", {
    failureRedirect: "/login",
    session: false,
  }),
  async (req, res) => {
    if (!req.user) return res.redirect("/login");
    handleTokenRequest(req.user, res);
    res.redirect("/");
  }
);

export default handler;
