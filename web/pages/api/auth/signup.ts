import { createApiHandler } from "@server/handler";
import { createUser } from "@libs/users/server/userService";

const handler = createApiHandler();

handler.post(async (req, res) => {
  try {
    const user = await createUser(req.body);
    res.status(200).json(user);
  } catch (error) {
    console.error(error);
    res.status(500).end(error.message);
  }
});

export default handler;
