import { createHandler, passport } from "@server/handler";

const handler = createHandler();

handler.get(
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })
);

export default handler;
