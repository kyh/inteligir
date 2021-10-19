import { createAuthApiHandler } from "@server/handler";

const handler = createAuthApiHandler();

handler.get(async (req, res) => {
  res.json(req.user);
});

export default handler;
