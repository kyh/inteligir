import { createHandler, passport } from "@server/handler";

const handler = createHandler();

handler.get(
  passport.authenticate("jwt", { session: false }),
  async (req, res) => {
    res.status(200).json(req.user);
  }
);

export default handler;
