import { createAuthApiHandler, passport } from "@server/handler";

const handler = createAuthApiHandler();

handler.get(
  passport.authenticate("google", { failureRedirect: "/login" }),
  async (_req, res) => {
    res.redirect("/");
  }
);

export default handler;
