import { createAuthApiHandler, passport } from "@server/handler";

const handler = createAuthApiHandler();

handler.get(passport.authenticate("google", { scope: ["profile"] }));

export default handler;
