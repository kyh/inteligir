import { createHandler, passport } from "@server/handler";

const handler = createHandler();

handler.get(
  passport.authenticate("google", { failureRedirect: "/login" }),
  async (_req, res) => {
    res.redirect("/");
  }
);

export default handler;
