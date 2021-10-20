import { createHandler } from "@server/handler";

const handler = createHandler();

handler.get(async (req, res) => {
  res.status(200).json(req.user);
});

export default handler;
