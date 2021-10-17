import { createApiHandler } from "@server/handler";
import { getLoginSession } from "@libs/auth/server/authService";
import { findUser } from "@libs/users/server/userService";

const handler = createApiHandler();

handler.post(async (req, res) => {
  try {
    const session = await getLoginSession(req.body);
    const user = (session && (await findUser(session))) ?? null;
    res.status(200).json(user);
  } catch (error) {
    console.error(error);
    res.status(400).end(error.message);
  }
});

export default handler;
