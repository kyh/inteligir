import { createHandler } from "@server/handler";

const handler = createHandler();

handler.post(async (req, res) => {
  req.logout();
  res.status(204).end();
});

export default handler;
