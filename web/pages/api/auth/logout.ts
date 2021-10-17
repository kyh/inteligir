import { createApiHandler } from "@server/handler";
import { removeTokenCookie } from "@libs/auth/server/cookieService";

const handler = createApiHandler();

handler.post(async (_req, res) => {
  removeTokenCookie(res);
  res.writeHead(302, { Location: "/" });
  return res.status(200).end();
});

export default handler;
