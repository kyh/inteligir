import { createHandler, passport } from "@server/handler";

const handler = createHandler();

handler.get(passport.authenticate("google", { scope: ["profile"] }));

export default handler;
