import { handleAuthRequest } from "@repo/service/auth/auth-route";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(handleAuthRequest);
