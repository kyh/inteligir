import { createHandler, passport } from "@server/handler";
import { handleTokenRequest } from "@libs/auth/server/authService";

const handler = createHandler();

handler.post(
  passport.authenticate("login", { session: false }),
  async (req, res) => {
    if (!req.user) return res.redirect("/login");
    handleTokenRequest(req.user, res);
    res.status(200).json(req.user);
  }
);

export default handler;
