import { createHandler, passport } from "@server/handler";

const handler = createHandler();

handler.post(passport.authenticate("local"), async (req, res) => {
  res.status(200).json(req.user);
});

export default handler;
