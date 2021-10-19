import { createAuthApiHandler } from "@server/handler";

const handler = createAuthApiHandler();

handler.post(async (req, res) => {
  req.logout();
  res.status(204).end();
});

export default handler;
